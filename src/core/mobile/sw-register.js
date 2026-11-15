import { isCapacitorNative } from './pwa-install.js';

/**
 * Registers the VitePWA Service Worker when running in a standard Web/PWA browser.
 * Skipped in Capacitor native WebView and Vitest test environments.
 */
export async function registerAppServiceWorker({
  win = typeof window !== 'undefined' ? window : null,
  importer = null,
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
