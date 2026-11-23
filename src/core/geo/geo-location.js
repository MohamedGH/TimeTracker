/**
 * Geolocation & Spatial Activity Domain Module.
 * Pure functional utilities for coordinate normalization (startLocation / endLocation
 * + legacy location compatibility), non-blocking single-shot Web & Capacitor GPS capture,
 * period/category/point-type filtering, spatial clustering, and standard Google Maps URLs.
 */

import { filterEntriesByPeriod, formatDuration } from '../statistics.js';
import { getDescendants } from '../category-tree.js';
import { today } from '../time.js';

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_CLUSTER_RADIUS_METERS = 45;

/**
 * Extracts raw { lat, lng } numbers from either `{ latitude, longitude }` or `{ lat, lng }`.
 * Pure function.
 */
export function extractLatLng(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = typeof loc.latitude === 'number' ? loc.latitude : loc.lat;
  const lng = typeof loc.longitude === 'number' ? loc.longitude : loc.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Validates raw coordinate objects cleanly without coercing empty strings.
 * Accepts both `{ latitude, longitude }` and `{ lat, lng }`.
 * Pure function.
 */
export function isValidCoordinates(loc) {
  const pair = extractLatLng(loc);
  if (!pair) return false;
  return pair.lat >= -90 && pair.lat <= 90 && pair.lng >= -180 && pair.lng <= 180;
}

/**
 * Normalizes coordinate into canonical TimeTracker format:
 * `{ latitude, longitude, accuracy?, capturedAt?, source }`.
 * Rounds coordinates to 6 decimal places (~11 cm precision).
 * Pure function.
 */
export function normalizeLocation(loc) {
  const pair = extractLatLng(loc);
  if (!pair || !isValidCoordinates(loc)) return null;

  const latitude = Math.round(pair.lat * 1e6) / 1e6;
  const longitude = Math.round(pair.lng * 1e6) / 1e6;
  const accuracy = typeof loc.accuracy === 'number' && Number.isFinite(loc.accuracy) && loc.accuracy >= 0
    ? Math.round(loc.accuracy)
    : null;
  const capturedAt = typeof loc.capturedAt === 'string' && loc.capturedAt.trim()
    ? loc.capturedAt.trim()
    : null;
  const source = loc.source === 'manual' ? 'manual' : 'gps';

  return {
    latitude,
    longitude,
    ...(accuracy !== null ? { accuracy } : {}),
    ...(capturedAt ? { capturedAt } : {}),
    source,
  };
}

/**
 * Converts a normalized or legacy location into a Google Maps POJO `{ lat, lng }`.
 * Pure function.
 */
export function toLatLngLiteral(loc) {
  const normalized = normalizeLocation(loc);
  if (!normalized) return null;
  return { lat: normalized.latitude, lng: normalized.longitude };
}

/**
 * Formats coordinates into compact readable text (e.g., "50.6292, 3.0573").
 * Pure function.
 */
export function formatCoordinates(loc, decimals = 4) {
  const normalized = normalizeLocation(loc);
  if (!normalized) return '';
  return `${normalized.latitude.toFixed(decimals)}, ${normalized.longitude.toFixed(decimals)}`;
}

/**
 * Builds a standard Google Maps URL so positions can always be viewed externally
 * even without a Google Maps JavaScript API key.
 * Pure function.
 */
export function buildGoogleMapsUrl(startLoc, endLoc = null) {
  const start = normalizeLocation(startLoc);
  const end = normalizeLocation(endLoc);

  if (start && end && haversineMeters(start, end) >= 20) {
    return `https://www.google.com/maps/dir/?api=1&origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}`;
  }
  const target = start || end;
  if (!target) return null;
  return `https://www.google.com/maps/search/?api=1&query=${target.latitude},${target.longitude}`;
}

/**
 * Calculates great-circle distance in meters using the Haversine formula.
 * Pure function.
 */
export function haversineMeters(a, b) {
  const pa = extractLatLng(a);
  const pb = extractLatLng(b);
  if (!pa || !pb || !isValidCoordinates(a) || !isValidCoordinates(b)) return Infinity;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(pb.lat - pa.lat);
  const dLng = toRad(pb.lng - pa.lng);
  const lat1 = toRad(pa.lat);
  const lat2 = toRad(pb.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Resolves `startLocation` and `endLocation` from any entry (including older v1 entries
 * that used a single `location` field).
 * Pure function.
 */
export function resolveEntryGeoLocations(entry) {
  const startLocation = normalizeLocation(entry?.startLocation ?? entry?.location ?? null);
  const endLocation = normalizeLocation(entry?.endLocation ?? null);
  return { startLocation, endLocation };
}

/**
 * Returns whether an entry has at least one valid coordinate (start or end).
 * Pure function.
 */
export function hasEntryGeoLocations(entry) {
  const { startLocation, endLocation } = resolveEntryGeoLocations(entry);
  return Boolean(startLocation || endLocation);
}

/**
 * Returns a copy of the entry with all geographic fields removed.
 * Pure function.
 */
export function stripEntryGeoLocations(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const { startLocation: _s, endLocation: _e, location: _l, ...rest } = entry;
  return rest;
}

function classifyGeoError(err) {
  const code = Number(err?.code);
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('permissions policy') || msg.includes('feature policy')) return 'policy-blocked';
  if (msg.includes('secure origin') || msg.includes('only secure')) return 'insecure-origin';
  if (code === 1 || msg.includes('denied') || msg.includes('permission')) return 'denied';
  if (code === 3 || msg.includes('timeout')) return 'timeout';
  if (msg.includes('not implemented') || msg.includes('unsupported')) return 'unsupported';
  return 'unavailable';
}

function isRunningInIframe() {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Inspects current geolocation permission status without triggering a prompt.
 * Returns `{ state, inIframe, isSecureContext }`.
 */
export async function getGeoPermissionState({
  geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null,
  permissionsApi = typeof navigator !== 'undefined' ? navigator.permissions : null,
  isNativePlatformFn = null,
  capacitorGeolocation = null,
} = {}) {
  const inIframe = isRunningInIframe();
  const isSecureContext = typeof window === 'undefined' ? true : window.isSecureContext !== false;
  const globalCap = typeof window !== 'undefined' ? window.Capacitor : null;
  const isNative = typeof isNativePlatformFn === 'function'
    ? Boolean(isNativePlatformFn())
    : Boolean(globalCap?.isNativePlatform?.());

  if (isNative || capacitorGeolocation) {
    try {
      let plugin = capacitorGeolocation;
      if (!plugin) {
        const mod = await import('@capacitor/geolocation');
        plugin = mod?.Geolocation || null;
      }
      if (plugin && typeof plugin.checkPermissions === 'function') {
        const perm = await plugin.checkPermissions();
        const raw = perm?.location || perm?.coarseLocation;
        if (raw === 'granted' || raw === 'denied') {
          return { state: raw, inIframe: false, isSecureContext: true };
        }
        return { state: 'prompt', inIframe: false, isSecureContext: true };
      }
    } catch {
      // fall through to web checks
    }
  }

  if (!isSecureContext) {
    return { state: 'insecure-origin', inIframe, isSecureContext };
  }
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return { state: 'unsupported', inIframe, isSecureContext };
  }

  if (permissionsApi && typeof permissionsApi.query === 'function') {
    try {
      const status = await permissionsApi.query({ name: 'geolocation' });
      if (status?.state === 'granted' || status?.state === 'denied' || status?.state === 'prompt') {
        return { state: status.state, inIframe, isSecureContext };
      }
    } catch {
      // Safari / older WebViews may throw on permissions.query({ name: 'geolocation' })
    }
  }

  return { state: 'prompt', inIframe, isSecureContext };
}

async function captureNativeCapacitorLocation({
  timeoutMs,
  enableHighAccuracy,
  maximumAgeMs,
  nowIso,
  capacitorGeolocation,
}) {
  let plugin = capacitorGeolocation;
  if (!plugin) {
    const mod = await import('@capacitor/geolocation');
    plugin = mod?.Geolocation || null;
  }
  if (!plugin || typeof plugin.getCurrentPosition !== 'function') {
    return { ok: false, location: null, reason: 'unsupported' };
  }

  if (typeof plugin.checkPermissions === 'function') {
    const perm = await plugin.checkPermissions();
    const state = perm?.location || perm?.coarseLocation;
    if (state === 'denied') {
      return { ok: false, location: null, reason: 'denied' };
    }
    if ((state === 'prompt' || state === 'prompt-with-rationale') && typeof plugin.requestPermissions === 'function') {
      const req = await plugin.requestPermissions();
      const nextState = req?.location || req?.coarseLocation;
      if (nextState === 'denied') {
        return { ok: false, location: null, reason: 'denied' };
      }
    }
  }

  const pos = await plugin.getCurrentPosition({
    enableHighAccuracy: Boolean(enableHighAccuracy),
    timeout: Math.max(500, Number(timeoutMs) || 6500),
    maximumAge: Math.max(0, Number(maximumAgeMs) || 0),
  });

  const normalized = normalizeLocation({
    latitude: pos?.coords?.latitude,
    longitude: pos?.coords?.longitude,
    accuracy: pos?.coords?.accuracy,
    capturedAt: nowIso(),
    source: 'gps',
  });
  if (!normalized) {
    return { ok: false, location: null, reason: 'unavailable' };
  }
  return { ok: true, location: normalized, reason: 'ok' };
}

/**
 * Captures a single-shot GPS position without throwing or blocking caller control flow.
 * Uses Capacitor Geolocation on native Android/iOS when available, and Web Geolocation API on browser.
 * Never uses `watchPosition()`. Always resolves with `{ ok, location, reason }`.
 */
export async function captureCurrentLocation({
  geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null,
  isNativePlatformFn = null,
  capacitorGeolocation = null,
  timeoutMs = 6500,
  enableHighAccuracy = true,
  maximumAgeMs = 60000,
  nowIso = () => new Date().toISOString(),
} = {}) {
  const globalCap = typeof window !== 'undefined' ? window.Capacitor : null;
  let isNative = false;
  if (typeof isNativePlatformFn === 'function') {
    isNative = Boolean(isNativePlatformFn());
  } else if (globalCap && typeof globalCap.isNativePlatform === 'function') {
    isNative = Boolean(globalCap.isNativePlatform());
  } else if (!geolocation) {
    try {
      const { Capacitor } = await import('@capacitor/core');
      isNative = Boolean(Capacitor?.isNativePlatform?.());
    } catch {
      isNative = false;
    }
  }

  if (isNative || capacitorGeolocation) {
    try {
      const nativeResult = await captureNativeCapacitorLocation({
        timeoutMs,
        enableHighAccuracy,
        maximumAgeMs,
        nowIso,
        capacitorGeolocation,
      });
      if (nativeResult.ok || nativeResult.reason === 'denied' || nativeResult.reason === 'timeout') {
        return nativeResult;
      }
    } catch (err) {
      const reason = classifyGeoError(err);
      if (reason === 'denied' || reason === 'timeout') {
        return { ok: false, location: null, reason };
      }
      // Fall back to Web geolocation if native plugin threw unavailable
    }
  }

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, location: null, reason: 'insecure-origin' };
  }

  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return { ok: false, location: null, reason: 'unsupported' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(guardTimer);
      resolve(result);
    };

    const guardTimer = setTimeout(() => {
      finish({ ok: false, location: null, reason: 'timeout' });
    }, Math.max(500, Number(timeoutMs) || 6500) + 150);

    try {
      geolocation.getCurrentPosition(
        (pos) => {
          const normalized = normalizeLocation({
            latitude: pos?.coords?.latitude,
            longitude: pos?.coords?.longitude,
            accuracy: pos?.coords?.accuracy,
            capturedAt: nowIso(),
            source: 'gps',
          });
          if (!normalized) {
            finish({ ok: false, location: null, reason: 'unavailable' });
            return;
          }
          finish({ ok: true, location: normalized, reason: 'ok' });
        },
        (err) => {
          finish({ ok: false, location: null, reason: classifyGeoError(err) });
        },
        {
          enableHighAccuracy: Boolean(enableHighAccuracy),
          timeout: Math.max(500, Number(timeoutMs) || 6500),
          maximumAge: Math.max(0, Number(maximumAgeMs) || 0),
        }
      );
    } catch {
      finish({ ok: false, location: null, reason: 'unavailable' });
    }
  });
}

