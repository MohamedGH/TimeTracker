import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidCoordinates,
  normalizeLocation,
  formatCoordinates,
  haversineMeters,
  captureCurrentLocation,
  filterGeolocatedEntries,
  clusterOrGroupLocations,
  buildGeoRoutePath,
  computeGeoStats,
  GOOGLE_MAPS_USAGE_ATTRIBUTION_ID,
  DEFAULT_GOOGLE_MAPS_MAP_ID,
  QUOTA_HELP_URL,
  getGoogleMapsApiKey,
  getGoogleMapsMapId,
  installMapsQuotaListener,
  loadGoogleMapsLibraries,
  resetMapsLoaderForTests,
} from '../src/core/geo/index.js';
import { createTimeEntry, isTimeEntry as isDomainTimeEntry } from '../src/core/time-entry.js';
import { createActiveTimer, timerToEntry } from '../src/core/timer.js';
import { normalizeEntries, validateBackup } from '../src/core/model.js';
import { splitEntryByDay } from '../src/core/time.js';
import { serializeSyncPayload, parseSyncPayload, mergeSyncPayloads } from '../src/core/sync/crdt-merge.js';
import { reconcileNativeTimerSnapshot } from '../src/core/mobile/quick-tiles.js';
import { normalizeError, createErrorManager } from '../src/core/error-manager.js';

describe('Geo coordinate validation, normalization & distance', () => {
  it('validates finite lat/lng bounds strictly', () => {
    expect(isValidCoordinates({ lat: 48.8566, lng: 2.3522 })).toBe(true);
    expect(isValidCoordinates({ lat: -90, lng: 180 })).toBe(true);
    expect(isValidCoordinates({ lat: 90.001, lng: 0 })).toBe(false);
    expect(isValidCoordinates({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidCoordinates({ lat: '48.85', lng: '2.35' })).toBe(false);
    expect(isValidCoordinates(null)).toBe(false);
  });

  it('normalizes precision to 6 decimals and preserves clean metadata', () => {
    const loc = normalizeLocation({
      lat: 48.8566141234,
      lng: 2.3522219876,
      accuracy: 14.7,
      capturedAt: ' 2026-11-22T09:00:00Z ',
      source: 'gps',
    });
    expect(loc).toEqual({
      lat: 48.856614,
      lng: 2.352222,
      accuracy: 15,
      capturedAt: '2026-11-22T09:00:00Z',
      source: 'gps',
    });
    expect(normalizeLocation({ lat: NaN, lng: 2.35 })).toBeNull();
    expect(formatCoordinates(loc, 3)).toBe('48.857, 2.352');
  });

  it('computes Haversine distance accurately between Paris landmarks', () => {
    const notreDame = { lat: 48.853, lng: 2.3499 };
    const louvre = { lat: 48.8606, lng: 2.3376 };
    const dist = haversineMeters(notreDame, louvre);
    expect(dist).toBeGreaterThan(1100);
    expect(dist).toBeLessThan(1400);
    expect(haversineMeters(notreDame, { lat: 48.853, lng: 2.3499 })).toBe(0);
    expect(haversineMeters(notreDame, null)).toBe(Infinity);
  });
});

describe('Non-blocking geolocation capture', () => {
  it('captures current position when geolocation succeeds', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 48.8566123,
            longitude: 2.3522219,
            accuracy: 11.4,
          },
        });
      }),
    };
    const res = await captureCurrentLocation({
      geolocation: mockGeo,
      nowIso: () => '2026-11-22T10:15:00.000Z',
    });
    expect(res).toEqual({
      ok: true,
      reason: 'ok',
      location: {
        lat: 48.856612,
        lng: 2.352222,
        accuracy: 11,
        capturedAt: '2026-11-22T10:15:00.000Z',
        source: 'gps',
      },
    });
  });

  it('degrades gracefully when permission is denied, times out, or API is missing', async () => {
    const denied = await captureCurrentLocation({
      geolocation: {
        getCurrentPosition: (_ok, err) => err({ code: 1 }),
      },
    });
    expect(denied).toEqual({ ok: false, location: null, reason: 'denied' });

    const timedOut = await captureCurrentLocation({
      geolocation: {
        getCurrentPosition: (_ok, err) => err({ code: 3 }),
      },
    });
    expect(timedOut).toEqual({ ok: false, location: null, reason: 'timeout' });

    const unsupported = await captureCurrentLocation({ geolocation: null });
    expect(unsupported).toEqual({ ok: false, location: null, reason: 'unsupported' });
  });
});

