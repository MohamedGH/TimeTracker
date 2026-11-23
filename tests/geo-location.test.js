import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractLatLng,
  isValidCoordinates,
  normalizeLocation,
  toLatLngLiteral,
  formatCoordinates,
  buildGoogleMapsUrl,
  haversineMeters,
  resolveEntryGeoLocations,
  hasEntryGeoLocations,
  stripEntryGeoLocations,
  captureCurrentLocation,
  getGeoPermissionState,
  filterGeolocatedEntries,
  extractLocationPoints,
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
import { createTimeEntry, updateTimeEntry, isTimeEntry as isDomainTimeEntry } from '../src/core/time-entry.js';
import { createActiveTimer, timerToEntry } from '../src/core/timer.js';
import { normalizeEntries, validateBackup } from '../src/core/model.js';
import { splitEntryByDay } from '../src/core/time.js';
import { serializeSyncPayload, parseSyncPayload, mergeSyncPayloads } from '../src/core/sync/crdt-merge.js';
import { syncWithGoogleDrive } from '../src/core/sync/drive-sync.js';
import { chunkSyncPayload, createChunkReassembler } from '../src/core/sync/p2p-sync.js';
import { reconcileNativeTimerSnapshot } from '../src/core/mobile/quick-tiles.js';
import { normalizeError, createErrorManager } from '../src/core/error-manager.js';
import {
  timerStartedPayload,
  timerStoppedPayload,
  timeEntryCreatedPayload,
  timeEntryUpdatedPayload,
  geoTrackingToggledPayload,
} from '../src/core/analytics/events.js';

describe('Geo coordinate validation, normalization & distance', () => {
  it('validates finite latitude/longitude and legacy lat/lng bounds strictly', () => {
    expect(isValidCoordinates({ latitude: 50.6292, longitude: 3.0573 })).toBe(true);
    expect(isValidCoordinates({ lat: 50.6292, lng: 3.0573 })).toBe(true);
    expect(isValidCoordinates({ latitude: -90, longitude: 180 })).toBe(true);
    expect(isValidCoordinates({ latitude: 90.001, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: -181 })).toBe(false);
    expect(isValidCoordinates({ latitude: '50.62', longitude: '3.05' })).toBe(false);
    expect(isValidCoordinates(null)).toBe(false);
    expect(extractLatLng({ latitude: 50.6292, longitude: 3.0573 })).toEqual({ lat: 50.6292, lng: 3.0573 });
  });

  it('normalizes into canonical { latitude, longitude } with 6-decimal precision and preserves legacy compatibility', () => {
    const loc = normalizeLocation({
      lat: 50.6292141234,
      lng: 3.0573219876,
      accuracy: 14.7,
      capturedAt: ' 2026-11-23T09:00:00Z ',
      source: 'gps',
    });
    expect(loc).toEqual({
      latitude: 50.629214,
      longitude: 3.057322,
      accuracy: 15,
      capturedAt: '2026-11-23T09:00:00Z',
      source: 'gps',
    });
    expect(toLatLngLiteral(loc)).toEqual({ lat: 50.629214, lng: 3.057322 });
    expect(normalizeLocation({ latitude: NaN, longitude: 3.05 })).toBeNull();
    expect(formatCoordinates(loc, 3)).toBe('50.629, 3.057');
  });

  it('builds standard Google Maps search and directions URLs', () => {
    const start = { latitude: 50.6292, longitude: 3.0573 };
    const end = { latitude: 50.6355, longitude: 3.0702 };
    expect(buildGoogleMapsUrl(start)).toBe('https://www.google.com/maps/search/?api=1&query=50.6292,3.0573');
    expect(buildGoogleMapsUrl(start, end)).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=50.6292,3.0573&destination=50.6355,3.0702'
    );
    expect(buildGoogleMapsUrl(null, null)).toBeNull();
  });

  it('computes Haversine distance accurately', () => {
    const pointA = { latitude: 50.6292, longitude: 3.0573 };
    const pointB = { latitude: 50.6365, longitude: 3.0702 };
    const dist = haversineMeters(pointA, pointB);
    expect(dist).toBeGreaterThan(1000);
    expect(dist).toBeLessThan(1500);
    expect(haversineMeters(pointA, { latitude: 50.6292, longitude: 3.0573 })).toBe(0);
    expect(haversineMeters(pointA, null)).toBe(Infinity);
  });
});

