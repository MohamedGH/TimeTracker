/**
 * Trash Manager — Pure functional soft-delete & undelete domain engine for TimeTracker.
 * Supports restoring deleted time entries, saved activities, activity templates, and categories
 * (including cascade-deleted subcategories and prior category assignments), while touching
 * CRDT timestamps so restored items clear older tombstones and sync back across devices.
 */

import { touchItem } from './sync/crdt-merge.js';

export const TRASH_ITEM_KINDS = Object.freeze({
  ENTRY: 'entry',
  ACTIVITY: 'activity',
  TEMPLATE: 'template',
  CATEGORY: 'category',
});

export const DEFAULT_MAX_TRASH_ITEMS = 50;
export const DEFAULT_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function cloneData(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fallback below
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function resolveRecordLabel(kind, item, related) {
  if (kind === TRASH_ITEM_KINDS.ENTRY) {
    return String(item?.activity || 'Entrée sans nom').trim();
  }
  if (kind === TRASH_ITEM_KINDS.ACTIVITY) {
    return String(item?.label || item?.name || item?.activity || 'Activité').trim();
  }
  if (kind === TRASH_ITEM_KINDS.TEMPLATE) {
    return String(item?.name || 'Gabarit').trim();
  }
  if (kind === TRASH_ITEM_KINDS.CATEGORY) {
    const base = String(item?.label || 'Catégorie').trim();
    const descCount = Array.isArray(related?.descendants) ? related.descendants.length : 0;
    return descCount > 0 ? `${base} (+${descCount} sous-catégorie${descCount > 1 ? 's' : ''})` : base;
  }
  return 'Élément';
}

function resolveRecordSubtitle(kind, item) {
  if (kind === TRASH_ITEM_KINDS.ENTRY) {
    const parts = [item?.date, item?.start && item?.end ? `${item.start}–${item.end}` : null].filter(Boolean);
    return parts.join(' · ');
  }
  if (kind === TRASH_ITEM_KINDS.TEMPLATE) {
    const count = Array.isArray(item?.steps) ? item.steps.length : 0;
    return `${count} étape${count > 1 ? 's' : ''}`;
  }
  return '';
}

/**
 * Creates an immutable trash record for a deleted entity.
 * Pure function: ({ kind, item, related, deletedAt, id }) -> TrashRecord | null
 */
export function createTrashRecord({
  kind,
  item,
  related = null,
  deletedAt = Date.now(),
  id = null,
} = {}) {
  if (!item || typeof item !== 'object' || !Object.values(TRASH_ITEM_KINDS).includes(kind)) {
    return null;
  }

  const safeDeletedAt = Number.isFinite(Number(deletedAt)) && Number(deletedAt) > 0
    ? Number(deletedAt)
    : Date.now();
  const clonedItem = cloneData(item);
  const clonedRelated = related ? cloneData(related) : null;

  return {
    id: id || `trash_${safeDeletedAt}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    label: resolveRecordLabel(kind, clonedItem, clonedRelated),
    subtitle: resolveRecordSubtitle(kind, clonedItem),
    deletedAt: safeDeletedAt,
    item: clonedItem,
    related: clonedRelated,
  };
}

/**
 * Normalizes, prunes expired entries, and caps trash list length.
 * Pure function: (rawList, options) -> TrashRecord[]
 */
export function normalizeTrashList(
  raw,
  {
    nowMs = Date.now(),
    maxItems = DEFAULT_MAX_TRASH_ITEMS,
    maxAgeMs = DEFAULT_TRASH_RETENTION_MS,
  } = {}
) {
  if (!Array.isArray(raw)) return [];
  const validKinds = new Set(Object.values(TRASH_ITEM_KINDS));
  const seen = new Set();

  return raw
    .filter((rec) => {
      if (!rec || typeof rec !== 'object' || !rec.id || seen.has(rec.id)) return false;
      if (!validKinds.has(rec.kind) || !rec.item || typeof rec.item !== 'object') return false;
      const deletedAt = Number(rec.deletedAt);
      if (!Number.isFinite(deletedAt) || deletedAt <= 0) return false;
      if (maxAgeMs > 0 && (nowMs - deletedAt) > maxAgeMs) return false;
      seen.add(rec.id);
      return true;
    })
    .map((rec) => ({
      ...rec,
      label: String(rec.label || resolveRecordLabel(rec.kind, rec.item, rec.related)),
      subtitle: String(rec.subtitle ?? resolveRecordSubtitle(rec.kind, rec.item)),
      deletedAt: Number(rec.deletedAt),
      item: cloneData(rec.item),
      related: rec.related ? cloneData(rec.related) : null,
    }))
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, Math.max(1, maxItems));
}

/**
 * Prepends a new trash record and enforces retention limits.
 * Pure function: (trashList, record, options) -> TrashRecord[]
 */
export function pushTrashRecord(trashList = [], record, options = {}) {
  if (!record || !record.id) {
    return normalizeTrashList(trashList, options);
  }
  const current = Array.isArray(trashList) ? trashList : [];
  return normalizeTrashList([record, ...current], options);
}

/**
 * Permanently removes a record from the trash list.
 * Pure function: (trashList, trashId) -> TrashRecord[]
 */
export function removeTrashRecord(trashList = [], trashId) {
  if (!Array.isArray(trashList) || !trashId) return Array.isArray(trashList) ? trashList : [];
  return trashList.filter(rec => rec?.id !== trashId);
}

/**
 * Returns the most recently deleted trash record, or null.
 * Pure function: (trashList) -> TrashRecord | null
 */
export function findLastTrashRecord(trashList = []) {
  if (!Array.isArray(trashList) || !trashList.length) return null;
  return trashList[0] || null;
}

/**
 * Restores a trash record into the application state slice.
 * Touches updatedAt timestamps via `touchItem` so CRDT merge clears tombstones automatically.
 * Pure function: (stateSlice, trashId, { nowMs }) -> { nextState, restoredRecord }
 */
export function restoreTrashRecord(stateSlice = {}, trashId, { nowMs = Date.now() } = {}) {
  const deletedItems = Array.isArray(stateSlice.deletedItems) ? stateSlice.deletedItems : [];
  const record = trashId
    ? deletedItems.find(rec => rec?.id === trashId) || null
    : findLastTrashRecord(deletedItems);

  if (!record) {
    return {
      nextState: stateSlice,
      restoredRecord: null,
    };
  }

  const remainingTrash = removeTrashRecord(deletedItems, record.id);
  const categories = Array.isArray(stateSlice.categories) ? stateSlice.categories : [];
  const entries = Array.isArray(stateSlice.entries) ? stateSlice.entries : [];
  const activities = Array.isArray(stateSlice.activities) ? stateSlice.activities : [];
  const activityTemplates = Array.isArray(stateSlice.activityTemplates) ? stateSlice.activityTemplates : [];
  const categoryIdSet = new Set(categories.map(c => c.id));

  if (record.kind === TRASH_ITEM_KINDS.ENTRY) {
    const rawEntry = cloneData(record.item);
    const validCatId = rawEntry.categoryId && categoryIdSet.has(rawEntry.categoryId)
      ? rawEntry.categoryId
      : null;
    const restoredEntry = touchItem({ ...rawEntry, categoryId: validCatId }, nowMs);
    const nextEntries = entries.some(e => e.id === restoredEntry.id)
      ? entries.map(e => (e.id === restoredEntry.id ? restoredEntry : e))
      : [restoredEntry, ...entries];

    return {
      nextState: {
        ...stateSlice,
        entries: nextEntries,
        deletedItems: remainingTrash,
      },
      restoredRecord: record,
    };
  }

  if (record.kind === TRASH_ITEM_KINDS.ACTIVITY) {
    const rawActivity = cloneData(record.item);
    const validCatId = rawActivity.categoryId && categoryIdSet.has(rawActivity.categoryId)
      ? rawActivity.categoryId
      : null;
    const restoredActivity = touchItem({ ...rawActivity, categoryId: validCatId }, nowMs);
    const nextActivities = activities.some(a => a.id === restoredActivity.id)
      ? activities.map(a => (a.id === restoredActivity.id ? restoredActivity : a))
      : [...activities, restoredActivity];

    return {
      nextState: {
        ...stateSlice,
        activities: nextActivities,
        deletedItems: remainingTrash,
      },
      restoredRecord: record,
    };
  }

  if (record.kind === TRASH_ITEM_KINDS.TEMPLATE) {
    const rawTemplate = cloneData(record.item);
    const sanitizedSteps = Array.isArray(rawTemplate.steps)
      ? rawTemplate.steps.map((step) => ({
          ...step,
          categoryId: step.categoryId && categoryIdSet.has(step.categoryId) ? step.categoryId : null,
        }))
      : [];
    const restoredTemplate = touchItem({ ...rawTemplate, steps: sanitizedSteps }, nowMs);
    const nextTemplates = activityTemplates.some(t => t.id === restoredTemplate.id)
      ? activityTemplates.map(t => (t.id === restoredTemplate.id ? restoredTemplate : t))
      : [restoredTemplate, ...activityTemplates];

    return {
      nextState: {
        ...stateSlice,
        activityTemplates: nextTemplates,
        deletedItems: remainingTrash,
      },
      restoredRecord: record,
    };
  }

  if (record.kind === TRASH_ITEM_KINDS.CATEGORY) {
    const rootCat = cloneData(record.item);
    const descendants = Array.isArray(record.related?.descendants)
      ? cloneData(record.related.descendants)
      : [];
    const restoredPool = [rootCat, ...descendants];
    const restoredIdSet = new Set(restoredPool.map(c => c.id));
    const availableAfterRestore = new Set([...categoryIdSet, ...restoredIdSet]);

    const touchedCategories = restoredPool.map((cat) => {
      const parentExists = Boolean(cat.parentId && availableAfterRestore.has(cat.parentId));
      return touchItem(
        {
          ...cat,
          parentId: parentExists ? cat.parentId : null,
        },
        nowMs
      );
    });

    const nextCategoriesById = new Map(categories.map(c => [c.id, c]));
    for (const cat of touchedCategories) {
      nextCategoriesById.set(cat.id, cat);
    }
    const nextCategories = [...nextCategoriesById.values()];

    // Re-associate entries/activities whose categoryId was cleared during deletion
    const entryCatMap = record.related?.reassignedEntryCategoryIds || {};
    const nextEntries = entries.map((entry) => {
      const prevCat = entryCatMap[entry.id];
      if (!prevCat || (entry.categoryId ?? null) !== null) return entry;
      return restoredIdSet.has(prevCat) ? touchItem({ ...entry, categoryId: prevCat }, nowMs) : entry;
    });

    const actCatMap = record.related?.reassignedActivityCategoryIds || {};
    const nextActivities = activities.map((act) => {
      const prevCat = actCatMap[act.id];
      if (!prevCat || (act.categoryId ?? null) !== null) return act;
      return restoredIdSet.has(prevCat) ? touchItem({ ...act, categoryId: prevCat }, nowMs) : act;
    });

    return {
      nextState: {
        ...stateSlice,
        categories: nextCategories,
        entries: nextEntries,
        activities: nextActivities,
        deletedItems: remainingTrash,
      },
      restoredRecord: record,
    };
  }

  return {
    nextState: {
      ...stateSlice,
      deletedItems: remainingTrash,
    },
    restoredRecord: null,
  };
}