describe('Period/category filtering, clustering & chronological route', () => {
  const categories = [
    { id: 'spirit', label: 'Spiritualité', color: '#3F7068', parentId: null },
    { id: 'mosque', label: 'Mosquée', color: '#5C7A5E', parentId: 'spirit' },
    { id: 'travail', label: 'Travail', color: '#8C6329', parentId: null },
  ];

  const entries = [
    {
      id: 'e1',
      activity: 'Mosquée trajet',
      categoryId: 'mosque',
      date: '2026-11-22',
      start: '06:00',
      end: '06:15',
      mins: 15,
      location: { lat: 48.8566, lng: 2.3522, source: 'gps' },
    },
    {
      id: 'e2',
      activity: 'Mosquée prière',
      categoryId: 'mosque',
      date: '2026-11-22',
      start: '06:15',
      end: '06:35',
      mins: 20,
      location: { lat: 48.8567, lng: 2.3523, source: 'gps' }, // ~13m away -> same cluster
    },
    {
      id: 'e3',
      activity: 'Deep work',
      categoryId: 'travail',
      date: '2026-11-20',
      start: '09:00',
      end: '11:00',
      mins: 120,
      location: { lat: 48.8738, lng: 2.295, source: 'gps' }, // ~4.6 km away -> separate cluster
    },
    {
      id: 'e4',
      activity: 'Lecture ancienne',
      categoryId: 'spirit',
      date: '2026-10-01',
      start: '20:00',
      end: '20:30',
      mins: 30,
      location: { lat: 48.8501, lng: 2.3401, source: 'gps' },
    },
    {
      id: 'e5',
      activity: 'Sans GPS',
      categoryId: 'travail',
      date: '2026-11-22',
      start: '12:00',
      end: '12:30',
      mins: 30,
    },
  ];

  it('filters geolocated entries by period and hierarchical category', () => {
    const last7 = filterGeolocatedEntries(entries, '7', '2026-11-22', { categoryId: 'all', categories });
    expect(last7.map(e => e.id)).toEqual(['e1', 'e2', 'e3']);

    const todayOnly = filterGeolocatedEntries(entries, 'today', '2026-11-22', { categoryId: 'all', categories });
    expect(todayOnly.map(e => e.id)).toEqual(['e1', 'e2']);

    // Parent category rolls up descendant child entries
    const parentSpiritAll = filterGeolocatedEntries(entries, 'all', '2026-11-22', {
      categoryId: 'spirit',
      categories,
    });
    expect(parentSpiritAll.map(e => e.id)).toEqual(['e1', 'e2', 'e4']);
  });

  it('clusters nearby points within 65m and aggregates activities/durations', () => {
    const filtered = filterGeolocatedEntries(entries, '7', '2026-11-22', { categories });
    const clusters = clusterOrGroupLocations(filtered, categories);
    expect(clusters).toHaveLength(2);

    const mosqueCluster = clusters.find(c => c.sessionCount === 2);
    expect(mosqueCluster).toBeTruthy();
    expect(mosqueCluster.totalMins).toBe(35);
    expect(mosqueCluster.primaryCategoryId).toBe('mosque');
    expect(mosqueCluster.glyphText).toBe('2');
    expect(mosqueCluster.activitiesBreakdown.map(a => a.name)).toContain('Mosquée prière');
    expect(mosqueCluster.activitiesBreakdown.map(a => a.name)).toContain('Mosquée trajet');
  });

  it('builds chronological route polyline deduplicating adjacent nearby stops', () => {
    const filtered = filterGeolocatedEntries(entries, '7', '2026-11-22', { categories });
    const route = buildGeoRoutePath(filtered);
    // Chronologically e3 (2026-11-20) comes first, then e1/e2 (2026-11-22, collapsed because <25m apart)
    expect(route.stopsCount).toBe(2);
    expect(route.path[0]).toEqual({ lat: 48.8738, lng: 2.295 });
    expect(route.path[1]).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(route.totalDistanceMeters).toBeGreaterThan(4000);
  });

  it('computes accurate geo coverage statistics', () => {
    const periodEntries = entries.filter(e => e.date >= '2026-11-16');
    const geolocatedPeriodEntries = filterGeolocatedEntries(entries, '7', '2026-11-22', { categories });
    const clusters = clusterOrGroupLocations(geolocatedPeriodEntries, categories);
    const stats = computeGeoStats({
      allEntries: entries,
      periodEntries,
      geolocatedPeriodEntries,
      clusters,
    });
    expect(stats.totalPeriodEntries).toBe(4);
    expect(stats.geolocatedPeriodEntriesCount).toBe(3);
    expect(stats.coveragePercent).toBe(75);
    expect(stats.placesCount).toBe(2);
    expect(stats.totalAllGeolocatedCount).toBe(4);
  });
});