describe('Non-blocking single-shot geolocation capture (Web & Capacitor native)', () => {
  it('captures current position via Web Geolocation getCurrentPosition without watchPosition', async () => {
    const watchPosition = vi.fn();
    const mockGeo = {
      watchPosition,
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 50.6292123,
            longitude: 3.0573219,
            accuracy: 11.4,
          },
        });
      }),
    };
    const res = await captureCurrentLocation({
      geolocation: mockGeo,
      isNativePlatformFn: () => false,
      nowIso: () => '2026-11-23T09:00:00.000Z',
    });
    expect(watchPosition).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: true,
      reason: 'ok',
      location: {
        latitude: 50.629212,
        longitude: 3.057322,
        accuracy: 11,
        capturedAt: '2026-11-23T09:00:00.000Z',
        source: 'gps',
      },
    });
  });

  it('captures current position via native Capacitor Geolocation when on Android/iOS', async () => {
    const mockCapGeo = {
      checkPermissions: vi.fn().mockResolvedValue({ location: 'prompt' }),
      requestPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
      getCurrentPosition: vi.fn().mockResolvedValue({
        coords: { latitude: 50.6301, longitude: 3.0581, accuracy: 9.2 },
      }),
      watchPosition: vi.fn(),
    };
    const res = await captureCurrentLocation({
      isNativePlatformFn: () => true,
      capacitorGeolocation: mockCapGeo,
      nowIso: () => '2026-11-23T11:30:00.000Z',
    });
    expect(mockCapGeo.checkPermissions).toHaveBeenCalledTimes(1);
    expect(mockCapGeo.requestPermissions).toHaveBeenCalledTimes(1);
    expect(mockCapGeo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(mockCapGeo.watchPosition).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: true,
      reason: 'ok',
      location: {
        latitude: 50.6301,
        longitude: 3.0581,
        accuracy: 9,
        capturedAt: '2026-11-23T11:30:00.000Z',
        source: 'gps',
      },
    });
  });

  it('degrades gracefully when permission is denied, GPS is unavailable, times out, or API is missing', async () => {
    const denied = await captureCurrentLocation({
      isNativePlatformFn: () => false,
      geolocation: { getCurrentPosition: (_ok, err) => err({ code: 1 }) },
    });
    expect(denied).toEqual({ ok: false, location: null, reason: 'denied' });

    const nativeDenied = await captureCurrentLocation({
      isNativePlatformFn: () => true,
      capacitorGeolocation: {
        checkPermissions: vi.fn().mockResolvedValue({ location: 'denied' }),
        getCurrentPosition: vi.fn(),
      },
    });
    expect(nativeDenied).toEqual({ ok: false, location: null, reason: 'denied' });

    const unavailable = await captureCurrentLocation({
      isNativePlatformFn: () => false,
      geolocation: { getCurrentPosition: (_ok, err) => err({ code: 2 }) },
    });
    expect(unavailable).toEqual({ ok: false, location: null, reason: 'unavailable' });

    const timedOut = await captureCurrentLocation({
      isNativePlatformFn: () => false,
      geolocation: { getCurrentPosition: (_ok, err) => err({ code: 3 }) },
    });
    expect(timedOut).toEqual({ ok: false, location: null, reason: 'timeout' });

    const policyBlocked = await captureCurrentLocation({
      isNativePlatformFn: () => false,
      geolocation: {
        getCurrentPosition: (_ok, err) =>
          err({ code: 1, message: 'Geolocation has been disabled in this document by permissions policy.' }),
      },
    });
    expect(policyBlocked).toEqual({ ok: false, location: null, reason: 'policy-blocked' });

    const unsupported = await captureCurrentLocation({
      isNativePlatformFn: () => false,
      geolocation: null,
    });
    expect(unsupported).toEqual({ ok: false, location: null, reason: 'unsupported' });
  });

  it('calls navigator.geolocation.getCurrentPosition synchronously inside user gesture on Web and reports permission state', async () => {
    let calledSynchronously = false;
    const syncGeo = {
      getCurrentPosition: vi.fn((success) => {
        calledSynchronously = true;
        success({ coords: { latitude: 50.6292, longitude: 3.0573, accuracy: 10 } });
      }),
    };
    const promise = captureCurrentLocation({ geolocation: syncGeo });
    expect(calledSynchronously).toBe(true);
    const res = await promise;
    expect(res.ok).toBe(true);

    const perm = await getGeoPermissionState({
      geolocation: syncGeo,
      permissionsApi: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
    });
    expect(perm.state).toBe('prompt');
  });
});

