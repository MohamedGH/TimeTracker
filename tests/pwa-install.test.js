import { describe, it, expect, vi } from 'vitest';
import {
  detectMobilePlatform,
  isStandaloneMode,
  isCapacitorNative,
  getCapacitorPlatform,
  isPwaSupported,
  getRuntimeEnvironment,
  getInstallMode,
  createPwaInstallController,
  registerAppServiceWorker,
} from '../src/core/mobile/index.js';

function createMockWindow({
  ua = 'Mozilla/5.0 (Linux; Android 14)',
  platform = 'Linux armv8l',
  maxTouchPoints = 5,
  standaloneMedia = false,
  iosStandalone = false,
  onLine = true,
  capacitor = null,
  hasServiceWorker = true,
  isSecureContext = true,
} = {}) {
  const listeners = new Map();
  const navigator = {
    userAgent: ua,
    platform,
    maxTouchPoints,
    standalone: iosStandalone,
    onLine,
  };
  if (hasServiceWorker) {
    navigator.serviceWorker = {};
  }
  return {
    navigator,
    isSecureContext,
    Capacitor: capacitor,
    matchMedia: vi.fn((query) => ({
      matches: query.includes('standalone') ? standaloneMedia : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    addEventListener: vi.fn((evt, cb) => {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(cb);
    }),
    removeEventListener: vi.fn((evt, cb) => {
      listeners.get(evt)?.delete(cb);
    }),
    emit(evt, payload = {}) {
      for (const cb of listeners.get(evt) || []) {
        cb(payload);
      }
    },
  };
}

describe('Mobile & PWA platform detection and controller', () => {
  it('detects iOS, iPadOS desktop UA, Android, and desktop', () => {
    expect(detectMobilePlatform(createMockWindow({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }))).toBe('ios');
    expect(detectMobilePlatform(createMockWindow({ ua: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }))).toBe('ios');
    expect(detectMobilePlatform(createMockWindow({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' }))).toBe('android');
    expect(detectMobilePlatform(createMockWindow({ ua: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 }))).toBe('desktop');
  });

  it('detects standalone mode and Capacitor native runtime cleanly', () => {
    expect(isStandaloneMode(createMockWindow({ standaloneMedia: true }))).toBe(true);
    expect(isStandaloneMode(createMockWindow({ iosStandalone: true }))).toBe(true);
    expect(isStandaloneMode(createMockWindow())).toBe(false);

    const androidCap = createMockWindow({
      capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    });
    expect(isCapacitorNative(androidCap)).toBe(true);
    expect(getCapacitorPlatform(androidCap)).toBe('android');

    const webCap = createMockWindow({
      capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
    });
    expect(isCapacitorNative(webCap)).toBe(false);
    expect(getCapacitorPlatform(webCap)).toBe('web');
  });

  it('computes isPwaSupported, isWebBrowser, and isPwaReady accurately', () => {
    const webReadyWin = createMockWindow({ hasServiceWorker: true, isSecureContext: true });
    expect(isPwaSupported(webReadyWin)).toBe(true);
    expect(getRuntimeEnvironment(webReadyWin)).toMatchObject({
      isNative: false,
      isInstalled: false,
      isWebBrowser: true,
      isPwaReady: true,
    });

    const insecureWin = createMockWindow({ hasServiceWorker: true, isSecureContext: false });
    expect(isPwaSupported(insecureWin)).toBe(false);
    expect(getRuntimeEnvironment(insecureWin)).toMatchObject({
      isWebBrowser: true,
      isPwaReady: false,
    });

    const noSwWin = createMockWindow({ hasServiceWorker: false, isSecureContext: true });
    expect(isPwaSupported(noSwWin)).toBe(false);
    expect(getRuntimeEnvironment(noSwWin)).toMatchObject({
      isWebBrowser: true,
      isPwaReady: false,
    });

    const standaloneWin = createMockWindow({ standaloneMedia: true });
    expect(getRuntimeEnvironment(standaloneWin)).toMatchObject({
      isInstalled: true,
      isWebBrowser: false,
      isPwaReady: false,
    });

    const nativeWin = createMockWindow({
      capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    });
    expect(isPwaSupported(nativeWin)).toBe(false);
    expect(getRuntimeEnvironment(nativeWin)).toMatchObject({
      isNative: true,
      isWebBrowser: false,
      isPwaReady: false,
    });
  });

  it('computes install mode priority accurately', () => {
    expect(getInstallMode({ isNative: true, isInstalled: false, isInstallable: true, platform: 'android' })).toBe('native');
    expect(getInstallMode({ isNative: false, isInstalled: true, isInstallable: true, platform: 'android' })).toBe('installed');
    expect(getInstallMode({ isNative: false, isInstalled: false, isInstallable: true, platform: 'android' })).toBe('prompt');
    expect(getInstallMode({ isNative: false, isInstalled: false, isInstallable: false, platform: 'ios' })).toBe('ios-guide');
    expect(getInstallMode({ isNative: false, isInstalled: false, isInstallable: false, platform: 'desktop' })).toBe('manual-hint');
  });

  it('handles beforeinstallprompt, accepted promptInstall, appinstalled, and online/offline events', async () => {
    const win = createMockWindow();
    const onInstalled = vi.fn();
    const controller = createPwaInstallController({ win, onInstalled });

    expect(controller.getSnapshot().canPromptInstall).toBe(false);
    expect(controller.getSnapshot().isOnline).toBe(true);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const preventDefault = vi.fn();
    win.emit('beforeinstallprompt', {
      preventDefault,
      prompt: promptMock,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().canPromptInstall).toBe(true);
    expect(controller.getSnapshot().shouldShowHeaderInstall).toBe(true);

    const res = await controller.promptInstall();
    expect(res).toEqual({ supported: true, outcome: 'accepted' });
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().isInstalled).toBe(true);
    expect(controller.getSnapshot().shouldShowHeaderInstall).toBe(false);
    expect(onInstalled).toHaveBeenCalledTimes(1);

    win.emit('offline');
    expect(controller.getSnapshot().isOnline).toBe(false);

    win.emit('online');
    expect(controller.getSnapshot().isOnline).toBe(true);

    controller.openIOSGuide();
    expect(controller.getSnapshot().showIOSGuide).toBe(true);
    controller.closeIOSGuide();
    expect(controller.getSnapshot().showIOSGuide).toBe(false);

    controller.destroy();
  });

  it('skips Service Worker registration inside Capacitor native or test environment', async () => {
    const nativeWin = createMockWindow({
      capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
    });
    const resNative = await registerAppServiceWorker({ win: nativeWin });
    expect(resNative).toEqual({ registered: false, reason: 'native_or_non_browser' });

    const resTest = await registerAppServiceWorker({ win: createMockWindow() });
    expect(resTest).toEqual({ registered: false, reason: 'test_env' });

    const resNoImporter = await registerAppServiceWorker({
      win: createMockWindow({ navigator: {} }),
    });
    expect(resNoImporter.registered).toBe(false);
  });

  it('unregisters stale Service Workers and clears caches when running in dev mode', async () => {
    const unregisterA = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);
    const devWin = createMockWindow();
    devWin.navigator.serviceWorker = {
      getRegistrations: vi.fn().mockResolvedValue([{ unregister: unregisterA }]),
    };
    devWin.caches = {
      keys: vi.fn().mockResolvedValue(['workbox-precache-v2']),
      delete: deleteCache,
    };

    const origMode = import.meta.env.MODE;
    try {
      // Simulate non-test mode with isDevEnv=true directly via unregisterStaleServiceWorkers
      const { unregisterStaleServiceWorkers } = await import('../src/core/mobile/sw-register.js');
      await unregisterStaleServiceWorkers(devWin);
      expect(unregisterA).toHaveBeenCalledTimes(1);
      expect(deleteCache).toHaveBeenCalledWith('workbox-precache-v2');
    } finally {
      import.meta.env.MODE = origMode;
    }
  });
});
