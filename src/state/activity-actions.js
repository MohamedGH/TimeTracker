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