describe('Period/category/pointType filtering, start/end marker clustering & chronological route', () => {
  const categories = [
    { id: 'spirit', label: 'Spiritualité', color: '#3F7068', parentId: null },
    { id: 'mosque', label: 'Mosquée', color: '#5C7A5E', parentId: 'spirit' },
    { id: 'travail', label: 'Travail', color: '#8C6329', parentId: null },
  ];

  const entries = [
    {
      id: 'e1',
      activity: 'Développement',
      categoryId: 'travail',
      date: '2026-11-23',
      start: '09:00',
      end: '11:30',
      mins: 150,
      startLocation: {
        latitude: 50.6292,
        longitude: 3.0573,
        accuracy: 15,
        capturedAt: '2026-11-23T09:00:00Z',
        source: 'gps',
      },
      endLocation: {
        latitude: 50.638,
        longitude: 3.071,
        accuracy: 12,
        capturedAt: '2026-11-23T11:30:00Z',
        source: 'gps',
      },
    },
    {
      id: 'e2',
      activity: 'Mosquée prière',
      categoryId: 'mosque',
      date: '2026-11-22',
      start: '06:15',
      end: '06:35',
      mins: 20,
      // Legacy v1 single location field must remain compatible
      location: { lat: 50.62925, lng: 3.05735, source: 'gps' },
    },
    {
      id: 'e3',
      activity: 'Lecture ancienne',
      categoryId: 'spirit',
      date: '2026-10-01',
      start: '20:00',
      end: '20:30',
      mins: 30,
      startLocation: { latitude: 50.645, longitude: 3.08, source: 'gps' },
    },
    {
      id: 'e4',
      activity: 'Sans GPS',
      categoryId: 'travail',
      date: '2026-11-23',
      start: '12:00',
      end: '12:30',
      mins: 30,
    },
  ];

  it('filters geolocated entries by period, hierarchical category, and point type (all/start/end)', () => {
    const last7 = filterGeolocatedEntries(entries, '7', '2026-11-23', { categoryId: 'all', categories });
    expect(last7.map(e => e.id)).toEqual(['e1', 'e2']);

    const endOnly = filterGeolocatedEntries(entries, '7', '2026-11-23', {
      categoryId: 'all',
      categories,
      pointType: 'end',
    });
    expect(endOnly.map(e => e.id)).toEqual(['e1']);

    const parentSpiritAll = filterGeolocatedEntries(entries, 'all', '2026-11-23', {
      categoryId: 'spirit',
      categories,
    });
    expect(parentSpiritAll.map(e => e.id)).toEqual(['e2', 'e3']);
  });

  it('distinguishes start vs end points and clusters nearby locations cleanly', () => {
    const filtered = filterGeolocatedEntries(entries, '7', '2026-11-23', { categories });
    const points = extractLocationPoints(filtered, categories);
    expect(points).toHaveLength(3); // e1 start, e1 end, e2 legacy->start

    const clusters = clusterOrGroupLocations(filtered, categories);
    // e1.start and e2 (legacy) are ~7m apart -> grouped into 1 start cluster; e1.end is ~1.3km away -> 1 end cluster
    expect(clusters).toHaveLength(2);
    const startCluster = clusters.find(c => c.markerRole === 'start');
    const endCluster = clusters.find(c => c.markerRole === 'end');
    expect(startCluster).toBeTruthy();
    expect(startCluster.sessionCount).toBe(2);
    expect(startCluster.glyphText).toBe('2');
    expect(endCluster).toBeTruthy();
    expect(endCluster.glyphText).toBe('■');
    expect(endCluster.roleLabel).toBe('Arrêt');
  });

  it('builds chronological route polyline across startLocation and endLocation stops', () => {
    const filtered = filterGeolocatedEntries(entries, '7', '2026-11-23', { categories });
    const route = buildGeoRoutePath(filtered);
    // Chronologically e2 (2026-11-22) -> e1.start (2026-11-23, ~7m so collapsed) -> e1.end (1.3km away)
    expect(route.stopsCount).toBe(2);
    expect(route.totalDistanceMeters).toBeGreaterThan(1000);
  });

  it('computes accurate geo coverage statistics including start/end point counts', () => {
    const periodEntries = entries.filter(e => e.date >= '2026-11-17');
    const geolocatedPeriodEntries = filterGeolocatedEntries(entries, '7', '2026-11-23', { categories });
    const clusters = clusterOrGroupLocations(geolocatedPeriodEntries, categories);
    const stats = computeGeoStats({
      allEntries: entries,
      periodEntries,
      geolocatedPeriodEntries,
      clusters,
    });
    expect(stats.totalPeriodEntries).toBe(3);
    expect(stats.geolocatedPeriodEntriesCount).toBe(2);
    expect(stats.coveragePercent).toBe(67);
    expect(stats.startPointsCount).toBe(2);
    expect(stats.endPointsCount).toBe(1);
    expect(stats.placesCount).toBe(2);
    expect(stats.totalAllGeolocatedCount).toBe(3);
  });
});

