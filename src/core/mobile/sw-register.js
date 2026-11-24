import { isCapacitorNative } from './pwa-install.js';

/**
 * Unregisters any lingering Service Workers and clears cached responses.
 * Used in Vite dev mode so stale precache / dev-sw entries cannot serve
 * stale HTML or missing hashed chunks after restarts or edits.
 */
export async function unregisterStaleServiceWorkers(win = typeof window !== 'undefined' ? window : null) {
  const sw = win?.navigator?.serviceWorker;
  if (sw && typeof sw.getRegistrations === 'function') {
    try {
      const registrations = await sw.getRegistrations();
      await Promise.all(registrations.map(reg => reg?.unregister?.().catch(() => false)));
    } catch {
      // Ignore cleanup failures in restricted browser contexts.
    }
  }
  const cacheStorage = win?.caches;
  if (cacheStorage && typeof cacheStorage.keys === 'function') {
    try {
      const keys = await cacheStorage.keys();
      await Promise.all(keys.map(key => cacheStorage.delete(key).catch(() => false)));
    } catch {
      // Ignore cache cleanup failures.
    }
  }
}

/**
 * Registers the VitePWA Service Worker when running in a standard Web/PWA production browser.
 * Skipped in Capacitor native WebView, Vitest test environments, and Vite dev mode.
 */
export async function registerAppServiceWorker({
  win = typeof window !== 'undefined' ? window : null,
  importer = null,
  isDevEnv = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV),
  onNeedRefresh,
  onOfflineReady,
  onError,
} = {}) {
  if (!win || isCapacitorNative(win)) {
    return { registered: false, reason: 'native_or_non_browser' };
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') {
    return { registered: false, reason: 'test_env' };
  }
  if (isDevEnv) {
    await unregisterStaleServiceWorkers(win);
    return { registered: false, reason: 'dev_env' };
  }
  if (!('serviceWorker' in (win.navigator || {}))) {
    return { registered: false, reason: 'unsupported' };
  }
  if (typeof importer !== 'function') {
    return { registered: false, reason: 'unavailable' };
  }

  try {
    const mod = await importer();
    const registerSW = mod?.registerSW;
    if (typeof registerSW !== 'function') {
      return { registered: false, reason: 'unavailable' };
    }

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        onNeedRefresh?.(() => updateSW(true));
      },
      onOfflineReady() {
        onOfflineReady?.();
      },
      onRegisterError(err) {
        onError?.(err);
      },
    });

    return { registered: true, updateSW };
  } catch (err) {
    onError?.(err);
    return { registered: false, reason: 'error', error: err };
  }
}
