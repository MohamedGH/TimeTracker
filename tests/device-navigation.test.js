import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEVICE_TYPES,
  NAV_LAYOUTS,
  classifyDeviceType,
  detectDeviceType,
  getNavigationProfile,
  resolveRouteShortcutKey,
  createDeviceNavigationController,
} from '../src/core/device-navigation.js';
import { createStateManager } from '../src/core/state-manager.js';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

function createMockWin({
  width = 390,
  pointerCoarse = false,
  maxTouchPoints = 0,
  ua = 'Mozilla/5.0',
} = {}) {
  const listeners = new Map();
  const mqListeners = new Set();
  const mq = {
    matches: pointerCoarse,
    addEventListener: vi.fn((_, fn) => mqListeners.add(fn)),
    removeEventListener: vi.fn((_, fn) => mqListeners.delete(fn)),
  };

  return {
    innerWidth: width,
    navigator: { userAgent: ua, maxTouchPoints },
    document: { documentElement: { clientWidth: width } },
    matchMedia: vi.fn(() => mq),
    addEventListener: vi.fn((ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
    }),
    removeEventListener: vi.fn((ev, fn) => {
      listeners.get(ev)?.delete(fn);
    }),
    triggerResize(nextWidth) {
      this.innerWidth = nextWidth;
      this.document.documentElement.clientWidth = nextWidth;
      listeners.get('resize')?.forEach(fn => fn());
    },
    triggerPointerChange(nextCoarse) {
      mq.matches = nextCoarse;
      mqListeners.forEach(fn => fn());
    },
  };
}

