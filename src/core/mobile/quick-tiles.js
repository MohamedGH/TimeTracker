/**
 * Quick Tiles Domain & Reconciliation — Pure functional core for Android Quick Settings tiles,
 * favorite activity slot mapping, atomic tile tap state transitions, and IndexedDB reconciliation.
 * No DOM or direct Capacitor plugin side effects.
 */

import { formatCategoryPath } from '../category-tree.js';
import { getCategoryColor } from '../category-palette.js';
import { getUsualCategoryForActivity } from '../suggestions-engine.js';
import { createTimeEntry } from '../time-entry.js';
import { createActiveTimer, elapsedMinutes } from '../timer.js';

export const QUICK_TILE_MAX_SLOTS = 6;
export const QUICK_TILE_DEFAULT_ENABLED_SLOTS = 4;
export const QUICK_TILE_SLOT_IDS = Object.freeze([1, 2, 3, 4, 5, 6]);

export function createDefaultQuickTilesConfig() {
  return {
    allowOnLockScreen: true,
    slots: QUICK_TILE_SLOT_IDS.map((slot) => ({
      slot,
      enabled: slot <= QUICK_TILE_DEFAULT_ENABLED_SLOTS,
      activity: null,
      categoryId: null,
      categoryLabel: null,
      tileLabel: null,
    })),
  };
}

/**
 * Normalizes an activity identifier key for matching (case-insensitive trimmed).
 * Pure function.
 */
export function normalizeActivityKey(label) {
  return String(label || '').trim().toLowerCase();
}

/**
 * Formats a concise Android Quick Settings tile label.
 * Pure function.
 */
export function formatQuickTileLabel(activity) {
  const clean = String(activity || '').trim();
  if (!clean) return null;
  return `TimeTracker — ${clean}`;
}

/**
 * Collects real TimeTracker activities (from saved activities and logged entries),
 * enriched with resolved category metadata. Never invents hardcoded activities.
 * Pure function.
 */
export function collectAvailableTileActivities({
  activities = [],
  entries = [],
  categories = [],
} = {}) {
  const categoryMap = new Map((Array.isArray(categories) ? categories : []).map(c => [c.id, c]));
  const byKey = new Map();

  const resolveCategory = (preferredCatId, activityName) => {
    if (preferredCatId && categoryMap.has(preferredCatId)) return preferredCatId;
    const usual = getUsualCategoryForActivity(activityName, entries, activities);
    if (usual && categoryMap.has(usual)) return usual;
    return categories[0]?.id ?? null;
  };

  for (const act of (Array.isArray(activities) ? activities : [])) {
    const label = String(act?.label || act?.name || act?.activity || '').trim();
    if (!label) continue;
    const key = normalizeActivityKey(label);
    const categoryId = resolveCategory(act.categoryId ?? act.cat ?? null, label);
    const cat = categoryId ? categoryMap.get(categoryId) : null;
    byKey.set(key, {
      id: act.id || `act:${key}`,
      activity: label,
      categoryId,
      categoryLabel: cat?.label || 'Sans catégorie',
      categoryPath: categoryId ? (formatCategoryPath(categories, categoryId) || cat?.label || 'Catégorie') : 'Sans catégorie',
      color: categoryId ? getCategoryColor(cat || categoryId, categories) : '#8B93A1',
      useCount: Number.isFinite(Number(act.useCount)) ? Math.max(0, Number(act.useCount)) : 1,
      lastUsedAt: act.lastUsedAt || null,
      isSaved: true,
    });
  }

  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const label = String(entry?.activity || '').trim();
    if (!label) continue;
    const key = normalizeActivityKey(label);
    const existing = byKey.get(key);
    if (existing) {
      existing.useCount += 1;
      const entryIso = entry.date ? `${entry.date}T${entry.end || entry.start || '00:00'}:00` : null;
      if (entryIso && (!existing.lastUsedAt || entryIso > existing.lastUsedAt)) {
        existing.lastUsedAt = entryIso;
      }
      continue;
    }

    const categoryId = resolveCategory(entry.categoryId ?? null, label);
    const cat = categoryId ? categoryMap.get(categoryId) : null;
    byKey.set(key, {
      id: `entry:${key}`,
      activity: label,
      categoryId,
      categoryLabel: cat?.label || 'Sans catégorie',
      categoryPath: categoryId ? (formatCategoryPath(categories, categoryId) || cat?.label || 'Catégorie') : 'Sans catégorie',
      color: categoryId ? getCategoryColor(cat || categoryId, categories) : '#8B93A1',
      useCount: 1,
      lastUsedAt: entry.date ? `${entry.date}T${entry.end || entry.start || '00:00'}:00` : null,
      isSaved: false,
    });
  }

  return [...byKey.values()].sort((a, b) => (
    (b.isSaved ? 1 : 0) - (a.isSaved ? 1 : 0)
    || b.useCount - a.useCount
    || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || ''))
    || a.activity.localeCompare(b.activity, 'fr')
  ));
}

