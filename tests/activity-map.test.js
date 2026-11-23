import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { createStateManager, appReducer, ACTION_TYPES } from '../src/core/state-manager.js';
import {
  renderActivityMapCard,
  mountActivityMap,
  destroyActivityMap,
} from '../src/components/map/activity-map.js';
import { GOOGLE_MAPS_USAGE_ATTRIBUTION_ID } from '../src/core/geo/maps-loader.js';

function createBaseState(overrides = {}) {
  return {
    entries: [],
    activities: [
      { id: 'act-1', label: 'Développement', categoryId: 'informatique', useCount: 2 },
      { id: 'act-2', label: 'Mosquée prière', categoryId: 'autre', useCount: 2 },
    ],
    categories: [
      { id: 'informatique', label: 'Informatique', color: '#3F7068', parentId: null, builtin: true },
      { id: 'transport', label: 'Transport', color: '#8B93A1', parentId: null, builtin: true },
      { id: 'autre', label: 'Autre', color: '#948C7E', parentId: null, builtin: true },
    ],
    activityTemplates: [],
    activeTemplateRun: null,
    activeTimer: null,
    timerUpdatedAt: 0,
    quickTilesConfig: null,
    geoTrackingEnabled: false,
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

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 10));

function mountUI(initialOverrides = {}, { geolocation = null, mountMapFn = vi.fn().mockResolvedValue(null) } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const persist = vi.fn().mockResolvedValue(undefined);
  const stateManager = createStateManager({
    initialState: createBaseState(initialOverrides),
    persistFn: persist,
  });
  const state = stateManager.getState();
  const ui = createUI({
    root,
    state,
    stateManager,
    persist,
    geolocation,
    mountMapFn,
    quickTilesBridgeFactory: () => ({
      isNativeAndroid: false,
      getCapabilities: vi.fn().mockResolvedValue({ supported: false, platform: 'web', maxSlots: 6 }),
      getPendingSyncSnapshot: vi.fn().mockResolvedValue({}),
      syncConfiguration: vi.fn().mockResolvedValue(undefined),
      syncActiveTimer: vi.fn().mockResolvedValue(undefined),
      acknowledgePendingEntries: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn().mockResolvedValue({ remove: () => {} }),
    }),
  });
  return { root, state, stateManager, persist, ui, mountMapFn };
}

describe('StateManager geolocation actions (startLocation, endLocation, patch, clear)', () => {
  it('handles SET_GEO_TRACKING, SET_ACTIVE_TIMER_LOCATION, STOP_TIMER, PATCH_ENTRY_LOCATION & CLEAR_ALL_GEO_LOCATIONS', () => {
    const base = createBaseState();
    expect(base.geoTrackingEnabled).toBe(false);

    const s1 = appReducer(base, { type: ACTION_TYPES.SET_GEO_TRACKING, payload: true });
    expect(s1.geoTrackingEnabled).toBe(true);

    const s2 = appReducer(s1, {
      type: ACTION_TYPES.START_TIMER,
      payload: {
        activity: 'Développement',
        categoryId: 'informatique',
        date: '2026-11-23',
        startTime: '09:00',
        startTs: 1000,
      },
    });
    expect(s2.activeTimer.startLocation).toBeUndefined();

    const startLoc = { latitude: 50.6292, longitude: 3.0573, accuracy: 15, source: 'gps' };
    const endLoc = { latitude: 50.63, longitude: 3.058, accuracy: 12, source: 'gps' };

    const s3 = appReducer(s2, {
      type: ACTION_TYPES.SET_ACTIVE_TIMER_LOCATION,
      payload: { startTs: 1000, startLocation: startLoc },
    });
    expect(s3.activeTimer.startLocation).toEqual(startLoc);

    const s4 = appReducer(s3, {
      type: ACTION_TYPES.STOP_TIMER,
      payload: { end: '11:30', endLocation: endLoc },
    });
    expect(s4.entries[0].startLocation).toEqual(startLoc);
    expect(s4.entries[0].endLocation).toEqual(endLoc);

    const entryId = s4.entries[0].id;
    const s5 = appReducer(s4, {
      type: ACTION_TYPES.PATCH_ENTRY_LOCATION,
      payload: { entryId, endLocation: null },
    });
    expect(s5.entries[0].startLocation).toEqual(startLoc);
    expect(s5.entries[0].endLocation).toBeUndefined();

    const s6 = appReducer(s5, { type: ACTION_TYPES.CLEAR_ALL_GEO_LOCATIONS });
    expect(s6.entries[0].startLocation).toBeUndefined();
    expect(s6.entries[0].endLocation).toBeUndefined();
  });
});

