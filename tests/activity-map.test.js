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
      { id: 'act-1', label: 'Mosquée trajet', categoryId: 'transport', useCount: 2 },
      { id: 'act-2', label: 'Mosquée prière', categoryId: 'autre', useCount: 2 },
    ],
    categories: [
      { id: 'transport', label: 'Transport', color: '#8B93A1', parentId: null, builtin: true },
      { id: 'etude', label: 'Étude', color: '#3F7068', parentId: null, builtin: true },
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

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

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

describe('StateManager geolocation actions', () => {
  it('handles SET_GEO_TRACKING and SET_ACTIVE_TIMER_LOCATION cleanly', () => {
    const base = createBaseState();
    const s1 = appReducer(base, { type: ACTION_TYPES.SET_GEO_TRACKING, payload: true });
    expect(s1.geoTrackingEnabled).toBe(true);

    const s2 = appReducer(s1, {
      type: ACTION_TYPES.START_TIMER,
      payload: {
        activity: 'Lecture',
        categoryId: 'etude',
        date: '2026-11-22',
        startTime: '10:00',
        startTs: 1000,
      },
    });
    expect(s2.activeTimer.location).toBeUndefined();

    const loc = { lat: 48.8566, lng: 2.3522, accuracy: 10, source: 'gps' };
    const s3 = appReducer(s2, {
      type: ACTION_TYPES.SET_ACTIVE_TIMER_LOCATION,
      payload: { startTs: 1000, location: loc },
    });
    expect(s3.activeTimer.location).toEqual(loc);

    const s4 = appReducer(s3, {
      type: ACTION_TYPES.STOP_TIMER,
      payload: { end: '10:30' },
    });
    expect(s4.entries[0].location).toEqual(loc);
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

  it('filters places by period and renders graceful missing-API-key fallback', () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const oldDate = '2024-01-10';
    const entries = [
      {
        id: 'recent-1',
        activity: 'Mosquée prière',
        categoryId: 'autre',
        date: todayIso,
        start: '06:15',
        end: '06:35',
        mins: 20,
        location: { lat: 48.8566, lng: 2.3522, source: 'gps' },
      },
      {
        id: 'old-1',
        activity: 'Voyage ancien',
        categoryId: 'transport',
        date: oldDate,
        start: '14:00',
        end: '15:00',
        mins: 60,
        location: { lat: 45.764, lng: 4.8357, source: 'gps' },
      },
    ];
    const categories = createBaseState().categories;

    const todayCard = renderActivityMapCard({ entries, categories, period: 'today' });
    expect(todayCard.model.clusters).toHaveLength(1);
    expect(todayCard.card.querySelectorAll('.activity-map-place-card')).toHaveLength(1);
    expect(todayCard.card.querySelector('[data-activity-map-missing-key="true"]')).toBeTruthy();

    const allCard = renderActivityMapCard({ entries, categories, period: 'all' });
    expect(allCard.model.clusters).toHaveLength(2);
    expect(allCard.card.querySelectorAll('.activity-map-place-card')).toHaveLength(2);
  });

  it('mounts Google Map with DEMO_MAP_ID, attribution ID, PinElement, AdvancedMarkerElement, InfoWindow & Polyline', async () => {
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
        activity: 'Mosquée trajet',
        categoryId: 'transport',
        date: todayIso,
        start: '06:00',
        end: '06:15',
        mins: 15,
        location: { lat: 48.8566, lng: 2.3522, source: 'gps' },
      },
      {
        id: 'e2',
        activity: 'Mosquée doha',
        categoryId: 'etude',
        date: todayIso,
        start: '06:40',
        end: '07:10',
        mins: 30,
        location: { lat: 48.8666, lng: 2.3622, source: 'gps' },
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
    expect(pinInstances[0].options.glyphText).toBeTruthy();
    expect(markerInstances[0].append).toHaveBeenCalledTimes(1);
    expect(polylineInstances).toHaveLength(1);
    expect(polylineInstances[0].options.path).toHaveLength(2);

    // Click marker opens single InfoWindow safely
    markerInstances[0].listeners.click();
    expect(infoWindowInstances[0].setHeaderContent).toHaveBeenCalledTimes(1);
    expect(infoWindowInstances[0].setContent).toHaveBeenCalledTimes(1);
    expect(infoWindowInstances[0].open).toHaveBeenCalledTimes(1);

    // Destroy cleans up markers & polyline
    destroyActivityMap();
    expect(markerInstances[0].map).toBeNull();
    expect(polylineInstances[0].setMap).toHaveBeenCalledWith(null);
  });
});

describe('UI Chrono Geolocation Opt-in, Capture & Dashboard Map Navigation', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
    destroyActivityMap();
  });

  afterEach(() => {
    destroyActivityMap();
  });

  it('requires explicit opt-in before capturing GPS on timer start and attaches location to stopped entry', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: { latitude: 48.8566, longitude: 2.3522, accuracy: 10 },
        });
      }),
    };

    const { root, state } = mountUI({}, { geolocation: mockGeo });

    // Opt-in toggle starts disabled
    const geoCheckbox = root.querySelector('[data-behavior-target="timer-geo-toggle"]');
    expect(geoCheckbox).toBeTruthy();
    expect(geoCheckbox.checked).toBe(false);

    // Enable GPS capture for chronos
    geoCheckbox.checked = true;
    geoCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();
    expect(state.geoTrackingEnabled).toBe(true);

    // Start a chrono via Quick Start shortcut chip
    const quickChip = root.querySelector('.quick-chip');
    expect(quickChip).toBeTruthy();
    quickChip.click();
    await flushAsync();

    expect(mockGeo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(state.activeTimer).toBeTruthy();
    expect(state.activeTimer.location).toMatchObject({ lat: 48.8566, lng: 2.3522, source: 'gps' });

    // Stop the chrono and confirm saved entry retains coordinates
    const stopBtn = root.querySelector('[data-behavior-target="timer-stop"]');
    expect(stopBtn).toBeTruthy();
    stopBtn.click();
    await flushAsync();

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].location).toMatchObject({ lat: 48.8566, lng: 2.3522, source: 'gps' });

    // Clicking the entry's GPS badge navigates to Dashboard map view
    const mapJumpBtn = root.querySelector('[data-behavior-target="entry-open-map"]');
    expect(mapJumpBtn).toBeTruthy();
    mapJumpBtn.click();
    await flushAsync();

    expect(state.tab).toBe('dashboard');
    expect(root.querySelector('[data-activity-map-card="true"]')).toBeTruthy();
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