/**
 * Normalizes a single Quick Tile slot definition against real categories.
 * Pure function.
 */
export function normalizeQuickTileSlot(rawSlot = null, slotNumber = 1, categories = [], availableActivities = []) {
  const slot = Math.min(QUICK_TILE_MAX_SLOTS, Math.max(1, Number(slotNumber) || 1));
  const defaultEnabled = slot <= QUICK_TILE_DEFAULT_ENABLED_SLOTS;
  if (!rawSlot || typeof rawSlot !== 'object') {
    return {
      slot,
      enabled: defaultEnabled,
      activity: null,
      categoryId: null,
      categoryLabel: null,
      tileLabel: null,
    };
  }

  const activityName = String(rawSlot.activity || '').trim() || null;
  if (!activityName) {
    return {
      slot,
      enabled: typeof rawSlot.enabled === 'boolean' ? rawSlot.enabled : defaultEnabled,
      activity: null,
      categoryId: null,
      categoryLabel: null,
      tileLabel: null,
    };
  }

  const categoryMap = new Map((Array.isArray(categories) ? categories : []).map(c => [c.id, c]));
  const matchedAvailable = (Array.isArray(availableActivities) ? availableActivities : []).find(
    item => normalizeActivityKey(item.activity) === normalizeActivityKey(activityName),
  );

  const rawCatId = rawSlot.categoryId && categoryMap.has(rawSlot.categoryId)
    ? rawSlot.categoryId
    : (matchedAvailable?.categoryId && categoryMap.has(matchedAvailable.categoryId)
      ? matchedAvailable.categoryId
      : categories[0]?.id ?? null);
  const cat = rawCatId ? categoryMap.get(rawCatId) : null;

  return {
    slot,
    enabled: typeof rawSlot.enabled === 'boolean' ? rawSlot.enabled : true,
    activity: matchedAvailable?.activity || activityName,
    categoryId: rawCatId,
    categoryLabel: cat?.label || rawSlot.categoryLabel || null,
    tileLabel: formatQuickTileLabel(matchedAvailable?.activity || activityName),
  };
}

/**
 * Normalizes the complete Quick Tiles configuration.
 * Pure function.
 */
export function normalizeQuickTilesConfig(
  rawConfig = null,
  { categories = [], activities = [], entries = [] } = {},
) {
  const available = collectAvailableTileActivities({ activities, entries, categories });
  const rawSlots = Array.isArray(rawConfig?.slots) ? rawConfig.slots : [];

  const slots = QUICK_TILE_SLOT_IDS.map((slotNum) => {
    const raw = rawSlots.find(s => Number(s?.slot) === slotNum) || null;
    return normalizeQuickTileSlot(raw, slotNum, categories, available);
  });

  return {
    allowOnLockScreen: typeof rawConfig?.allowOnLockScreen === 'boolean'
      ? rawConfig.allowOnLockScreen
      : true,
    slots,
  };
}

/**
 * Suggests up to `maxSlots` real favorite activities from TimeTracker data for Quick Tiles.
 * Never invents hardcoded fallback activities if the user has none.
 * Pure function.
 */
export function suggestFavoriteQuickTiles(
  { activities = [], entries = [], categories = [] } = {},
  maxSlots = QUICK_TILE_DEFAULT_ENABLED_SLOTS,
) {
  const available = collectAvailableTileActivities({ activities, entries, categories });
  const limit = Math.min(QUICK_TILE_MAX_SLOTS, Math.max(1, Number(maxSlots) || QUICK_TILE_DEFAULT_ENABLED_SLOTS));
  const selected = available.slice(0, limit);

  return QUICK_TILE_SLOT_IDS.map((slotNum) => {
    const candidate = selected[slotNum - 1];
    if (!candidate) {
      return {
        slot: slotNum,
        enabled: slotNum <= QUICK_TILE_DEFAULT_ENABLED_SLOTS,
        activity: null,
        categoryId: null,
        categoryLabel: null,
        tileLabel: null,
      };
    }
    return {
      slot: slotNum,
      enabled: true,
      activity: candidate.activity,
      categoryId: candidate.categoryId,
      categoryLabel: candidate.categoryLabel,
      tileLabel: formatQuickTileLabel(candidate.activity),
    };
  });
}