/**
 * Filters entries by dashboard period, optional category hierarchy, point type, and valid location.
 * Pure function.
 */
export function filterGeolocatedEntries(
  entries = [],
  period = '7',
  refDate = today(),
  { categoryId = 'all', categories = [], pointType = 'all' } = {}
) {
  const periodEntries = filterEntriesByPeriod(entries, period, refDate);

  let allowedCategoryIds = null;
  if (categoryId && categoryId !== 'all' && categoryId !== '__uncategorized__') {
    const descendants = getDescendants(categories, categoryId).map(c => c.id);
    allowedCategoryIds = new Set([categoryId, ...descendants]);
  }

  return periodEntries
    .filter((entry) => {
      const { startLocation, endLocation } = resolveEntryGeoLocations(entry);
      if (pointType === 'start' && !startLocation) return false;
      if (pointType === 'end' && !endLocation) return false;
      if (!startLocation && !endLocation) return false;

      if (categoryId === '__uncategorized__') {
        return !entry.categoryId;
      }
      if (allowedCategoryIds) {
        return Boolean(entry.categoryId && allowedCategoryIds.has(entry.categoryId));
      }
      return true;
    })
    .map((entry) => {
      const { startLocation, endLocation } = resolveEntryGeoLocations(entry);
      return {
        ...entry,
        ...(startLocation ? { startLocation } : {}),
        ...(endLocation ? { endLocation } : {}),
      };
    });
}