describe('Canonical preservation across TimeEntry, Timer, Backup, Sync, QuickTiles & Errors', () => {
  const sampleLoc = { lat: 48.856614, lng: 2.352222, accuracy: 12, source: 'gps' };

  it('preserves normalized location across createTimeEntry, timerToEntry, and splitEntryByDay', () => {
    const entry = createTimeEntry({
      id: 't-1',
      activity: 'Marche',
      categoryId: 'sport',
      date: '2026-11-22',
      start: '23:50',
      end: '00:10',
      mins: 20,
      location: { lat: 48.85661444, lng: 2.35222244, accuracy: 12.2, source: 'gps' },
    });
    expect(isDomainTimeEntry(entry)).toBe(true);
    expect(entry.location).toEqual(sampleLoc);

    const split = splitEntryByDay(entry);
    expect(split).toHaveLength(2);
    expect(split[0].location).toEqual(sampleLoc);
    expect(split[1].location).toEqual(sampleLoc);

    const timer = createActiveTimer({
      activity: 'Code',
      categoryId: 'travail',
      startTime: '10:00',
      date: '2026-11-22',
      startTs: 1000,
      location: sampleLoc,
    });
    const completed = timerToEntry(timer, '10:30', '2026-11-22', 'done-1');
    expect(completed.location).toEqual(sampleLoc);
  });

  it('preserves location through backup normalization, CRDT sync, and QuickTiles reconciliation', () => {
    const normalized = normalizeEntries([
      {
        id: 'e-geo',
        activity: 'Course',
        categoryId: 'sport',
        date: '2026-11-22',
        start: '07:00',
        end: '07:30',
        mins: 30,
        location: sampleLoc,
      },
    ]);
    expect(normalized[0].location).toEqual(sampleLoc);

    const backupCheck = validateBackup({ entries: normalized, activities: [], categories: [] });
    expect(backupCheck.entries[0].location).toEqual(sampleLoc);

    const payloadJson = serializeSyncPayload({
      entries: normalized,
      activities: [],
      categories: [],
      activityTemplates: [],
    });
    const parsed = parseSyncPayload(payloadJson);
    expect(parsed.entries[0].location).toEqual(sampleLoc);

    const merged = mergeSyncPayloads(
      { entries: [], activities: [], categories: [], activityTemplates: [] },
      parsed
    );
    expect(merged.entries[0].location).toEqual(sampleLoc);

    const reconciled = reconcileNativeTimerSnapshot({
      state: { entries: [], activities: [], activeTimer: null, timerUpdatedAt: 0 },
      nativeSnapshot: {
        activeTimer: {
          activity: 'Mosquée',
          categoryId: 'autre',
          date: '2026-11-22',
          startTime: '06:00',
          startTs: Date.now() - 5000,
          location: sampleLoc,
        },
        pendingEntries: [
          {
            id: 'nat-1',
            activity: 'Trajet',
            categoryId: 'transport',
            date: '2026-11-22',
            start: '05:45',
            end: '06:00',
            mins: 15,
            location: sampleLoc,
          },
        ],
        activeTimerUpdatedAt: Date.now(),
      },
    });
    expect(reconciled.activeTimer.location).toEqual(sampleLoc);
    expect(reconciled.entries[0].location).toEqual(sampleLoc);
  });

  it('normalizes geo and map errors clearly via ErrorManager', () => {
    const em = createErrorManager();
    expect(normalizeError(new Error(''), 'geo').message).toContain('géographiques');
    expect(normalizeError(new Error(''), 'map').message).toContain('carte');
    const handled = em.handleError(new Error('Position GPS indisponible'), 'geo');
    expect(handled.message).toBe('Position GPS indisponible');
  });
});