describe('device-navigation pure classifiers & profiles', () => {
  it('classifies mobile, tablet, and desktop across viewport width, touch, and UA', () => {
    expect(classifyDeviceType({ width: 375, pointerCoarse: true, maxTouchPoints: 5 })).toBe(DEVICE_TYPES.MOBILE);
    expect(classifyDeviceType({ width: 820, pointerCoarse: false })).toBe(DEVICE_TYPES.TABLET);
    expect(classifyDeviceType({
      width: 1024,
      pointerCoarse: true,
      maxTouchPoints: 5,
      ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
    })).toBe(DEVICE_TYPES.TABLET);
    expect(classifyDeviceType({
      width: 1100,
      pointerCoarse: true,
      maxTouchPoints: 5,
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet)',
    })).toBe(DEVICE_TYPES.TABLET);
    expect(classifyDeviceType({
      width: 820,
      pointerCoarse: true,
      maxTouchPoints: 5,
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile',
    })).toBe(DEVICE_TYPES.MOBILE);
    expect(classifyDeviceType({
      width: 1366,
      pointerCoarse: false,
      maxTouchPoints: 0,
      ua: 'Mozilla/5.0 (X11; Linux x86_64)',
    })).toBe(DEVICE_TYPES.DESKTOP);
  });

  it('detects device type from window-like object', () => {
    const mobileWin = createMockWin({ width: 412, pointerCoarse: true, maxTouchPoints: 5 });
    const desktopWin = createMockWin({ width: 1440, pointerCoarse: false, maxTouchPoints: 0 });
    expect(detectDeviceType(mobileWin)).toBe(DEVICE_TYPES.MOBILE);
    expect(detectDeviceType(desktopWin)).toBe(DEVICE_TYPES.DESKTOP);
  });

  it('returns distinct navigation profiles for mobile, tablet, and desktop', () => {
    expect(getNavigationProfile(DEVICE_TYPES.MOBILE)).toMatchObject({
      navLayout: NAV_LAYOUTS.BOTTOM_BAR,
      showFullLabels: false,
      showKeyboardHints: false,
    });
    expect(getNavigationProfile(DEVICE_TYPES.TABLET)).toMatchObject({
      navLayout: NAV_LAYOUTS.TOP_BAR,
      showFullLabels: true,
      showKeyboardHints: false,
    });
    expect(getNavigationProfile(DEVICE_TYPES.DESKTOP)).toMatchObject({
      navLayout: NAV_LAYOUTS.SIDE_RAIL,
      showFullLabels: true,
      showKeyboardHints: true,
    });
  });

  it('resolves Alt+1..3 desktop shortcuts while ignoring editable inputs', () => {
    expect(resolveRouteShortcutKey({ altKey: true, key: '1', target: { tagName: 'BODY' } })).toBe('entry');
    expect(resolveRouteShortcutKey({ altKey: true, key: '2', target: { tagName: 'DIV' } })).toBe('dashboard');
    expect(resolveRouteShortcutKey({ altKey: true, key: '3', target: { tagName: 'BUTTON' } })).toBe('categories');
    expect(resolveRouteShortcutKey({ altKey: true, key: '1', target: { tagName: 'INPUT' } })).toBeNull();
    expect(resolveRouteShortcutKey({ altKey: false, key: '1', target: { tagName: 'BODY' } })).toBeNull();
  });

  it('notifies only when device profile actually transitions on resize', () => {
    const win = createMockWin({ width: 390, pointerCoarse: false });
    const onChange = vi.fn();
    const ctrl = createDeviceNavigationController({ win, onChange });

    expect(ctrl.getProfile().deviceType).toBe(DEVICE_TYPES.MOBILE);

    // Stay in mobile range -> no notification
    win.triggerResize(500);
    expect(onChange).not.toHaveBeenCalled();

    // Cross into tablet -> notifies once
    win.triggerResize(800);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(ctrl.getProfile().navLayout).toBe(NAV_LAYOUTS.TOP_BAR);

    // Cross into desktop -> notifies again
    win.triggerResize(1280);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(ctrl.getProfile().navLayout).toBe(NAV_LAYOUTS.SIDE_RAIL);

    ctrl.destroy();
    win.triggerResize(390);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('adaptive device navigation stateManager & UI integration', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('updates deviceType in stateManager', () => {
    const sm = createStateManager();
    sm.actions.setDeviceType(DEVICE_TYPES.TABLET);
    expect(sm.getState().deviceType).toBe(DEVICE_TYPES.TABLET);
  });

  it('adapts navigation DOM structure dynamically between mobile, tablet, and desktop, and supports Alt+2 on desktop', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    let profile = getNavigationProfile(DEVICE_TYPES.MOBILE);
    let onChangeCb = () => {};
    const deviceNavFactory = ({ onChange }) => {
      onChangeCb = onChange;
      return {
        getProfile: () => ({ ...profile }),
        refresh: vi.fn(),
        destroy: vi.fn(),
      };
    };

    const state = {
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
    };

    const ui = createUI({
      root,
      state,
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => true, signOut: vi.fn() },
      deviceNavControllerFactory: deviceNavFactory,
    });

    // 1. Mobile: bottom bar after <main> with short labels and no kbd hints
    expect(root.dataset.deviceType).toBe('mobile');
    expect(root.dataset.navLayout).toBe('bottom-bar');
    const mobileNav = root.querySelector('nav.app-nav--bottom');
    expect(mobileNav).toBeTruthy();
    expect(mobileNav.querySelector('#nav-entry').textContent).toContain('Chrono');
    expect(mobileNav.querySelector('.nav-kbd-hint')).toBeNull();

    // 2. Transition to Tablet: top horizontal bar placed before <main>
    profile = getNavigationProfile(DEVICE_TYPES.TABLET);
    onChangeCb(profile);
    expect(root.dataset.deviceType).toBe('tablet');
    expect(root.dataset.navLayout).toBe('top-bar');
    const tabletNav = root.querySelector('nav.app-nav--top');
    const mainOnTablet = root.querySelector('main.content');
    expect(tabletNav).toBeTruthy();
    expect(tabletNav.compareDocumentPosition(mainOnTablet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabletNav.querySelector('#nav-entry').textContent).toContain('Chrono & Saisie');

    // 3. Transition to Desktop: side rail inside .desktop-workspace with keyboard shortcut hints
    profile = getNavigationProfile(DEVICE_TYPES.DESKTOP);
    onChangeCb(profile);
    expect(root.dataset.deviceType).toBe('desktop');
    expect(root.dataset.navLayout).toBe('side-rail');
    const desktopNav = root.querySelector('.desktop-workspace nav.app-nav--sidebar');
    expect(desktopNav).toBeTruthy();
    expect(desktopNav.querySelectorAll('.nav-kbd-hint')).toHaveLength(3);

    // Alt+2 navigates to dashboard on desktop
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', altKey: true, bubbles: true }));
    expect(state.tab).toBe('dashboard');
    expect(root.querySelector('#nav-dashboard').getAttribute('aria-current')).toBe('page');

    ui.destroy();
    root.remove();
  });
});