/**
 * Expands filtered entries into individual geo point records (`start` and `end`)
 * so both start and stop positions can be distinguished on the map and in clusters.
 * Pure function.
 */
export function extractLocationPoints(entries = [], categories = [], { pointType = 'all' } = {}) {
  const categoryMap = new Map((Array.isArray(categories) ? categories : []).map(c => [c.id, c]));
  const points = [];

  for (const entry of entries) {
    const { startLocation, endLocation } = resolveEntryGeoLocations(entry);
    const cat = entry.categoryId ? categoryMap.get(entry.categoryId) : null;
    const base = {
      entryId: entry.id,
      activity: String(entry.activity || 'Activité').trim() || 'Activité',
      categoryId: entry.categoryId ?? null,
      categoryLabel: cat?.label || 'Sans catégorie',
      color: cat?.color || '#948C7E',
      date: entry.date || '',
      start: entry.start || '',
      end: entry.end || '',
      mins: Math.max(0, Number(entry.mins) || 0),
      formattedDuration: formatDuration(Math.max(0, Number(entry.mins) || 0)),
      googleMapsUrl: buildGoogleMapsUrl(startLocation, endLocation),
    };

    if (startLocation && (pointType === 'all' || pointType === 'start')) {
      points.push({
        ...base,
        pointId: `${entry.id}::start`,
        kind: 'start',
        kindLabel: 'Démarrage',
        location: startLocation,
        latitude: startLocation.latitude,
        longitude: startLocation.longitude,
        accuracy: startLocation.accuracy ?? null,
        capturedAt: startLocation.capturedAt ?? null,
        pointMapsUrl: buildGoogleMapsUrl(startLocation),
      });
    }

    if (endLocation && (pointType === 'all' || pointType === 'end')) {
      points.push({
        ...base,
        pointId: `${entry.id}::end`,
        kind: 'end',
        kindLabel: 'Arrêt',
        location: endLocation,
        latitude: endLocation.latitude,
        longitude: endLocation.longitude,
        accuracy: endLocation.accuracy ?? null,
        capturedAt: endLocation.capturedAt ?? null,
        pointMapsUrl: buildGoogleMapsUrl(endLocation),
      });
    }
  }

  return points.sort((a, b) => {
    const ka = `${a.date}T${a.start}`;
    const kb = `${b.date}T${b.start}`;
    if (ka !== kb) return kb.localeCompare(ka);
    return a.kind === 'end' ? -1 : 1;
  });
}