export function assignActivityToQuickTile(config, slotNumber, activityItem) {
  const base = config?.slots ? config : createDefaultQuickTilesConfig();
  const slotNum = Number(slotNumber);
  if (!QUICK_TILE_SLOT_IDS.includes(slotNum)) return base;

  const activity = activityItem?.activity ? String(activityItem.activity).trim() : null;
  if (!activity) return clearQuickTileSlot(base, slotNum);

  return {
    ...base,
    slots: base.slots.map((s) => (
      s.slot === slotNum
        ? {
            slot: slotNum,
            enabled: true,
            activity,
            categoryId: activityItem.categoryId ?? null,
            categoryLabel: activityItem.categoryLabel ?? null,
            tileLabel: formatQuickTileLabel(activity),
          }
        : s
    )),
  };
}

export function clearQuickTileSlot(config, slotNumber) {
  const base = config?.slots ? config : createDefaultQuickTilesConfig();
  const slotNum = Number(slotNumber);
  return {
    ...base,
    slots: base.slots.map((s) => (
      s.slot === slotNum
        ? {
            ...s,
            activity: null,
            categoryId: null,
            categoryLabel: null,
            tileLabel: null,
          }
        : s
    )),
  };
}

export function toggleQuickTileSlotEnabled(config, slotNumber, enabled) {
  const base = config?.slots ? config : createDefaultQuickTilesConfig();
  const slotNum = Number(slotNumber);
  return {
    ...base,
    slots: base.slots.map((s) => (
      s.slot === slotNum ? { ...s, enabled: Boolean(enabled) } : s
    )),
  };
}

export function setAllowOnLockScreen(config, allow) {
  const base = config?.slots ? config : createDefaultQuickTilesConfig();
  return {
    ...base,
    allowOnLockScreen: Boolean(allow),
  };
}

/**
 * Checks whether an activeTimer matches a given tile activity & category.
 * Pure function.
 */
export function isSameTimerTarget(activeTimer, activity, categoryId) {
  if (!activeTimer) return false;
  const sameActivity = normalizeActivityKey(activeTimer.activity) === normalizeActivityKey(activity);
  if (!sameActivity) return false;
  const activeCat = activeTimer.categoryId ?? activeTimer.cat ?? null;
  if (!activeCat || !categoryId) return true;
  return String(activeCat) === String(categoryId);
}

/**
 * Formats YYYY-MM-DD and HH:mm in local time for a given epoch ms.
 * Pure function.
 */