describe('Activity Map Component & Google Maps SDK Integration', () => {
  beforeEach(() => {
    destroyActivityMap();
    delete window.__TIME_TRACKER_ENV__;
  });

  afterEach(() => {
    destroyActivityMap();
    delete window.__TIME_TRACKER_ENV__;
  });

  it('filters places by period and pointType and renders missing-key fallback with standard Google Maps links', () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const oldDate = '2024-01-10';
    const entries = [
      {
        id: 'recent-1',
        activity: 'Développement',
        categoryId: 'informatique',
        date: todayIso,
        start: '09:00',
        end: '11:30',
        mins: 150,
        startLocation: { latitude: 50.6292, longitude: 3.0573, accuracy: 15, source: 'gps' },
        endLocation: { latitude: 50.635, longitude: 3.068, accuracy: 12, source: 'gps' },
      },
      {
        id: 'old-1',
        activity: 'Voyage ancien',
        categoryId: 'transport',
        date: oldDate,
        start: '14:00',
        end: '15:00',
        mins: 60,
        startLocation: { latitude: 45.764, longitude: 4.8357, source: 'gps' },
      },
    ];
    const categories = createBaseState().categories;

    const todayCard = renderActivityMapCard({ entries, categories, period: 'today' });
    expect(todayCard.model.clusters).toHaveLength(2); // start cluster + end cluster
    expect(todayCard.card.querySelectorAll('.activity-map-place-card')).toHaveLength(2);
    expect(todayCard.card.querySelector('[data-activity-map-missing-key="true"]')).toBeTruthy();
    const extLinks = todayCard.card.querySelectorAll('[data-behavior-target="map-external-link"]');
    expect(extLinks.length).toBe(2);
    expect(extLinks[0].href).toContain('https://www.google.com/maps/search/?api=1&query=');

    const endOnlyCard = renderActivityMapCard({
      entries,
      categories,
      period: 'today',
      pointTypeFilter: 'end',
    });
    expect(endOnlyCard.model.clusters).toHaveLength(1);
    expect(endOnlyCard.model.clusters[0].markerRole).toBe('end');

    const allCard = renderActivityMapCard({ entries, categories, period: 'all' });
    expect(allCard.model.clusters).toHaveLength(3);
  });

  it('mounts Google Map lazily with distinct start vs end PinElements, AdvancedMarkerElement, InfoWindow & Polyline', async () => {
    window.__TIME_TRACKER_ENV__ = { GOOGLE_MAPS_API_KEY: 'AIzaMockKey' };

    const mapInstances = [];
    const markerInstances = [];
    const pinInstances = [];
    const polylineInstances = [];
    const infoWindowInstances = [];

    class FakeMap {
      constructor(container, options) {
        this.container = container;
        this.options = options;
        this.zoom = options.zoom;
        this.panTo = vi.fn();
        this.setZoom = vi.fn(z => { this.zoom = z; });
        this.getZoom = vi.fn(() => this.zoom);
        this.fitBounds = vi.fn();
        mapInstances.push(this);
      }
    }
    class FakeInfoWindow {
      constructor(options) {
        this.options = options;
        this.setHeaderContent = vi.fn();
        this.setContent = vi.fn();
        this.open = vi.fn();
        this.close = vi.fn();
        infoWindowInstances.push(this);
      }
    }
    class FakePinElement {
      constructor(options) {
        this.options = options;
        pinInstances.push(this);
      }
    }
    class FakeAdvancedMarkerElement {
      constructor(options) {
        this.options = options;
        this.map = options.map;
        this.listeners = {};
        this.append = vi.fn();
        this.addListener = vi.fn((evt, cb) => {
          this.listeners[evt] = cb;
        });
        markerInstances.push(this);
      }
    }
    class FakePolyline {
      constructor(options) {
        this.options = options;
        this.setMap = vi.fn();
        polylineInstances.push(this);
      }
    }
    class FakeLatLngBounds {
      constructor() {
        this.points = [];
      }
      extend(pt) {
        this.points.push(pt);
      }
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const entries = [
      {
        id: 'e1',
        activity: 'Développement',
        categoryId: 'informatique',
        date: todayIso,
        start: '09:00',
        end: '11:30',
        mins: 150,
        startLocation: { latitude: 50.6292, longitude: 3.0573, accuracy: 15, source: 'gps' },
        endLocation: { latitude: 50.635, longitude: 3.068, accuracy: 12, source: 'gps' },
      },
    ];

    const { card, model } = renderActivityMapCard({
      entries,
      categories: createBaseState().categories,
      period: 'today',
      showRoutePath: true,
    });
    const container = card.querySelector('[data-activity-map-canvas="true"]');
    expect(container).toBeTruthy();

    const controller = await mountActivityMap({
      container,
      clusters: model.clusters,
      routePath: model.route.path,
      showRoutePath: true,
      loadLibrariesFn: async () => ({
        coreLib: { LatLngBounds: FakeLatLngBounds },
        mapsLib: { Map: FakeMap, InfoWindow: FakeInfoWindow, Polyline: FakePolyline },
        markerLib: { AdvancedMarkerElement: FakeAdvancedMarkerElement, PinElement: FakePinElement },
      }),
    });

    expect(controller).toBeTruthy();
    expect(mapInstances).toHaveLength(1);
    expect(mapInstances[0].options.mapId).toBe('DEMO_MAP_ID');
    expect(mapInstances[0].options.internalUsageAttributionIds).toEqual([GOOGLE_MAPS_USAGE_ATTRIBUTION_ID]);
    expect(mapInstances[0].fitBounds).toHaveBeenCalledTimes(1);

    expect(markerInstances).toHaveLength(2);
    const glyphs = pinInstances.map(p => p.options.glyphText);
    expect(glyphs).toContain('▶');
    expect(glyphs).toContain('■');
    expect(polylineInstances).toHaveLength(1);
    expect(polylineInstances[0].options.path).toHaveLength(2);

    markerInstances[0].listeners.click();
    expect(infoWindowInstances[0].setHeaderContent).toHaveBeenCalledTimes(1);
    expect(infoWindowInstances[0].setContent).toHaveBeenCalledTimes(1);
    expect(infoWindowInstances[0].open).toHaveBeenCalledTimes(1);

    destroyActivityMap();
    expect(markerInstances[0].map).toBeNull();
    expect(polylineInstances[0].setMap).toHaveBeenCalledWith(null);
  });
});

