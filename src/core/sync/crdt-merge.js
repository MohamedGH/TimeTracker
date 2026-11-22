/**
 * Pure functional CRDT (LWW-Element-Set + Tombstones) merge engine for TimeTracker.
 * Enables lossless multi-device synchronization across Google Drive appDataFolder
 * and direct WebRTC P2P DataChannels without a central backend server.
 */

import { DEFAULT_CATEGORIES } from '../model.js';

export const SYNC_FORMAT = 'timetracker-sync-v1';

export function emptyTombstones() {
  return {
    entries: {},
    activities: {},
    categories: {},
    templates: {},
  };
}

export function normalizeTombstones(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const cleanMap = (obj) => {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [id, ts] of Object.entries(obj)) {
      const n = Number(ts);
      if (id && Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  };
  return {
    entries: cleanMap(src.entries),
    activities: cleanMap(src.activities),
    categories: cleanMap(src.categories),
    templates: cleanMap(src.templates),
  };
}

export function getItemTimestamp(item) {
  if (!item || typeof item !== 'object') return 0;
  const direct = Number(item.updatedAt);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (typeof item.lastUsedAt === 'string') {
    const parsed = Date.parse(item.lastUsedAt);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function stampItem(item, nowMs = Date.now()) {
  if (!item || typeof item !== 'object') return item;
  const existing = Number(item.updatedAt);
  if (Number.isFinite(existing) && existing > 0) return item;
  return {
    ...item,
    updatedAt: nowMs,
  };
}

export function touchItem(item, nowMs = Date.now()) {
  if (!item || typeof item !== 'object') return item;
  const prev = getItemTimestamp(item);
  return {
    ...item,
    updatedAt: Math.max(nowMs, prev + 1),
  };
}

/**
 * Pure diff helper: compares previous and next collections to detect added/modified/deleted items.
 * Updates `updatedAt` on new or modified items and records tombstones for deletions.
 */
export function diffAndStampCollection(prevItems = [], nextItems = [], prevTombstones = {}, nowMs = Date.now()) {
  const prevById = new Map((Array.isArray(prevItems) ? prevItems : []).filter(x => x?.id).map(x => [x.id, x]));
  const nextIds = new Set();
  const nextTombstones = { ...(prevTombstones || {}) };

  const stamped = (Array.isArray(nextItems) ? nextItems : []).map((item) => {
    if (!item?.id) return item;
    nextIds.add(item.id);
    // Clear older tombstone if item is re-created/present
    if (nextTombstones[item.id] !== undefined) {
      delete nextTombstones[item.id];
    }
    const prev = prevById.get(item.id);
    if (!prev) {
      return stampItem(item, nowMs);
    }
    if (!itemsStructurallyEqual(prev, item)) {
      const prevTs = getItemTimestamp(prev);
      const itemTs = getItemTimestamp(item);
      const nextTs = itemTs > prevTs ? itemTs : Math.max(nowMs, prevTs + 1);
      return { ...item, updatedAt: nextTs };
    }
    return stampItem(item, getItemTimestamp(prev) || nowMs);
  });

  for (const prevId of prevById.keys()) {
    if (!nextIds.has(prevId)) {
      nextTombstones[prevId] = Math.max(Number(nextTombstones[prevId]) || 0, nowMs);
    }
  }

  return {
    items: stamped,
    tombstones: nextTombstones,
  };
}

function itemsStructurallyEqual(a, b) {
  const stripTs = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const { updatedAt: _u, ...rest } = obj;
    return rest;
  };
  return JSON.stringify(stripTs(a)) === JSON.stringify(stripTs(b));
}

function pickWinningItem(a, b) {
  const tsA = getItemTimestamp(a);
  const tsB = getItemTimestamp(b);
  if (tsA !== tsB) return tsA > tsB ? a : b;
  // Deterministic tie-breaker so both peers converge identically
  const strA = JSON.stringify(a);
  const strB = JSON.stringify(b);
  return strA >= strB ? a : b;
}

/**
 * Merges two collections using Last-Write-Wins (LWW) semantics and tombstones.
 * Pure, commutative, associative, and idempotent.
 */
export function mergeCollectionLww(localItems = [], remoteItems = [], localTombstones = {}, remoteTombstones = {}) {
  const mergedTombstones = {};
  const allTombstoneIds = new Set([
    ...Object.keys(localTombstones || {}),
    ...Object.keys(remoteTombstones || {}),
  ]);

  for (const id of allTombstoneIds) {
    const ts = Math.max(Number(localTombstones?.[id]) || 0, Number(remoteTombstones?.[id]) || 0);
    if (ts > 0) mergedTombstones[id] = ts;
  }

  const byId = new Map();
  for (const item of [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(remoteItems) ? remoteItems : [])]) {
    if (!item?.id) continue;
    const current = byId.get(item.id);
    byId.set(item.id, current ? pickWinningItem(current, item) : item);
  }

  const mergedItems = [];
  for (const [id, winner] of byId.entries()) {
    const tombTs = mergedTombstones[id] || 0;
    const itemTs = getItemTimestamp(winner);
    if (tombTs > 0 && tombTs >= itemTs) {
      // Deleted after or at last edit
      continue;
    }
    if (tombTs > 0 && itemTs > tombTs) {
      // Re-created or edited after deletion
      delete mergedTombstones[id];
    }
    mergedItems.push(winner);
  }

  // Deterministic ordering by id for consistent convergence while preserving recency for entries
  mergedItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    items: mergedItems,
    tombstones: mergedTombstones,
  };
}