export function formatLocalDateAndClock(epochMs) {
  const d = new Date(epochMs);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

/**
 * Canonical atomic transition when tapping a Quick Settings tile.
 * Mirrors QuickTimerRepository.kt 1:1 so Web/tests/Android obey identical rules:
 * - No active timer -> starts timer for tile activity.
 * - Same activity active -> stops active timer & creates canonical TimeEntry (viaTimer: true).
 * - Different activity active -> atomically stops previous timer at `nowMs` and starts new timer at exact `nowMs`.
 *
 * Pure function.
 */
export function applyTileTapTransition({
  activeTimer = null,
  nowMs = Date.now(),
  tileActivity,
  tileCategoryId,
  tileDate = null,
  tileTime = null,
  entryId = crypto.randomUUID(),
} = {}) {
  const cleanActivity = String(tileActivity || '').trim();
  if (!cleanActivity) {
    throw new Error('Activité de tuile manquante.');
  }

  const local = formatLocalDateAndClock(nowMs);
  const date = tileDate || local.date;
  const time = tileTime || local.time;

  if (!activeTimer) {
    const started = createActiveTimer({
      activity: cleanActivity,
      categoryId: tileCategoryId || 'autre',
      startTs: nowMs,
      startTime: time,
      date,
    });
    return {
      action: 'started',
      activeTimer: started,
      producedEntry: null,
      transitionTs: nowMs,
    };
  }

  const closedDuration = elapsedMinutes(activeTimer, nowMs);
  const producedEntry = createTimeEntry({
    id: entryId,
    activity: activeTimer.activity,
    categoryId: activeTimer.categoryId ?? activeTimer.cat ?? null,
    date: activeTimer.date,
    start: activeTimer.startTime,
    end: time,
    endDate: date,
    mins: closedDuration,
    viaTimer: true,
    startLocation: activeTimer.startLocation || activeTimer.location || null,
  });

  if (isSameTimerTarget(activeTimer, cleanActivity, tileCategoryId)) {
    return {
      action: 'stopped',
      activeTimer: null,
      producedEntry,
      transitionTs: nowMs,
    };
  }

  const switched = createActiveTimer({
    activity: cleanActivity,
    categoryId: tileCategoryId || 'autre',
    startTs: nowMs,
    startTime: time,
    date,
  });

  return {
    action: 'switched',
    activeTimer: switched,
    producedEntry,
    transitionTs: nowMs,
  };
}

/**
 * Reconciles native Android Quick Tile pending entries & active timer snapshot
 * into TimeTracker's canonical IndexedDB domain state without duplicates or lost time.
 *
 * Pure function.
 */
export function reconcileNativeTimerSnapshot({
  state = {},
  nativeSnapshot = null,
} = {}) {
  if (!nativeSnapshot || typeof nativeSnapshot !== 'object') {
    return {
      entries: state.entries || [],
      activities: state.activities || [],
      activeTimer: state.activeTimer ?? null,
      timerUpdatedAt: state.timerUpdatedAt || 0,
      importedEntryIds: [],
      changed: false,
    };
  }

  const currentEntries = Array.isArray(state.entries) ? state.entries : [];
  const existingIds = new Set(currentEntries.map(e => e.id));
  const categoryIds = new Set((Array.isArray(state.categories) ? state.categories : []).map(c => c.id));
  const fallbackCategoryId = state.categories?.[0]?.id ?? null;

  const pending = Array.isArray(nativeSnapshot.pendingEntries) ? nativeSnapshot.pendingEntries : [];
  const importedEntries = [];
  const importedEntryIds = [];

  for (const raw of pending) {
    if (!raw?.id || !raw?.activity || !raw?.date || !raw?.start || !raw?.end) continue;
    importedEntryIds.push(String(raw.id));
    if (existingIds.has(String(raw.id))) continue;

    const resolvedCatId = raw.categoryId && categoryIds.has(raw.categoryId)
      ? raw.categoryId
      : (raw.categoryId ?? fallbackCategoryId);

    const entry = createTimeEntry({
      id: String(raw.id),
      activity: raw.activity,
      categoryId: resolvedCatId,
      date: raw.date,
      start: raw.start,
      end: raw.end,
      endDate: raw.endDate || raw.date,
      mins: Number.isFinite(Number(raw.mins)) ? Math.max(0, Number(raw.mins)) : undefined,
      viaTimer: true,
      startLocation: raw.startLocation || raw.location || null,
      endLocation: raw.endLocation || null,
    });

    existingIds.add(entry.id);
    importedEntries.push(entry);
  }

  // Chronologically newest entries first (matches ui.js convention [entry, ...state.entries])
  const nextEntries = importedEntries.length
    ? [...importedEntries.slice().reverse(), ...currentEntries]
    : currentEntries;

  // Update saved activities usage metadata without mutating input objects
  let nextActivities = Array.isArray(state.activities) ? state.activities : [];
  if (importedEntries.length && nextActivities.length) {
    const incrementsByKey = new Map();
    for (const entry of importedEntries) {
      const key = normalizeActivityKey(entry.activity);
      const prev = incrementsByKey.get(key) || { count: 0, lastIso: null };
      const entryIso = `${entry.endDate || entry.date}T${entry.end || '00:00'}:00`;
      incrementsByKey.set(key, {
        count: prev.count + 1,
        lastIso: !prev.lastIso || entryIso > prev.lastIso ? entryIso : prev.lastIso,
      });
    }

    nextActivities = nextActivities.map((act) => {
      const key = normalizeActivityKey(act.label || act.activity || act.name);
      const inc = incrementsByKey.get(key);
      if (!inc) return act;
      return {
        ...act,
        useCount: (Number(act.useCount) || 0) + inc.count,
        lastUsedAt: inc.lastIso && (!act.lastUsedAt || inc.lastIso > act.lastUsedAt)
          ? inc.lastIso
          : act.lastUsedAt,
      };
    });
  }

  // Resolve authoritative activeTimer using monotonic update timestamp
  const stateUpdatedAt = Number(state.timerUpdatedAt || state.activeTimer?.startTs || 0);
  const nativeUpdatedAt = Number(nativeSnapshot.activeTimerUpdatedAt || 0);

  let nextActiveTimer = state.activeTimer ?? null;
  let nextTimerUpdatedAt = stateUpdatedAt;
  let timerChanged = false;

  if (nativeUpdatedAt > stateUpdatedAt) {
    if (nativeSnapshot.activeTimer && nativeSnapshot.activeTimer.activity) {
      const t = nativeSnapshot.activeTimer;
      const catId = (t.categoryId && categoryIds.has(t.categoryId))
        ? t.categoryId
        : (t.categoryId || fallbackCategoryId || 'autre');
      nextActiveTimer = createActiveTimer({
        activity: t.activity,
        categoryId: catId,
        startTs: Number(t.startTs) || nativeUpdatedAt,
        startTime: t.startTime,
        date: t.date,
        startLocation: t.startLocation || t.location || null,
      });
    } else {
      nextActiveTimer = null;
    }
    nextTimerUpdatedAt = nativeUpdatedAt;
    timerChanged = true;
  }

  return {
    entries: nextEntries,
    activities: nextActivities,
    activeTimer: nextActiveTimer,
    timerUpdatedAt: nextTimerUpdatedAt,
    importedEntryIds,
    changed: importedEntries.length > 0 || timerChanged,
  };
}
