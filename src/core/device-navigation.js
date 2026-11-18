/**
 * Device Navigation — Pure functional device classification & adaptive navigation profiles
 * (mobile bottom bar, tablet top navigation bar, desktop side navigation rail + keyboard shortcuts).
 */

import { isCapacitorNative } from './mobile/pwa-install.js';

export const DEVICE_TYPES = Object.freeze({
  MOBILE: 'mobile',
  TABLET: 'tablet',
  DESKTOP: 'desktop',
});

export const NAV_LAYOUTS = Object.freeze({
  BOTTOM_BAR: 'bottom-bar',
  TOP_BAR: 'top-bar',
  SIDE_RAIL: 'side-rail',
});

export const NAV_ROUTES = Object.freeze([
  { id: 'entry', label: 'Chrono & Saisie', shortLabel: 'Chrono', shortcutHint: 'Alt+1' },
  { id: 'dashboard', label: 'Tableau de bord', shortLabel: 'Stats', shortcutHint: 'Alt+2' },
  { id: 'categories', label: 'Catégories', shortLabel: 'Catégories', shortcutHint: 'Alt+3' },
]);

/**
 * Pure classification of device form-factor from viewport and input capabilities.
 */
export function classifyDeviceType({
  width = 1024,
  pointerCoarse = false,
  maxTouchPoints = 0,
  ua = '',
  isNative = false,
} = {}) {
  const safeWidth = Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : 1024;
  const normalizedUa = String(ua || '').toLowerCase();

  if (safeWidth < 768) {
    return DEVICE_TYPES.MOBILE;
  }

  const isPhoneUa = /iphone|ipod|windows phone|blackberry/.test(normalizedUa)
    || (/android/.test(normalizedUa) && /mobile/.test(normalizedUa));

  if (isPhoneUa && safeWidth < 920) {
    return DEVICE_TYPES.MOBILE;
  }

  const isTabletUa = /ipad|tablet|playbook|silk/.test(normalizedUa)
    || (/android/.test(normalizedUa) && !/mobile/.test(normalizedUa))
    || (/macintosh/.test(normalizedUa) && maxTouchPoints > 1);

  if (isTabletUa && safeWidth < 1280) {
    return DEVICE_TYPES.TABLET;
  }

  if ((pointerCoarse || isNative) && maxTouchPoints > 0 && safeWidth < 1180) {
    return DEVICE_TYPES.TABLET;
  }

  if (safeWidth < 1024) {
    return DEVICE_TYPES.TABLET;
  }

  return DEVICE_TYPES.DESKTOP;
}

/**
 * Detects the active device type from a browser-like window object.
 */
export function detectDeviceType(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return DEVICE_TYPES.DESKTOP;

  const docWidth = win.document?.documentElement?.clientWidth;
  const width = Number(win.innerWidth) > 0 ? Number(win.innerWidth) : (Number(docWidth) > 0 ? Number(docWidth) : 1024);
  const pointerCoarse = Boolean(win.matchMedia?.('(pointer: coarse)')?.matches);
  const maxTouchPoints = Number(win.navigator?.maxTouchPoints || 0);
  const ua = String(win.navigator?.userAgent || '');
  const isNative = isCapacitorNative(win);

  return classifyDeviceType({ width, pointerCoarse, maxTouchPoints, ua, isNative });
}

/**
 * Maps a device type to its idiomatic navigation profile.
 * Pure function: deviceType -> NavigationProfile
 */
export function getNavigationProfile(deviceType = DEVICE_TYPES.MOBILE) {
  if (deviceType === DEVICE_TYPES.DESKTOP) {
    return {
      deviceType: DEVICE_TYPES.DESKTOP,
      navLayout: NAV_LAYOUTS.SIDE_RAIL,
      showFullLabels: true,
      showKeyboardHints: true,
      shellClass: 'app-shell--desktop',
      navClass: 'app-nav app-nav--sidebar',
    };
  }

  if (deviceType === DEVICE_TYPES.TABLET) {
    return {
      deviceType: DEVICE_TYPES.TABLET,
      navLayout: NAV_LAYOUTS.TOP_BAR,
      showFullLabels: true,
      showKeyboardHints: false,
      shellClass: 'app-shell--tablet',
      navClass: 'app-nav app-nav--top',
    };
  }

  return {
    deviceType: DEVICE_TYPES.MOBILE,
    navLayout: NAV_LAYOUTS.BOTTOM_BAR,
    showFullLabels: false,
    showKeyboardHints: false,
    shellClass: 'app-shell--mobile',
    navClass: 'mobile-bottom-nav app-nav app-nav--bottom',
  };
}

/**
 * Resolves desktop keyboard shortcut (Alt+1..3) into a valid route id,
 * ignoring events inside editable form controls.
 */
export function resolveRouteShortcutKey(event) {
  if (!event || !event.altKey || event.ctrlKey || event.metaKey) return null;
  const target = event.target;
  const tag = String(target?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
    return null;
  }

  if (event.key === '1') return 'entry';
  if (event.key === '2') return 'dashboard';
  if (event.key === '3') return 'categories';
  return null;
}

/**
 * Reactive controller watching viewport & pointer capability changes and notifying
 * only when the device navigation profile transitions.
 */
export function createDeviceNavigationController({
  win = typeof window !== 'undefined' ? window : null,
  onChange,
} = {}) {
  let currentProfile = getNavigationProfile(detectDeviceType(win));

  const evaluate = () => {
    const nextProfile = getNavigationProfile(detectDeviceType(win));
    if (
      nextProfile.deviceType !== currentProfile.deviceType
      || nextProfile.navLayout !== currentProfile.navLayout
    ) {
      currentProfile = nextProfile;
      onChange?.(currentProfile);
    }
  };

  const pointerQuery = win?.matchMedia?.('(pointer: coarse)') || null;
  if (win?.addEventListener) {
    win.addEventListener('resize', evaluate);
  }
  pointerQuery?.addEventListener?.('change', evaluate);

  return {
    getProfile: () => ({ ...currentProfile }),
    refresh: evaluate,
    destroy: () => {
      if (win?.removeEventListener) {
        win.removeEventListener('resize', evaluate);
      }
      pointerQuery?.removeEventListener?.('change', evaluate);
    },
  };
}
