/**
 * Pure functional mutations for updating activities and synchronizing
 * matching time entries and active timer references.
 */

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function activityLabel(item) {
  return String(item?.label || item?.name || item?.activity || '').trim();
}

/**
 * Updates an activity's label and category across saved activities,
 * time entries, and any matching active timer.
 * Pure function: (stateSlice, editPayload) -> nextStateSlice
 */
export function updateActivityAndEntries(
  { activities = [], entries = [], activeTimer = null } = {},
  {
    activityId = null,
    oldLabel = '',
    oldCategoryId = null,
    newLabel,
    newCategoryId = null,
  } = {}
) {
  const trimmedLabel = String(newLabel ?? '').trim();
  if (!trimmedLabel) {
    throw new Error('Le nom de l’activité ne peut pas être vide.');
  }

  const oldKey = normalizeKey(oldLabel);
  const oldCat = oldCategoryId || null;
  const nextCat = newCategoryId || null;

  let matchedSaved = false;
  const updatedActivities = (Array.isArray(activities) ? activities : []).map(item => {
    const itemCat = item.categoryId ?? item.cat ?? null;
    const isIdMatch = Boolean(activityId && item.id === activityId);
    const isNameCatMatch = Boolean(
      oldKey
      && normalizeKey(activityLabel(item)) === oldKey
      && itemCat === oldCat
    );

    if (isIdMatch || isNameCatMatch) {
      matchedSaved = true;
      return {
        ...item,
        label: trimmedLabel,
        categoryId: nextCat,
      };
    }
    return item;
  });

  // Deduplicate saved activities if renaming merged two entries in the same category
  const seen = new Set();
  const nextActivities = [];
  for (const item of updatedActivities) {
    const key = `${normalizeKey(activityLabel(item))}::${item.categoryId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextActivities.push(item);
  }

  // If the activity was only from entries and wasn't in saved activities yet, keep entries updated;
  // don't force-create a saved activity unless one existed, or keep behavior predictable.
  const matchKey = oldKey || (matchedSaved ? normalizeKey(activityLabel(activities.find(a => a.id === activityId))) : '');

  const nextEntries = (Array.isArray(entries) ? entries : []).map(entry => {
    const entryKey = normalizeKey(entry.activity);
    const entryCat = entry.categoryId ?? null;
    if (matchKey && entryKey === matchKey && entryCat === oldCat) {
      return {
        ...entry,
        activity: trimmedLabel,
        categoryId: nextCat,
      };
    }
    return entry;
  });

  let nextActiveTimer = activeTimer;
  if (
    activeTimer
    && matchKey
    && normalizeKey(activeTimer.activity) === matchKey
    && (activeTimer.categoryId ?? activeTimer.cat ?? null) === oldCat
  ) {
    nextActiveTimer = {
      ...activeTimer,
      activity: trimmedLabel,
      categoryId: nextCat,
    };
  }

  return {
    activities: nextActivities,
    entries: nextEntries,
    activeTimer: nextActiveTimer,
  };
}

/**
 * Moves an activity (and its matching entries / active timer) to another category.
 * Pure function: (stateSlice, movePayload) -> nextStateSlice
 */
export function moveActivity(
  stateSlice = {},
  {
    activityId = null,
    label = '',
    oldCategoryId = null,
    newCategoryId = null,
  } = {}
) {
  const sourceCat = oldCategoryId || null;
  const targetCat = newCategoryId || null;
  if (sourceCat === targetCat) {
    return {
      activities: Array.isArray(stateSlice.activities) ? stateSlice.activities : [],
      entries: Array.isArray(stateSlice.entries) ? stateSlice.entries : [],
      activeTimer: stateSlice.activeTimer ?? null,
    };
  }

  return updateActivityAndEntries(stateSlice, {
    activityId,
    oldLabel: label,
    oldCategoryId: sourceCat,
    newLabel: label,
    newCategoryId: targetCat,
  });
}

function maxIsoTimestamp(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return String(a) >= String(b) ? a : b;
}

function mergeActivityMetadata(primary, secondary) {
  const countA = Number.isFinite(Number(primary?.useCount)) ? Math.max(0, Number(primary.useCount)) : 0;
  const countB = Number.isFinite(Number(secondary?.useCount)) ? Math.max(0, Number(secondary.useCount)) : 0;
  const avgA = Number(primary?.avgDurationMins);
  const avgB = Number(secondary?.avgDurationMins);
  let avgDurationMins = primary?.avgDurationMins ?? secondary?.avgDurationMins ?? null;
  if (Number.isFinite(avgA) && avgA > 0 && Number.isFinite(avgB) && avgB > 0 && (countA + countB) > 0) {
    avgDurationMins = Math.round(((avgA * countA) + (avgB * countB)) / (countA + countB));
  } else if (Number.isFinite(avgA) && avgA > 0) {
    avgDurationMins = avgA;
  } else if (Number.isFinite(avgB) && avgB > 0) {
    avgDurationMins = avgB;
  }

  return {
    useCount: Math.max(1, countA + countB),
    lastUsedAt: maxIsoTimestamp(primary?.lastUsedAt, secondary?.lastUsedAt),
    avgDurationMins,
  };
}

function buildCategoryPathLabel(categories, categoryId) {
  if (!categoryId) return 'Sans catégorie';
  const byId = new Map((Array.isArray(categories) ? categories : []).map(c => [c.id, c]));
  const parts = [];
  const visited = new Set();
  let cursor = byId.get(categoryId);
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    parts.unshift(cursor.label);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  return parts.length ? parts.join(' › ') : 'Sans catégorie';
}

export function buildActivityCompositeKey(label, categoryId = null) {
  return `${categoryId || ''}::${normalizeKey(label)}`;
}

/**
 * Collects all distinct activities across saved activities and logged entries,
 * keyed by (categoryId, normalizedLabel), for selection in merge/management UIs.
 * Pure function: ({ activities, entries, categories }) -> Array<MergeableActivity>
 */
export function collectMergeableActivities({
  activities = [],
  entries = [],
  categories = [],
} = {}) {
  const categoryIds = new Set((Array.isArray(categories) ? categories : []).map(c => c.id));
  const byKey = new Map();

  for (const act of (Array.isArray(activities) ? activities : [])) {
    const label = activityLabel(act);
    if (!label) continue;
    const rawCat = act.categoryId ?? act.cat ?? null;
    const categoryId = rawCat && categoryIds.has(rawCat) ? rawCat : null;
    const key = buildActivityCompositeKey(label, categoryId);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        activityId: act.id || null,
        label,
        categoryId,
        categoryPath: buildCategoryPathLabel(categories, categoryId),
        entryCount: 0,
        useCount: Number.isFinite(Number(act.useCount)) ? Math.max(0, Number(act.useCount)) : 1,
        isSaved: true,
      });
    }
  }

  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const label = String(entry?.activity || '').trim();
    if (!label) continue;
    const rawCat = entry.categoryId ?? null;
    const categoryId = rawCat && categoryIds.has(rawCat) ? rawCat : null;
    const key = buildActivityCompositeKey(label, categoryId);
    const existing = byKey.get(key);
    if (existing) {
      existing.entryCount += 1;
      continue;
    }
    byKey.set(key, {
      key,
      activityId: null,
      label,
      categoryId,
      categoryPath: buildCategoryPathLabel(categories, categoryId),
      entryCount: 1,
      useCount: 1,
      isSaved: false,
    });
  }

  return [...byKey.values()].sort((a, b) => (
    (b.isSaved ? 1 : 0) - (a.isSaved ? 1 : 0)
    || b.entryCount - a.entryCount
    || b.useCount - a.useCount
    || a.label.localeCompare(b.label, 'fr')
  ));
}

function resolveMergeEndpoint(endpoint, activities = []) {
  if (!endpoint || typeof endpoint !== 'object') {
    return { activityId: null, label: '', categoryId: null };
  }
  const byId = endpoint.activityId
    ? (Array.isArray(activities) ? activities : []).find(a => a.id === endpoint.activityId)
    : null;
  const label = String(endpoint.label ?? (byId ? activityLabel(byId) : '')).trim();
  const categoryId = endpoint.categoryId !== undefined
    ? (endpoint.categoryId || null)
    : (byId?.categoryId ?? byId?.cat ?? null);
  return {
    activityId: endpoint.activityId || byId?.id || null,
    label,
    categoryId,
  };
}

function matchesActivityTarget(candidateLabel, candidateCat, targetLabel, targetCat) {
  return normalizeKey(candidateLabel) === normalizeKey(targetLabel)
    && (candidateCat || null) === (targetCat || null);
}

/**
 * Validates whether source activity can be merged into target activity.
 * Pure function.
 */
export function validateActivityMerge(activities = [], source = null, target = null) {
  const src = resolveMergeEndpoint(source, activities);
  const dst = resolveMergeEndpoint(target, activities);

  if (!src.label || !dst.label) {
    return {
      valid: false,
      error: 'Veuillez sélectionner une activité source et une activité cible.',
      source: src,
      target: dst,
    };
  }

  const sameLabelAndCat = matchesActivityTarget(src.label, src.categoryId, dst.label, dst.categoryId);
  const distinctSavedIds = Boolean(src.activityId && dst.activityId && src.activityId !== dst.activityId);
  if (sameLabelAndCat && !distinctSavedIds) {
    return {
      valid: false,
      error: 'Veuillez choisir deux activités différentes à fusionner.',
      source: src,
      target: dst,
    };
  }

  return {
    valid: true,
    error: null,
    source: src,
    target: dst,
  };
}

/**
 * Computes a read-only impact summary before merging two activities.
 * Pure function.
 */
export function computeActivityMergeImpact(
  { activities = [], entries = [], activeTimer = null, quickTilesConfig = null } = {},
  { source, target } = {}
) {
  const check = validateActivityMerge(activities, source, target);
  if (!check.valid) {
    return {
      valid: false,
      error: check.error,
      source: check.source,
      target: check.target,
      entriesCount: 0,
      savedActivitiesMerged: 0,
      affectsActiveTimer: false,
      quickTilesCount: 0,
    };
  }

  const { source: src, target: dst } = check;
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeActivities = Array.isArray(activities) ? activities : [];

  const entriesCount = safeEntries.filter(entry =>
    matchesActivityTarget(entry.activity, entry.categoryId ?? null, src.label, src.categoryId)
  ).length;

  const savedActivitiesMerged = safeActivities.filter(item =>
    (src.activityId && item.id === src.activityId)
    || matchesActivityTarget(activityLabel(item), item.categoryId ?? item.cat ?? null, src.label, src.categoryId)
  ).length;

  const affectsActiveTimer = Boolean(
    activeTimer
    && matchesActivityTarget(
      activeTimer.activity,
      activeTimer.categoryId ?? activeTimer.cat ?? null,
      src.label,
      src.categoryId
    )
  );

  const quickTilesCount = Array.isArray(quickTilesConfig?.slots)
    ? quickTilesConfig.slots.filter(slot =>
        slot?.activity
        && matchesActivityTarget(slot.activity, slot.categoryId ?? null, src.label, src.categoryId)
      ).length
    : 0;

  return {
    valid: true,
    error: null,
    source: src,
    target: dst,
    entriesCount,
    savedActivitiesMerged,
    affectsActiveTimer,
    quickTilesCount,
  };
}

/**
 * Merges a source activity into a target activity across saved activities,
 * time entries, active timer, and Android Quick Tiles configuration.
 * Pure function: (stateSlice, { source, target }) -> nextStateSlice
 */
export function mergeActivitiesState(
  {
    activities = [],
    entries = [],
    activeTimer = null,
    quickTilesConfig = null,
    categories = [],
  } = {},
  { source, target } = {}
) {
  const safeActivities = Array.isArray(activities) ? activities : [];
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeCategories = Array.isArray(categories) ? categories : [];

  const impact = computeActivityMergeImpact(
    { activities: safeActivities, entries: safeEntries, activeTimer, quickTilesConfig },
    { source, target }
  );
  if (!impact.valid) {
    throw new Error(impact.error);
  }

  const { source: src, target: dst } = impact;

  const nextEntries = safeEntries.map(entry => (
    matchesActivityTarget(entry.activity, entry.categoryId ?? null, src.label, src.categoryId)
      ? {
          ...entry,
          activity: dst.label,
          categoryId: dst.categoryId,
        }
      : entry
  ));

  const isSourceSaved = item =>
    Boolean(src.activityId && item.id === src.activityId)
    || matchesActivityTarget(activityLabel(item), item.categoryId ?? item.cat ?? null, src.label, src.categoryId);

  const isTargetSaved = item =>
    Boolean(dst.activityId && item.id === dst.activityId)
    || matchesActivityTarget(activityLabel(item), item.categoryId ?? item.cat ?? null, dst.label, dst.categoryId);

  const sourceSavedItems = safeActivities.filter(isSourceSaved);
  const targetSavedItem = safeActivities.find(item => isTargetSaved(item) && !sourceSavedItems.some(s => s.id === item.id))
    || safeActivities.find(isTargetSaved)
    || null;

  const mergedMeta = sourceSavedItems.reduce(
    (acc, item) => mergeActivityMetadata(acc, item),
    targetSavedItem || {}
  );

  const nextActivitiesRaw = [];
  const sourceIds = new Set(sourceSavedItems.map(s => s.id));

  if (targetSavedItem) {
    for (const item of safeActivities) {
      if (item.id === targetSavedItem.id) {
        nextActivitiesRaw.push({
          ...item,
          label: dst.label,
          categoryId: dst.categoryId,
          ...mergedMeta,
        });
      } else if (!sourceIds.has(item.id)) {
        nextActivitiesRaw.push(item);
      }
    }
  } else if (sourceSavedItems.length > 0) {
    const primarySource = sourceSavedItems[0];
    for (const item of safeActivities) {
      if (item.id === primarySource.id) {
        nextActivitiesRaw.push({
          ...item,
          label: dst.label,
          categoryId: dst.categoryId,
          ...mergedMeta,
        });
      } else if (!sourceIds.has(item.id)) {
        nextActivitiesRaw.push(item);
      }
    }
  } else {
    nextActivitiesRaw.push(...safeActivities);
  }

  // Ensure uniqueness by (normalizedLabel, categoryId)
  const seenKeys = new Set();
  const nextActivities = [];
  for (const item of nextActivitiesRaw) {
    const k = buildActivityCompositeKey(activityLabel(item), item.categoryId ?? item.cat ?? null);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    nextActivities.push(item);
  }

  const nextActiveTimer = (
    activeTimer
    && matchesActivityTarget(
      activeTimer.activity,
      activeTimer.categoryId ?? activeTimer.cat ?? null,
      src.label,
      src.categoryId
    )
  )
    ? {
        ...activeTimer,
        activity: dst.label,
        categoryId: dst.categoryId,
      }
    : activeTimer;

  const targetCategoryObj = dst.categoryId
    ? safeCategories.find(c => c.id === dst.categoryId) || null
    : null;

  const nextQuickTilesConfig = quickTilesConfig && Array.isArray(quickTilesConfig.slots)
    ? {
        ...quickTilesConfig,
        slots: quickTilesConfig.slots.map(slot => (
          slot?.activity
          && matchesActivityTarget(slot.activity, slot.categoryId ?? null, src.label, src.categoryId)
            ? {
                ...slot,
                activity: dst.label,
                categoryId: dst.categoryId,
                categoryLabel: targetCategoryObj?.label ?? (dst.categoryId ? slot.categoryLabel : null),
                tileLabel: `TimeTracker — ${dst.label}`,
              }
            : slot
        )),
      }
    : quickTilesConfig;

  return {
    activities: nextActivities,
    entries: nextEntries,
    activeTimer: nextActiveTimer,
    quickTilesConfig: nextQuickTilesConfig,
    summary: {
      sourceLabel: src.label,
      sourceCategoryId: src.categoryId,
      targetLabel: dst.label,
      targetCategoryId: dst.categoryId,
      entriesCount: impact.entriesCount,
      savedActivitiesMerged: impact.savedActivitiesMerged,
      affectsActiveTimer: impact.affectsActiveTimer,
      quickTilesCount: impact.quickTilesCount,
    },
  };
}