/**
 * Groups nearby geolocated points (within ~45 m) into uncluttered markers while
 * clearly distinguishing Démarrage (`start`), Arrêt (`end`), and combined (`both`) points.
 * Pure function.
 */
export function clusterOrGroupLocations(
  entries = [],
  categories = [],
  { radiusMeters = DEFAULT_CLUSTER_RADIUS_METERS, pointType = 'all' } = {}
) {
  const categoryMap = new Map((Array.isArray(categories) ? categories : []).map(c => [c.id, c]));
  const points = extractLocationPoints(entries, categories, { pointType });

  const rawClusters = [];
  for (const pt of points) {
    let target = null;
    for (const cluster of rawClusters) {
      if (haversineMeters(cluster.anchor, pt.location) <= radiusMeters) {
        target = cluster;
        break;
      }
    }
    if (!target) {
      target = { anchor: pt.location, points: [] };
      rawClusters.push(target);
    }
    target.points.push(pt);
  }

  return rawClusters.map((cluster, idx) => {
    const count = cluster.points.length;
    const sumLat = cluster.points.reduce((s, p) => s + p.latitude, 0);
    const sumLng = cluster.points.reduce((s, p) => s + p.longitude, 0);
    const latitude = Math.round((sumLat / count) * 1e6) / 1e6;
    const longitude = Math.round((sumLng / count) * 1e6) / 1e6;

    const startCount = cluster.points.filter(p => p.kind === 'start').length;
    const endCount = cluster.points.filter(p => p.kind === 'end').length;
    const markerRole = startCount > 0 && endCount > 0 ? 'both' : (endCount > 0 ? 'end' : 'start');
    const roleLabel = markerRole === 'both'
      ? 'Démarrage & Arrêt'
      : markerRole === 'end'
        ? 'Arrêt'
        : 'Démarrage';

    // Deduplicate unique sessions for duration/category totals
    const uniqueEntriesMap = new Map();
    for (const pt of cluster.points) {
      if (!uniqueEntriesMap.has(pt.entryId)) {
        uniqueEntriesMap.set(pt.entryId, pt);
      }
    }
    const uniqueSessions = [...uniqueEntriesMap.values()];
    const totalMins = uniqueSessions.reduce((s, e) => s + e.mins, 0);

    const catTotals = new Map();
    const actMap = new Map();

    for (const session of uniqueSessions) {
      const catKey = session.categoryId || '__uncategorized__';
      catTotals.set(catKey, (catTotals.get(catKey) || 0) + session.mins);

      const actKey = `${session.activity.toLowerCase()}::${catKey}`;
      if (!actMap.has(actKey)) {
        const cat = session.categoryId ? categoryMap.get(session.categoryId) : null;
        actMap.set(actKey, {
          name: session.activity,
          categoryId: session.categoryId ?? null,
          categoryLabel: cat?.label || 'Sans catégorie',
          color: cat?.color || '#948C7E',
          count: 0,
          totalMins: 0,
        });
      }
      const actItem = actMap.get(actKey);
      actItem.count += 1;
      actItem.totalMins += session.mins;
    }

    const dominantCatEntry = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    const dominantCatId = dominantCatEntry && dominantCatEntry[0] !== '__uncategorized__'
      ? dominantCatEntry[0]
      : null;
    const dominantCat = dominantCatId ? categoryMap.get(dominantCatId) : null;
    const color = dominantCat?.color || '#948C7E';
    const primaryCategoryLabel = dominantCat?.label || 'Sans catégorie';

    const activitiesBreakdown = [...actMap.values()]
      .map(item => ({
        ...item,
        formattedTotal: formatDuration(item.totalMins),
      }))
      .sort((a, b) => b.totalMins - a.totalMins || b.count - a.count);

    const primaryActivity = activitiesBreakdown[0]?.name || primaryCategoryLabel;
    const glyphText = count > 1
      ? String(count > 99 ? '99+' : count)
      : (markerRole === 'end' ? '■' : '▶');

    const latest = cluster.points[0];
    return {
      id: `geo_cluster_${idx}_${latitude}_${longitude}`,
      latitude,
      longitude,
      lat: latitude,
      lng: longitude,
      markerRole,
      roleLabel,
      startCount,
      endCount,
      pointCount: count,
      sessionCount: uniqueSessions.length,
      totalMins,
      formattedTotal: formatDuration(totalMins),
      primaryCategoryId: dominantCatId,
      primaryCategoryLabel,
      primaryActivity,
      color,
      glyphText,
      activitiesBreakdown,
      points: cluster.points,
      entries: uniqueSessions.map(s => ({
        id: s.entryId,
        activity: s.activity,
        categoryId: s.categoryId,
        date: s.date,
        start: s.start,
        end: s.end,
        mins: s.mins,
      })),
      latestDate: latest?.date || '',
      latestTime: latest?.start || '',
      coordinatesLabel: formatCoordinates({ latitude, longitude }, 4),
      googleMapsUrl: buildGoogleMapsUrl({ latitude, longitude }),
    };
  });
}