describe('Preservation across TimeEntry, Timer, Export/Import, Google Drive, P2P, CRDT, QuickTiles & Privacy', () => {
  const startLoc = {
    latitude: 50.6292,
    longitude: 3.0573,
    accuracy: 15,
    capturedAt: '2026-11-23T09:00:00Z',
    source: 'gps',
  };
  const endLoc = {
    latitude: 50.63,
    longitude: 3.058,
    accuracy: 12,
    capturedAt: '2026-11-23T11:30:00Z',
    source: 'gps',
  };

  it('preserves startLocation & endLocation across createTimeEntry, updateTimeEntry, stripEntryGeoLocations, timerToEntry & splitEntryByDay', () => {
    const entry = createTimeEntry({
      id: 'entry-123',
      activity: 'Développement',
      categoryId: 'informatique',
      date: '2026-11-23',
      start: '23:50',
      end: '00:10',
      mins: 20,
      startLocation: startLoc,
      endLocation: endLoc,
    });
    expect(isDomainTimeEntry(entry)).toBe(true);
    expect(hasEntryGeoLocations(entry)).toBe(true);
    expect(entry.startLocation).toEqual(startLoc);
    expect(entry.endLocation).toEqual(endLoc);

    const edited = updateTimeEntry(entry, { activity: 'Développement Web', endLocation: null });
    expect(edited.startLocation).toEqual(startLoc);
    expect(edited.endLocation).toBeUndefined();

    const stripped = stripEntryGeoLocations(entry);
    expect(hasEntryGeoLocations(stripped)).toBe(false);
    expect(stripped.activity).toBe('Développement');

    const split = splitEntryByDay(entry);
    expect(split).toHaveLength(2);
    expect(split[0].startLocation).toEqual(startLoc);
    expect(split[0].endLocation).toEqual(endLoc);
    expect(split[1].startLocation).toEqual(startLoc);
    expect(split[1].endLocation).toEqual(endLoc);

    const timer = createActiveTimer({
      activity: 'Code',
      categoryId: 'travail',
      startTime: '09:00',
      date: '2026-11-23',
      startTs: 1000,
      startLocation: startLoc,
    });
    const completed = timerToEntry(timer, '11:30', '2026-11-23', 'done-1', endLoc);
    expect(completed.startLocation).toEqual(startLoc);
    expect(completed.endLocation).toEqual(endLoc);
  });

  it('keeps old entries without coordinates and legacy v1 entries 100% compatible', () => {
    const normalized = normalizeEntries([
      {
        id: 'old-no-geo',
        activity: 'Lecture',
        categoryId: null,
        date: '2025-01-10',
        start: '10:00',
        end: '10:30',
        mins: 30,
      },
      {
        id: 'legacy-v1-geo',
        activity: 'Marche',
        categoryId: null,
        date: '2026-11-01',
        start: '14:00',
        end: '14:30',
        mins: 30,
        location: { lat: 50.6292, lng: 3.0573, accuracy: 20, source: 'gps' },
      },
    ]);
    expect(hasEntryGeoLocations(normalized[0])).toBe(false);
    expect(normalized[0].startLocation).toBeUndefined();
    expect(resolveEntryGeoLocations(normalized[1]).startLocation).toMatchObject({
      latitude: 50.6292,
      longitude: 3.0573,
      accuracy: 20,
      source: 'gps',
    });
  });

  it('preserves startLocation & endLocation across Export/Import JSON, Google Drive, P2P chunking, CRDT merge & QuickTiles', async () => {
    const entry = createTimeEntry({
      id: 'e-geo',
      activity: 'Course',
      categoryId: 'sport',
      date: '2026-11-23',
      start: '09:00',
      end: '11:30',
      mins: 150,
      startLocation: startLoc,
      endLocation: endLoc,
    });

    // Export / Import JSON round-trip
    const backupJson = JSON.stringify({ entries: [entry], activities: [], categories: [] });
    const parsedBackup = JSON.parse(backupJson);
    const validatedBackup = validateBackup(parsedBackup);
    expect(validatedBackup.entries[0].startLocation).toEqual(startLoc);
    expect(validatedBackup.entries[0].endLocation).toEqual(endLoc);

    // CRDT serialize / merge
    const payloadJson = serializeSyncPayload({
      entries: [entry],
      activities: [],
      categories: [],
      activityTemplates: [],
    });
    const parsedSync = parseSyncPayload(payloadJson);
    expect(parsedSync.entries[0].startLocation).toEqual(startLoc);
    expect(parsedSync.entries[0].endLocation).toEqual(endLoc);

    const merged = mergeSyncPayloads(
      { entries: [], activities: [], categories: [], activityTemplates: [] },
      parsedSync
    );
    expect(merged.entries[0].startLocation).toEqual(startLoc);
    expect(merged.entries[0].endLocation).toEqual(endLoc);

    // P2P chunking / reassembly round-trip
    const frames = chunkSyncPayload(parsedSync, 180, 'tx_test');
    let reassembled = null;
    const receive = createChunkReassembler((data) => {
      reassembled = data;
    });
    frames.forEach(f => receive(f));
    expect(reassembled.entries[0].startLocation).toEqual(startLoc);
    expect(reassembled.entries[0].endLocation).toEqual(endLoc);

    // Google Drive upload / merge round-trip
    let uploadedBody = null;
    const mockFetch = vi.fn(async (url, opts) => {
      if (url.includes('/drive/v3/files?spaces=appDataFolder')) {
        return { ok: true, json: async () => ({ files: [{ id: 'file-1' }] }) };
      }
      if (url.includes('alt=media')) {
        return { ok: true, text: async () => payloadJson };
      }
      uploadedBody = opts.body;
      return { ok: true, json: async () => ({ id: 'file-1', modifiedTime: '2026-11-23T12:00:00Z' }) };
    });

    let applied = null;
    await syncWithGoogleDrive({
      authClient: { ensureAccessToken: vi.fn().mockResolvedValue('tok_test') },
      getLocalPayload: () => ({ entries: [], activities: [], categories: [], tombstones: {} }),
      applyMergedPayload: async (m) => { applied = m; },
      fetchImpl: mockFetch,
    });
    expect(applied.entries[0].startLocation).toEqual(startLoc);
    expect(applied.entries[0].endLocation).toEqual(endLoc);
    expect(uploadedBody).toContain('"startLocation"');
    expect(uploadedBody).toContain('"endLocation"');

    // QuickTiles reconciliation
    const reconciled = reconcileNativeTimerSnapshot({
      state: { entries: [], activities: [], activeTimer: null, timerUpdatedAt: 0 },
      nativeSnapshot: {
        activeTimer: {
          activity: 'Développement',
          categoryId: 'informatique',
          date: '2026-11-23',
          startTime: '09:00',
          startTs: Date.now() - 5000,
          startLocation: startLoc,
        },
        pendingEntries: [entry],
        activeTimerUpdatedAt: Date.now(),
      },
    });
    expect(reconciled.activeTimer.startLocation).toEqual(startLoc);
    expect(reconciled.entries[0].startLocation).toEqual(startLoc);
    expect(reconciled.entries[0].endLocation).toEqual(endLoc);
  });

  it('never leaks GPS coordinates into Google Analytics payloads', () => {
    const p1 = timerStartedPayload({ hasCategory: true, hasLocation: true, startLocation: startLoc });
    const p2 = timerStoppedPayload({ durationMinutes: 25, hasCategory: true, hasLocation: true, endLocation: endLoc });
    const p3 = timeEntryCreatedPayload({ durationMinutes: 25, hasCategory: true, hasLocation: true, startLocation: startLoc });
    const p4 = timeEntryUpdatedPayload({ durationMinutes: 25, hasCategory: true, hasLocation: true, endLocation: endLoc });
    const p5 = geoTrackingToggledPayload({ enabled: true });

    for (const payload of [p1, p2, p3, p4, p5]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain('50.6292');
      expect(json).not.toContain('3.0573');
      expect(json).not.toContain('latitude');
      expect(json).not.toContain('longitude');
    }
  });

  it('normalizes geo and map errors clearly via ErrorManager', () => {
    const em = createErrorManager();
    expect(normalizeError(new Error(''), 'geo').message).toContain('géographiques');
    expect(normalizeError(new Error(''), 'map').message).toContain('carte');
    const handled = em.handleError(new Error('Position GPS indisponible'), 'geo');
    expect(handled.message).toBe('Position GPS indisponible');
  });
});