/**
 * Repairs concurrent category tree mutations (missing parents or cycles created across devices).
 */
export function repairMergedCategoryTree(categories = []) {
  const byId = new Map(categories.map(c => [c.id, { ...c, parentId: c.parentId ?? null }]));
  const result = Array.from(byId.values());

  // Pass 1: detach missing or self-referencing parents
  for (const cat of result) {
    if (cat.parentId && (!byId.has(cat.parentId) || cat.parentId === cat.id)) {
      cat.parentId = null;
    }
  }

  // Pass 2: break any cycle safely using a visited set
  for (const cat of result) {
    const visited = new Set([cat.id]);
    let cursor = cat;
    while (cursor?.parentId) {
      if (visited.has(cursor.parentId)) {
        cursor.parentId = null;
        break;
      }
      visited.add(cursor.parentId);
      cursor = byId.get(cursor.parentId);
    }
  }

  // Keep builtin categories in their natural default order first, followed by custom categories
  const defaultOrder = new Map(DEFAULT_CATEGORIES.map((c, idx) => [c.id, idx]));
  result.sort((a, b) => {
    const idxA = defaultOrder.has(a.id) ? defaultOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
    const idxB = defaultOrder.has(b.id) ? defaultOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (idxA !== idxB) return idxA - idxB;
    return String(a.label || '').localeCompare(String(b.label || ''), 'fr');
  });

  return result;
}

/**
 * Merges a local state snapshot and a remote sync payload into a single conflict-free state.
 */
export function mergeSyncPayloads(localPayload, remotePayload) {
  const localT = normalizeTombstones(localPayload?.tombstones);
  const remoteT = normalizeTombstones(remotePayload?.tombstones);

  const catMerge = mergeCollectionLww(
    localPayload?.categories || [],
    remotePayload?.categories || [],
    localT.categories,
    remoteT.categories
  );
  const repairedCategories = repairMergedCategoryTree(catMerge.items);
  const validCategoryIds = new Set(repairedCategories.map(c => c.id));

  const actMerge = mergeCollectionLww(
    localPayload?.activities || localPayload?.savedActivities || [],
    remotePayload?.activities || remotePayload?.savedActivities || [],
    localT.activities,
    remoteT.activities
  );
  const repairedActivities = actMerge.items.map(a => ({
    ...a,
    categoryId: a.categoryId && validCategoryIds.has(a.categoryId) ? a.categoryId : null,
  }));

  const entryMerge = mergeCollectionLww(
    localPayload?.entries || [],
    remotePayload?.entries || [],
    localT.entries,
    remoteT.entries
  );
  const repairedEntries = entryMerge.items
    .map(e => ({
      ...e,
      categoryId: e.categoryId && validCategoryIds.has(e.categoryId) ? e.categoryId : null,
    }))
    .sort((a, b) => {
      const keyA = `${a.date || ''}T${a.start || ''}`;
      const keyB = `${b.date || ''}T${b.start || ''}`;
      if (keyA !== keyB) return keyB.localeCompare(keyA);
      return getItemTimestamp(b) - getItemTimestamp(a);
    });

  const tplMerge = mergeCollectionLww(
    localPayload?.templates || localPayload?.activityTemplates || [],
    remotePayload?.templates || remotePayload?.activityTemplates || [],
    localT.templates,
    remoteT.templates
  );
  const repairedTemplates = tplMerge.items
    .map(tpl => ({
      ...tpl,
      steps: Array.isArray(tpl.steps)
        ? tpl.steps.map(step => ({
            ...step,
            categoryId: step.categoryId && validCategoryIds.has(step.categoryId) ? step.categoryId : null,
          }))
        : [],
    }))
    .sort((a, b) => getItemTimestamp(b) - getItemTimestamp(a));

  return {
    entries: repairedEntries,
    activities: repairedActivities,
    categories: repairedCategories,
    templates: repairedTemplates,
    tombstones: {
      entries: entryMerge.tombstones,
      activities: actMerge.tombstones,
      categories: catMerge.tombstones,
      templates: tplMerge.tombstones,
    },
  };
}

export function serializeSyncPayload({
  entries = [],
  activities = [],
  savedActivities = [],
  categories = [],
  templates = [],
  activityTemplates = [],
  tombstones = emptyTombstones(),
  deviceId = 'local',
  exportedAt = new Date().toISOString(),
} = {}) {
  const actList = activities.length ? activities : savedActivities;
  const tplList = templates.length ? templates : activityTemplates;
  return {
    format: SYNC_FORMAT,
    version: 3,
    deviceId,
    exportedAt,
    entries: entries.map(e => stampItem({ ...e, categoryId: e.categoryId ?? null })),
    savedActivities: actList.map(a => stampItem({ ...a, categoryId: a.categoryId ?? null })),
    categories: categories.map(c => stampItem({ ...c, parentId: c.parentId ?? null })),
    templates: tplList.map(t => stampItem({ ...t })),
    tombstones: normalizeTombstones(tombstones),
  };
}

export function parseSyncPayload(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Données de synchronisation JSON invalides.');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Format de synchronisation invalide.');
  }

  return {
    format: parsed.format || SYNC_FORMAT,
    deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : 'remote',
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    activities: Array.isArray(parsed.savedActivities)
      ? parsed.savedActivities
      : (Array.isArray(parsed.activities) ? parsed.activities : []),
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    templates: Array.isArray(parsed.templates)
      ? parsed.templates
      : (Array.isArray(parsed.activityTemplates) ? parsed.activityTemplates : []),
    tombstones: normalizeTombstones(parsed.tombstones),
  };
}