/**
 * Builds an ordered chronological path across startLocation and endLocation coordinates.
 * Consecutive points closer than 25m are collapsed into one stop.
 * Pure function.
 */
export function buildGeoRoutePath(entries = [], { minStepMeters = 25 } = {}) {
  const ordered = [...entries]
    .filter(hasEntryGeoLocations)
    .sort((a, b) => {
      const ka = `${a.date || ''}T${a.start || ''}`;
      const kb = `${b.date || ''}T${b.start || ''}`;
      return ka.localeCompare(kb);
    });

  const path = [];
  let totalDistanceMeters = 0;

  const pushPoint = (loc) => {
    const literal = toLatLngLiteral(loc);
    if (!literal) return;
    const prev = path[path.length - 1];
    if (!prev) {
      path.push(literal);
      return;
    }
    const dist = haversineMeters(prev, literal);
    if (dist >= minStepMeters) {
      totalDistanceMeters += dist;
      path.push(literal);
    }
  };

  for (const entry of ordered) {
    const { startLocation, endLocation } = resolveEntryGeoLocations(entry);
    if (startLocation) pushPoint(startLocation);
    if (endLocation) pushPoint(endLocation);
  }

  return {
    path,
    stopsCount: path.length,
    totalDistanceMeters: Math.round(totalDistanceMeters),
  };
}

