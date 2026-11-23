import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

function createBaseState(overrides = {}) {
  return {
    entries: [],
    activities: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    activeTimer: null,
    authUser: null,
    tab: 'entry',
    period: '7',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    ...overrides,
  };
}

function createFakePwaFactory(initialSnap) {
  let snap = {
    platform: 'desktop',
    isNative: false,
    nativePlatform: 'web',
    isInstalled: false,
    isInstallable: false,
    isOnline: true,
    showIOSGuide: false,
    updateReady: false,
    installMode: 'manual-hint',
    canPromptInstall: false,
    shouldShowHeaderInstall: false,
    ...initialSnap,
  };
  let callbacks = {};
  const promptInstall = vi.fn(async () => ({ supported: true, outcome: 'accepted' }));
  const openIOSGuide = vi.fn(() => {
    snap = { ...snap, showIOSGuide: true };
  });
  const closeIOSGuide = vi.fn(() => {
    snap = { ...snap, showIOSGuide: false };
  });

  const factory = (opts) => {
    callbacks = opts || {};
    return {
      getSnapshot: () => snap,
      promptInstall,
      openIOSGuide,
      closeIOSGuide,
      destroy: vi.fn(),
    };
  };

  return {
    factory,
    promptInstall,
    openIOSGuide,
    closeIOSGuide,
    setSnapshot(patch) {
      snap = { ...snap, ...patch };
      callbacks.onChange?.(snap);
    },
  };
}

describe('Mobile & PWA UI integration (install button, iOS guide, offline banner, Capacitor badge)', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('shows header & card install buttons when prompt is available and invokes promptInstall', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const pwaMock = createFakePwaFactory({
      platform: 'android',
      isInstallable: true,
      installMode: 'prompt',
      canPromptInstall: true,
      shouldShowHeaderInstall: true,
    });

    window.location.hash = '#mobile';
    const ui = createUI({
      root,
      state: createBaseState({ tab: 'mobile' }),
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      pwaControllerFactory: pwaMock.factory,
    });

    const headerBtn = root.querySelector('[data-behavior-target="pwa-install-header"]');
    const cardBtn = root.querySelector('[data-behavior-target="pwa-install-card"]');
    expect(headerBtn).toBeTruthy();
    expect(cardBtn).toBeTruthy();

    headerBtn.click();
    await vi.waitFor(() => {
      expect(pwaMock.promptInstall).toHaveBeenCalledTimes(1);
    });

    ui.destroy();
    root.remove();
  });

  it('hides install buttons when running in standalone PWA or native Capacitor app', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const pwaMock = createFakePwaFactory({
      isNative: true,
      nativePlatform: 'android',
      installMode: 'native',
      shouldShowHeaderInstall: false,
    });

    window.location.hash = '#mobile';
    const ui = createUI({
      root,
      state: createBaseState({ tab: 'mobile' }),
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      pwaControllerFactory: pwaMock.factory,
    });

    expect(root.querySelector('[data-behavior-target="pwa-install-header"]')).toBeNull();
    expect(root.querySelector('[data-behavior-target="pwa-install-card"]')).toBeNull();
    expect(root.textContent).toContain('App native Capacitor (android)');

    ui.destroy();
    root.remove();
  });

  it('opens iOS Safari guided install modal when on iOS', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const pwaMock = createFakePwaFactory({
      platform: 'ios',
      installMode: 'ios-guide',
      shouldShowHeaderInstall: true,
    });

    const ui = createUI({
      root,
      state: createBaseState(),
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      pwaControllerFactory: pwaMock.factory,
    });

    const headerBtn = root.querySelector('[data-behavior-target="pwa-install-header"]');
    expect(headerBtn).toBeTruthy();
    headerBtn.click();

    expect(pwaMock.openIOSGuide).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('Installer sur iPhone / iPad');
    expect(root.textContent).toContain('Sur l’écran d’accueil');

    const closeBtn = root.querySelector('[data-behavior-target="pwa-guide-close"]');
    closeBtn.click();
    expect(pwaMock.closeIOSGuide).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.modal-overlay')).toBeNull();

    ui.destroy();
    root.remove();
  });

  it('shows offline connectivity indicator when offline and hides it when back online', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const pwaMock = createFakePwaFactory({ isOnline: false });

    const ui = createUI({
      root,
      state: createBaseState(),
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      pwaControllerFactory: pwaMock.factory,
    });

    expect(root.querySelector('.offline-indicator-banner')).toBeTruthy();
    expect(root.querySelector('.offline-indicator-banner').textContent).toContain('Hors ligne');

    pwaMock.setSnapshot({ isOnline: true });
    expect(root.querySelector('.offline-indicator-banner')).toBeNull();

    ui.destroy();
    root.remove();
  });
});