describe('Google Maps lazy loader, attribution ID, and quota listener', () => {
  beforeEach(() => {
    resetMapsLoaderForTests();
    delete window.__TIME_TRACKER_ENV__;
  });

  afterEach(() => {
    delete window.__TIME_TRACKER_ENV__;
  });

  it('resolves API key and default DEMO_MAP_ID without confusing with GOOGLE_CLIENT_ID', () => {
    expect(getGoogleMapsMapId()).toBe(DEFAULT_GOOGLE_MAPS_MAP_ID);
    window.__TIME_TRACKER_ENV__ = {
      GOOGLE_CLIENT_ID: '123456-oauth.apps.googleusercontent.com',
      GOOGLE_MAPS_API_KEY: '  AIzaTestKey123  ',
      GOOGLE_MAPS_MAP_ID: 'CUSTOM_MAP_99',
    };
    expect(getGoogleMapsApiKey()).toBe('AIzaTestKey123');
    expect(getGoogleMapsMapId()).toBe('CUSTOM_MAP_99');
    expect(GOOGLE_MAPS_USAGE_ATTRIBUTION_ID).toBe('gmp_mcp_codeassist_v1_aistudio');
    expect(QUOTA_HELP_URL).toContain('utm_campaign=gmp_mcp_codeassist_v1_aistudio');
  });

  it('loads core, maps, and marker libraries lazily via functional loader API', async () => {
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