/**
 * Computes summary coverage statistics for the dashboard map header.
 * Pure function.
 */
export function computeGeoStats({
  allEntries = [],
  periodEntries = [],
  geolocatedPeriodEntries = [],
  clusters = [],
} = {}) {
  const totalPeriodEntries = periodEntries.length;
  const geolocatedPeriodEntriesCount = geolocatedPeriodEntries.length;
  const totalGeolocatedMinutes = geolocatedPeriodEntries.reduce(
    (sum, e) => sum + Math.max(0, Number(e.mins) || 0),
    0
  );
  const coveragePercent = totalPeriodEntries > 0
    ? Math.round((geolocatedPeriodEntriesCount / totalPeriodEntries) * 100)
    : 0;
  const totalAllGeolocatedCount = allEntries.filter(hasEntryGeoLocations).length;

  let startPointsCount = 0;
  let endPointsCount = 0;
  for (const entry of geolocatedPeriodEntries) {
    const { startLocation, endLocation } = resolveEntryGeoLocations(entry);
    if (startLocation) startPointsCount += 1;
    if (endLocation) endPointsCount += 1;
  }

  return {
    totalPeriodEntries,
    geolocatedPeriodEntriesCount,
    totalGeolocatedMinutes,
    formattedGeolocatedTotal: formatDuration(totalGeolocatedMinutes),
    coveragePercent,
    placesCount: clusters.length,
    startPointsCount,
    endPointsCount,
    totalAllGeolocatedCount,
  };
}