describe('Google Maps loader, attribution ID, and quota listener', () => {
  beforeEach(() => {
    resetMapsLoaderForTests();
    delete window.__TIME_TRACKER_ENV__;
  });

  afterEach(() => {
    delete window.__TIME_TRACKER_ENV__;
  });

  it('resolves API key and default DEMO_MAP_ID safely', () => {
    expect(getGoogleMapsMapId()).toBe(DEFAULT_GOOGLE_MAPS_MAP_ID);
    window.__TIME_TRACKER_ENV__ = {
      GOOGLE_MAPS_API_KEY: '  AIzaTestKey123  ',
      GOOGLE_MAPS_MAP_ID: 'CUSTOM_MAP_99',
    };
    expect(getGoogleMapsApiKey()).toBe('AIzaTestKey123');
    expect(getGoogleMapsMapId()).toBe('CUSTOM_MAP_99');
    expect(GOOGLE_MAPS_USAGE_ATTRIBUTION_ID).toBe('gmp_mcp_codeassist_v1_aistudio');
    expect(QUOTA_HELP_URL).toContain('utm_campaign=gmp_mcp_codeassist_v1_aistudio');
  });

  it('loads core, maps, and marker libraries once via functional loader API', async () => {
    const setOptionsFn = vi.fn();
    const importLibraryFn = vi.fn(async name => ({ libName: name }));

    await expect(loadGoogleMapsLibraries({ apiKey: null, setOptionsFn, importLibraryFn })).rejects.toThrow();

    const libs = await loadGoogleMapsLibraries({
      apiKey: 'AIzaUnitKey',
      setOptionsFn,
      importLibraryFn,
    });
    expect(setOptionsFn).toHaveBeenCalledTimes(1);
    expect(setOptionsFn).toHaveBeenCalledWith({
      key: 'AIzaUnitKey',
      v: 'weekly',
      language: 'fr',
      region: 'FR',
    });
    expect(importLibraryFn).toHaveBeenCalledWith('core');
    expect(importLibraryFn).toHaveBeenCalledWith('maps');
    expect(importLibraryFn).toHaveBeenCalledWith('marker');
    expect(libs.markerLib).toEqual({ libName: 'marker' });

    // Second call reuses configured options without calling setOptions again
    await loadGoogleMapsLibraries({
      apiKey: 'AIzaUnitKey',
      setOptionsFn,
      importLibraryFn,
    });
    expect(setOptionsFn).toHaveBeenCalledTimes(1);
  });

  it('dispatches gmp-quota-exceeded when gm_authFailure or OverQuotaMapError fires', () => {
    const events = [];
    const fakeWin = {
      dispatchEvent: vi.fn(evt => events.push(evt.type)),
    };
    const origConsoleError = console.error;

    installMapsQuotaListener(fakeWin);
    fakeWin.gm_authFailure();
    console.error('Google Maps JavaScript API error: OverQuotaMapError');

    console.error = origConsoleError;
    expect(events).toEqual(['gmp-quota-exceeded', 'gmp-quota-exceeded']);
  });
});