describe('UI Chrono Opt-in, Non-blocking Start & Stop Capture, Deletion & Dashboard Navigation', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
    destroyActivityMap();
  });

  afterEach(() => {
    destroyActivityMap();
  });

  it('captures both startLocation and endLocation non-blockingly when opted in, and never calls map loader when off', async () => {
    let callIdx = 0;
    const coordsSequence = [
      { latitude: 50.6292, longitude: 3.0573, accuracy: 15 }, // opt-in permission check
      { latitude: 50.6292, longitude: 3.0573, accuracy: 15 }, // chrono start
      { latitude: 50.63, longitude: 3.058, accuracy: 12 }, // chrono stop
    ];
    const mockGeo = {
      getCurrentPosition: vi.fn((success) => {
        const next = coordsSequence[Math.min(callIdx, coordsSequence.length - 1)];
        callIdx += 1;
        success({ coords: next });
      }),
    };
    const mountMapFn = vi.fn().mockResolvedValue(null);

    const { root, state, ui } = mountUI({}, { geolocation: mockGeo, mountMapFn });

    // Never mounts Google Maps before Dashboard map view is opened
    expect(mountMapFn).not.toHaveBeenCalled();

    const geoCheckbox = root.querySelector('[data-behavior-target="timer-geo-toggle"]');
    expect(geoCheckbox).toBeTruthy();
    expect(geoCheckbox.checked).toBe(false);
    expect(geoCheckbox.closest('.geo-consent-row').textContent).toContain(
      'Enregistrer automatiquement la position de mes activités'
    );

    // Enable GPS tracking preference — immediately asks browser permission inside user gesture
    geoCheckbox.checked = true;
    geoCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(mockGeo.getCurrentPosition).toHaveBeenCalledTimes(1);
    await flushAsync();
    expect(state.geoTrackingEnabled).toBe(true);
    expect(root.querySelector('.geo-perm-status')?.textContent).toContain('Permission GPS accordée');

    // Start chrono via Quick Start shortcut chip
    const quickChip = root.querySelector('.quick-chip');
    expect(quickChip).toBeTruthy();
    quickChip.click();
    await flushAsync();

    expect(mockGeo.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(state.activeTimer).toBeTruthy();
    expect(state.activeTimer.startLocation).toMatchObject({
      latitude: 50.6292,
      longitude: 3.0573,
      source: 'gps',
    });

    // Stop chrono — immediately stops without waiting, and attaches endLocation in background
    const stopBtn = root.querySelector('[data-behavior-target="timer-stop"]');
    expect(stopBtn).toBeTruthy();
    stopBtn.click();
    await flushAsync();

    expect(mockGeo.getCurrentPosition).toHaveBeenCalledTimes(3);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].startLocation).toMatchObject({ latitude: 50.6292, longitude: 3.0573 });
    expect(state.entries[0].endLocation).toMatchObject({ latitude: 50.63, longitude: 3.058 });

    // Open Dernières entrées dedicated page to use entry map-jump badge
    root.querySelector('#nav-entries').click();
    await flushAsync();
    expect(state.tab).toBe('entries');

    const mapJumpBtn = root.querySelector('[data-behavior-target="entry-open-map"]');
    expect(mapJumpBtn).toBeTruthy();
    mapJumpBtn.click();
    await flushAsync();

    expect(state.tab).toBe('dashboard');
    expect(root.querySelector('[data-activity-map-card="true"]')).toBeTruthy();

    // Clear all GPS locations via Gestion des données dedicated page while keeping time entries intact
    root.querySelector('#nav-data').click();
    await flushAsync();
    expect(state.tab).toBe('data');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const clearGeoBtn = root.querySelector('[data-behavior-target="data-clear-geo"]');
    expect(clearGeoBtn).toBeTruthy();
    clearGeoBtn.click();
    await flushAsync();
    confirmSpy.mockRestore();

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].startLocation).toBeUndefined();
    expect(state.entries[0].endLocation).toBeUndefined();

    ui.destroy();
  });

  it('continues timer normally and informs user gracefully when geolocation fails, is denied, or blocked by iframe policy', async () => {
    const deniedGeo = {
      getCurrentPosition: vi.fn((_ok, err) => err({ code: 1 })),
    };

    const { root, state, ui } = mountUI({ geoTrackingEnabled: true }, { geolocation: deniedGeo });

    const quickChip = root.querySelector('.quick-chip');
    quickChip.click();
    await flushAsync();

    expect(state.activeTimer).toBeTruthy();
    expect(state.activeTimer.startLocation).toBeUndefined();
    expect(root.textContent).toContain('Permission GPS refusée');

    const stopBtn = root.querySelector('[data-behavior-target="timer-stop"]');
    stopBtn.click();
    await flushAsync();

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].startLocation).toBeUndefined();
    expect(state.entries[0].endLocation).toBeUndefined();

    ui.destroy();

    const policyGeo = {
      getCurrentPosition: vi.fn((_ok, err) =>
        err({ code: 1, message: 'Geolocation has been disabled in this document by permissions policy.' })
      ),
    };
    const { root: root2, ui: ui2 } = mountUI({ geoTrackingEnabled: false }, { geolocation: policyGeo });
    const cb2 = root2.querySelector('[data-behavior-target="timer-geo-toggle"]');
    cb2.checked = true;
    cb2.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();
    expect(root2.querySelector('.geo-perm-status')?.textContent).toContain('aperçu iframe');
    expect(root2.textContent).toContain('aperçu intégré (iframe)');
    ui2.destroy();
  });

  it('displays Google Maps quota warning banner cleanly when gmp-quota-exceeded event fires', async () => {
    const { root, ui } = mountUI({ tab: 'dashboard' });
    expect(root.querySelector('[data-gmp-quota-banner="true"]')).toBeNull();

    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    await flushAsync();

    const banner = root.querySelector('[data-gmp-quota-banner="true"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Google Maps Platform quota reached');
    expect(banner.querySelector('a')?.href).toContain('utm_campaign=gmp_mcp_codeassist_v1_aistudio');

    ui.destroy();
  });
});
