/**
 * Mobile & PWA installation + connectivity detection utilities.
 * Functional core with pure environment detectors and a reactive controller.
 */

export function detectMobilePlatform(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.navigator) return 'desktop';
  const ua = String(win.navigator.userAgent || '').toLowerCase();
  const platform = String(win.navigator.platform || '');
  const maxTouchPoints = Number(win.navigator.maxTouchPoints || 0);

  if (/iphone|ipad|ipod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/android/.test(ua)) {
    return 'android';
  }
  return 'desktop';
}

export function isStandaloneMode(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  const mediaMatch = Boolean(win.matchMedia?.('(display-mode: standalone)')?.matches);
  const iosStandalone = win.navigator?.standalone === true;
  return mediaMatch || iosStandalone;
}

export function getCapacitorPlatform(win = typeof window !== 'undefined' ? window : null) {
  const cap = win?.Capacitor;
  if (!cap || typeof cap.getPlatform !== 'function') return 'web';
  const platform = String(cap.getPlatform() || 'web').toLowerCase();
  return platform || 'web';
}

export function isCapacitorNative(win = typeof window !== 'undefined' ? window : null) {
  const cap = win?.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform());
  }
  return getCapacitorPlatform(win) !== 'web';
}

export function getInstallMode({ isInstalled, isNative, isInstallable, platform }) {
  if (isNative) return 'native';
  if (isInstalled) return 'installed';
  if (isInstallable) return 'prompt';
  if (platform === 'ios') return 'ios-guide';
  return 'manual-hint';
}

export function getRuntimeEnvironment(win = typeof window !== 'undefined' ? window : null) {
  const platform = detectMobilePlatform(win);
  const isNative = isCapacitorNative(win);
  const nativePlatform = getCapacitorPlatform(win);
  const isInstalled = isStandaloneMode(win);
  const isOnline = win?.navigator && typeof win.navigator.onLine === 'boolean'
    ? win.navigator.onLine
    : true;

  return {
    platform,
    isNative,
    nativePlatform,
    isInstalled,
    isOnline,
  };
}

export function createPwaInstallController({
  win = typeof window !== 'undefined' ? window : null,
  onChange,
  onInstalled,
} = {}) {
  const initialEnv = getRuntimeEnvironment(win);
  let deferredPrompt = null;
  let isInstalled = initialEnv.isInstalled;
  let isNative = initialEnv.isNative;
  let nativePlatform = initialEnv.nativePlatform;
  let platform = initialEnv.platform;
  let isOnline = initialEnv.isOnline;
  let showIOSGuide = false;
  let updateReady = false;
  const listeners = new Set();

  function getSnapshot() {
    const isInstallable = Boolean(deferredPrompt);
    const installMode = getInstallMode({
      isInstalled,
      isNative,
      isInstallable,
      platform,
    });
    return {
      platform,
      isNative,
      nativePlatform,
      isInstalled,
      isInstallable,
      isOnline,
      showIOSGuide,
      updateReady,
      installMode,
      canPromptInstall: installMode === 'prompt',
      shouldShowHeaderInstall: installMode === 'prompt' || installMode === 'ios-guide',
    };
  }

  function notify() {
    const snapshot = getSnapshot();
    if (typeof onChange === 'function') {
      onChange(snapshot);
    }
    listeners.forEach(fn => fn(snapshot));
  }

  const handleBeforeInstallPrompt = (event) => {
    if (typeof event?.preventDefault === 'function') {
      event.preventDefault();
    }
    deferredPrompt = event;
    notify();
  };

  const handleAppInstalled = () => {
    isInstalled = true;
    deferredPrompt = null;
    showIOSGuide = false;
    notify();
    if (typeof onInstalled === 'function') {
      onInstalled(getSnapshot());
    }
  };

  const handleOnline = () => {
    isOnline = true;
    notify();
  };

  const handleOffline = () => {
    isOnline = false;
    notify();
  };

  const displayModeQuery = win?.matchMedia?.('(display-mode: standalone)') || null;
  const handleDisplayModeChange = (event) => {
    if (event?.matches) {
      isInstalled = true;
      deferredPrompt = null;
      showIOSGuide = false;
      notify();
    }
  };

  if (win?.addEventListener) {
    win.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    win.addEventListener('appinstalled', handleAppInstalled);
    win.addEventListener('online', handleOnline);
    win.addEventListener('offline', handleOffline);
  }
  displayModeQuery?.addEventListener?.('change', handleDisplayModeChange);

  return {
    getSnapshot,

    refreshEnvironment() {
      const next = getRuntimeEnvironment(win);
      platform = next.platform;
      isNative = next.isNative;
      nativePlatform = next.nativePlatform;
      isInstalled = next.isInstalled;
      isOnline = next.isOnline;
      notify();
      return getSnapshot();
    },

    async promptInstall() {
      if (!deferredPrompt) {
        return { supported: false, outcome: null };
      }
      const promptEvent = deferredPrompt;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      const outcome = choice?.outcome || 'dismissed';
      if (outcome === 'accepted') {
        isInstalled = true;
        deferredPrompt = null;
        showIOSGuide = false;
        notify();
        if (typeof onInstalled === 'function') {
          onInstalled(getSnapshot());
        }
      } else {
        deferredPrompt = null;
        notify();
      }
      return { supported: true, outcome };
    },

    openIOSGuide() {
      showIOSGuide = true;
      notify();
    },

    closeIOSGuide() {
      showIOSGuide = false;
      notify();
    },

    markUpdateReady(flag = true) {
      updateReady = Boolean(flag);
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      if (win?.removeEventListener) {
        win.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        win.removeEventListener('appinstalled', handleAppInstalled);
        win.removeEventListener('online', handleOnline);
        win.removeEventListener('offline', handleOffline);
      }
      displayModeQuery?.removeEventListener?.('change', handleDisplayModeChange);
      listeners.clear();
    },
  };
}
