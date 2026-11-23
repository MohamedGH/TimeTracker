/**
 * Geolocation & Spatial Activity Domain Module.
 * Pure functional utilities for coordinate normalization, non-blocking GPS capture,
 * period/category filtering, spatial clustering, and chronological path generation.
 */

import { filterEntriesByPeriod, formatDuration } from '../statistics.js';
import { getDescendants } from '../category-tree.js';
import { today } from '../time.js';

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_CLUSTER_RADIUS_METERS = 65;

/**
 * Validates raw coordinate objects cleanly without coercing empty strings.
 * Pure function.
 */
export function isValidCoordinates(loc) {
  if (!loc || typeof loc !== 'object') return false;
  const { lat, lng } = loc;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Rounds coordinate to 6 decimal places (~11 cm precision) and strips invalid metadata.
 * Pure function.
 */
export function normalizeLocation(loc) {
  if (!isValidCoordinates(loc)) return null;
  const lat = Math.round(loc.lat * 1e6) / 1e6;
  const lng = Math.round(loc.lng * 1e6) / 1e6;
  const accuracy = typeof loc.accuracy === 'number' && Number.isFinite(loc.accuracy) && loc.accuracy >= 0
    ? Math.round(loc.accuracy)
    : null;
  const capturedAt = typeof loc.capturedAt === 'string' && loc.capturedAt.trim()
    ? loc.capturedAt.trim()
    : null;
  const source = loc.source === 'manual' ? 'manual' : 'gps';

  return {
    lat,
    lng,
    ...(accuracy !== null ? { accuracy } : {}),
    ...(capturedAt ? { capturedAt } : {}),
    source,
  };
}

/**
 * Formats coordinates into compact readable text (e.g., "48.8566, 2.3522").
 * Pure function.
 */
export function formatCoordinates(loc, decimals = 4) {
  const normalized = normalizeLocation(loc);
  if (!normalized) return '';
  return `${normalized.lat.toFixed(decimals)}, ${normalized.lng.toFixed(decimals)}`;
}

/**
 * Calculates great-circle distance in meters using the Haversine formula.
 * Pure function.
 */
export function haversineMeters(a, b) {
  if (!isValidCoordinates(a) || !isValidCoordinates(b)) return Infinity;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Captures current GPS position without throwing or blocking caller control flow.
 * Always resolves with `{ ok, location, reason }`.
 */
export function captureCurrentLocation({
  geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null,
  timeoutMs = 6500,
  enableHighAccuracy = true,
  maximumAgeMs = 60000,
  nowIso = () => new Date().toISOString(),
} = {}) {
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return Promise.resolve({ ok: false, location: null, reason: 'unsupported' });
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
            lat: pos?.coords?.latitude,
            lng: pos?.coords?.longitude,
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
          const code = Number(err?.code);
          const reason = code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable';
          finish({ ok: false, location: null, reason });
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
 * Filters entries by dashboard period, optional category hierarchy, and valid location.
 * Pure function.
 */
export function filterGeolocatedEntries(
  entries = [],
  period = '7',
  refDate = today(),
  { categoryId = 'all', categories = [] } = {}
) {
  const periodEntries = filterEntriesByPeriod(entries, period, refDate);

  let allowedCategoryIds = null;
  if (categoryId && categoryId !== 'all' && categoryId !== '__uncategorized__') {
    const descendants = getDescendants(categories, categoryId).map(c => c.id);
    allowedCategoryIds = new Set([categoryId, ...descendants]);
  }

  return periodEntries
    .filter((entry) => {
      if (!isValidCoordinates(entry?.location)) return false;
      if (categoryId === '__uncategorized__') {
        return !entry.categoryId;
      }
      if (allowedCategoryIds) {
        return Boolean(entry.categoryId && allowedCategoryIds.has(entry.categoryId));
      }
      return true;
    })
    .map(entry => ({
      ...entry,
      location: normalizeLocation(entry.location),
    }));
}

/**
 * Groups nearby geolocated entries so overlapping sessions at the same place
 * collapse into one clear marker with full activity and category breakdown.
 * Pure function.
 */
export function clusterOrGroupLocations(
  entries = [],
  categories = [],
  { radiusMeters = DEFAULT_CLUSTER_RADIUS_METERS } = {}
) {
  const categoryMap = new Map((Array.isArray(categories) ? categories : []).map(c => [c.id, c]));
  const sortedNewest = [...entries]
    .filter(e => isValidCoordinates(e?.location))
    .sort((a, b) => {
      const ka = `${a.date || ''}T${a.start || ''}`;
      const kb = `${b.date || ''}T${b.start || ''}`;
      return kb.localeCompare(ka);
    });

  const clusters = [];
  for (const entry of sortedNewest) {
    const loc = normalizeLocation(entry.location);
    if (!loc) continue;

    let targetCluster = null;
    for (const cluster of clusters) {
      if (haversineMeters(cluster.anchor, loc) <= radiusMeters) {
        targetCluster = cluster;
        break;
      }
    }

    if (!targetCluster) {
      targetCluster = {
        anchor: loc,
        items: [],
      };
      clusters.push(targetCluster);
    }
    targetCluster.items.push({ ...entry, location: loc });
  }

  return clusters.map((cluster, idx) => {
    const count = cluster.items.length;
    const sumLat = cluster.items.reduce((s, e) => s + e.location.lat, 0);
    const sumLng = cluster.items.reduce((s, e) => s + e.location.lng, 0);
    const lat = Math.round((sumLat / count) * 1e6) / 1e6;
    const lng = Math.round((sumLng / count) * 1e6) / 1e6;

    const totalMins = cluster.items.reduce((s, e) => s + Math.max(0, Number(e.mins) || 0), 0);

    const catTotals = new Map();
    const actMap = new Map();

    for (const entry of cluster.items) {
      const mins = Math.max(0, Number(entry.mins) || 0);
      const catKey = entry.categoryId || '__uncategorized__';
      catTotals.set(catKey, (catTotals.get(catKey) || 0) + mins);

      const actName = String(entry.activity || 'Activité').trim() || 'Activité';
      const actKey = `${actName.toLowerCase()}::${catKey}`;
      if (!actMap.has(actKey)) {
        const cat = entry.categoryId ? categoryMap.get(entry.categoryId) : null;
        actMap.set(actKey, {
          name: actName,
          categoryId: entry.categoryId ?? null,
          categoryLabel: cat?.label || 'Sans catégorie',
          color: cat?.color || '#948C7E',
          count: 0,
          totalMins: 0,
        });
      }
      const actItem = actMap.get(actKey);
      actItem.count += 1;
      actItem.totalMins += mins;
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
      : String(primaryActivity.charAt(0) || '•').toUpperCase();

    const latest = cluster.items[0];
    return {
      id: `geo_cluster_${idx}_${lat}_${lng}`,
      lat,
      lng,
      totalMins,
      formattedTotal: formatDuration(totalMins),
      sessionCount: count,
      primaryCategoryId: dominantCatId,
      primaryCategoryLabel,
      primaryActivity,
      color,
      glyphText,
      activitiesBreakdown,
      entries: cluster.items,
      latestDate: latest?.date || '',
      latestTime: latest?.start || '',
      coordinatesLabel: formatCoordinates({ lat, lng }, 4),
    };
  });
}

/**
 * Builds an ordered chronological path across geolocated sessions for a period.
 * Consecutive points closer than 25m are collapsed into one stop.
 * Pure function.
 */
export function buildGeoRoutePath(entries = [], { minStepMeters = 25 } = {}) {
  const ordered = [...entries]
    .filter(e => isValidCoordinates(e?.location))
    .sort((a, b) => {
      const ka = `${a.date || ''}T${a.start || ''}`;
      const kb = `${b.date || ''}T${b.start || ''}`;
      return ka.localeCompare(kb);
    });

  const path = [];
  let totalDistanceMeters = 0;

  for (const entry of ordered) {
    const loc = normalizeLocation(entry.location);
    if (!loc) continue;
    const point = { lat: loc.lat, lng: loc.lng };
    const prev = path[path.length - 1];
    if (!prev) {
      path.push(point);
      continue;
    }
    const dist = haversineMeters(prev, point);
    if (dist >= minStepMeters) {
      totalDistanceMeters += dist;
      path.push(point);
    }
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
  const totalAllGeolocatedCount = allEntries.filter(e => isValidCoordinates(e?.location)).length;

  return {
    totalPeriodEntries,
    geolocatedPeriodEntriesCount,
    totalGeolocatedMinutes,
    formattedGeolocatedTotal: formatDuration(totalGeolocatedMinutes),
    coveragePercent,
    placesCount: clusters.length,
    totalAllGeolocatedCount,
  };
}
