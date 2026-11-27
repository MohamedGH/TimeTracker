import { createTimeEntry } from '../core/time-entry.js';
import { addDays, parseTime } from '../core/time.js';
import { isDate, isTime } from '../core/validation.js';
import { resolveEntryGeoLocations } from '../core/geo/geo-location.js';
import { ensureSavedActivity, findSavedActivityMatch } from './activity-actions.js';

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `entry_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Parses YYYY-MM-DD + HH:MM into UTC epoch milliseconds for DST-safe clock arithmetic.
 */
export function parseUtcDateTimeMs(dateStr, timeStr) {
  if (!isDate(dateStr) || !isTime(timeStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

/**
 * Formats UTC epoch milliseconds back to { date: 'YYYY-MM-DD', time: 'HH:MM' }.
 */
export function formatUtcDateTime(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = String(d.getUTCHours()).padStart(2, '0');
  const minute = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

/**
 * Resolves exact chronological start/end boundaries and duration for a recorded entry.
 */
export function resolveEntryTimeBounds(entry) {
  if (!entry || !isDate(entry.date) || !isTime(entry.start) || !isTime(entry.end)) {
    return { valid: false, totalMins: 0 };
  }

  const startDate = entry.date;
  const startTime = entry.start;
  const endTime = entry.end;
  const startClock = parseTime(startTime);
  const endClock = parseTime(endTime);

  let endDate = startDate;
  if (isDate(entry.endDate) && entry.endDate >= startDate) {
    endDate = entry.endDate;
    if (endDate === startDate && endClock < startClock) {
      endDate = addDays(startDate, 1);
    }
  } else if (endClock < startClock) {
    endDate = addDays(startDate, 1);
  }

  const startMs = parseUtcDateTimeMs(startDate, startTime);
  const endMs = parseUtcDateTimeMs(endDate, endTime);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return {
      valid: false,
      startDate,
      startTime,
      endDate,
      endTime,
      startMs,
      endMs,
      totalMins: 0,
    };
  }

  const totalMins = Math.round((endMs - startMs) / 60000);
  return {
    valid: true,
    startDate,
    startTime,
    endDate,
    endTime,
    startMs,
    endMs,
    totalMins,
  };
}

/**
 * Returns the default midpoint split { splitDate, splitTime } for an entry.
 */
export function getDefaultSplitPoint(entry) {
  const bounds = resolveEntryTimeBounds(entry);
  if (!bounds.valid || bounds.totalMins < 2) {
    return {
      splitDate: entry?.date || '',
      splitTime: entry?.start || '',
    };
  }
  const halfMins = Math.max(1, Math.floor(bounds.totalMins / 2));
  const mid = formatUtcDateTime(bounds.startMs + halfMins * 60000);
  return {
    splitDate: mid.date,
    splitTime: mid.time,
  };
}

/**
 * Infers the split date when only splitTime is passed or checks explicit splitDate.
 */
export function inferSplitDate(entry, splitTime, explicitSplitDate = null) {
  if (explicitSplitDate && isDate(explicitSplitDate)) {
    return explicitSplitDate;
  }
  const bounds = resolveEntryTimeBounds(entry);
  if (!bounds.valid) return entry?.date || '';
  if (bounds.endDate > bounds.startDate && isTime(splitTime)) {
    const startClock = parseTime(bounds.startTime);
    const splitClock = parseTime(splitTime);
    if (splitClock < startClock) {
      return addDays(bounds.startDate, 1);
    }
  }
  return bounds.startDate;
}

/**
 * Validates parameters for splitting a recorded time entry into two sequential entries.
 * Pure function.
 */
export function validateEntrySplit(
  entry,
  { splitDate = null, splitTime = '', secondActivity = '', firstActivity = undefined } = {}
) {
  const bounds = resolveEntryTimeBounds(entry);
  if (!bounds.valid || bounds.totalMins < 2) {
    return {
      valid: false,
      error: 'Cette session est trop courte pour être coupée (minimum 2 minutes).',
    };
  }

  const cleanTime = String(splitTime || '').trim();
  if (!isTime(cleanTime)) {
    return {
      valid: false,
      error: 'Veuillez saisir une heure de fin valide (HH:MM).',
    };
  }

  const resolvedSplitDate = splitDate ? String(splitDate).trim() : inferSplitDate(entry, cleanTime, null);
  if (!isDate(resolvedSplitDate)) {
    return {
      valid: false,
      error: 'Veuillez saisir une date de fin valide.',
    };
  }

  const splitMs = parseUtcDateTimeMs(resolvedSplitDate, cleanTime);
  if (splitMs === null || splitMs <= bounds.startMs) {
    return {
      valid: false,
      error: 'La nouvelle date/heure de fin doit être postérieure au début de l’activité.',
    };
  }

  if (splitMs >= bounds.endMs) {
    return {
      valid: false,
      error: 'La nouvelle date/heure de fin doit être antérieure à la fin de l’activité.',
    };
  }

  const trimmedFirst = firstActivity !== undefined
    ? String(firstActivity || '').trim()
    : String(entry.activity || '').trim();
  if (!trimmedFirst) {
    return {
      valid: false,
      error: 'Le libellé de la 1ʳᵉ activité ne peut pas être vide.',
    };
  }

  const trimmedSecond = String(secondActivity || '').trim();
  if (!trimmedSecond) {
    return {
      valid: false,
      error: 'Veuillez saisir un libellé pour la 2ᵉ activité.',
    };
  }

  const part1Mins = Math.round((splitMs - bounds.startMs) / 60000);
  const part2Mins = Math.round((bounds.endMs - splitMs) / 60000);
  if (part1Mins < 1 || part2Mins < 1) {
    return {
      valid: false,
      error: 'Chaque partie doit durer au moins 1 minute.',
    };
  }

  return {
    valid: true,
    error: null,
    startDate: bounds.startDate,
    startTime: bounds.startTime,
    splitDate: resolvedSplitDate,
    splitTime: cleanTime,
    endDate: bounds.endDate,
    endTime: bounds.endTime,
    part1Mins,
    part2Mins,
    firstActivity: trimmedFirst,
    secondActivity: trimmedSecond,
  };
}

/**
 * Splits a recorded time entry into two sequential entries:
 * 1) Original activity [start .. splitTime]
 * 2) New activity [splitTime .. originalEnd]
 * Pure function: (stateSlice, splitPayload) -> nextStateSlice
 */
export function splitTimeEntryState(
  { entries = [], activities = [], activeTimer = null } = {},
  {
    entryId,
    splitDate = null,
    splitTime = '',
    secondActivity = '',
    secondCategoryId = undefined,
    firstActivity = undefined,
    firstCategoryId = undefined,
    createMissingActivity = true,
  } = {}
) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeActivities = Array.isArray(activities) ? activities : [];

  const targetIndex = safeEntries.findIndex(e => e?.id === entryId);
  if (targetIndex < 0) {
    throw new Error('Session introuvable.');
  }
  const target = safeEntries[targetIndex];

  const check = validateEntrySplit(target, {
    splitDate,
    splitTime,
    secondActivity,
    firstActivity,
  });
  if (!check.valid) {
    throw new Error(check.error);
  }

  const firstCatId = firstCategoryId !== undefined
    ? (firstCategoryId || null)
    : (target.categoryId ?? null);
  const secondCatId = secondCategoryId !== undefined
    ? (secondCategoryId || null)
    : (target.categoryId ?? null);

  const geo = resolveEntryGeoLocations(target);
  const firstActivityChanged = check.firstActivity.toLowerCase() !== String(target.activity || '').trim().toLowerCase();
  const savedFirst = firstActivityChanged
    ? findSavedActivityMatch(safeActivities, {
        label: check.firstActivity,
        categoryId: firstCatId,
      })
    : null;
  const savedSecond = findSavedActivityMatch(safeActivities, {
    label: check.secondActivity,
    categoryId: secondCatId,
  });

  const firstEntry = createTimeEntry({
    id: target.id,
    activity: check.firstActivity,
    categoryId: firstCatId,
    date: check.startDate,
    start: check.startTime,
    end: check.splitTime,
    ...(check.splitDate !== check.startDate || target.endDate ? { endDate: check.splitDate } : {}),
    mins: check.part1Mins,
    ...(typeof target.viaTimer === 'boolean' ? { viaTimer: target.viaTimer } : {}),
    startLocation: geo.startLocation,
    endLocation: null,
    content: firstActivityChanged ? (savedFirst?.content || '') : target.content,
    startContent: firstActivityChanged ? (savedFirst?.startContent || '') : target.startContent,
    endContent: firstActivityChanged ? (savedFirst?.endContent || '') : target.endContent,
  });

  const secondEntry = createTimeEntry({
    id: generateId(),
    activity: check.secondActivity,
    categoryId: secondCatId,
    date: check.splitDate,
    start: check.splitTime,
    end: check.endTime,
    ...(check.endDate !== check.splitDate || target.endDate ? { endDate: check.endDate } : {}),
    mins: check.part2Mins,
    ...(typeof target.viaTimer === 'boolean' ? { viaTimer: target.viaTimer } : {}),
    startLocation: null,
    endLocation: geo.endLocation,
    content: savedSecond?.content || '',
    startContent: savedSecond?.startContent || '',
    endContent: savedSecond?.endContent || '',
  });

  const nextEntries = [
    ...safeEntries.slice(0, targetIndex),
    secondEntry,
    firstEntry,
    ...safeEntries.slice(targetIndex + 1),
  ];

  let nextActivities = safeActivities;
  let nextActiveTimer = activeTimer;
  let createdActivity = false;

  if (createMissingActivity) {
    if (firstActivityChanged) {
      const ensuredFirst = ensureSavedActivity(
        { activities: nextActivities, entries: nextEntries, activeTimer: nextActiveTimer },
        {
          label: firstEntry.activity,
          categoryId: firstEntry.categoryId,
          durationMins: firstEntry.mins,
        }
      );
      nextActivities = ensuredFirst.activities;
      nextActiveTimer = ensuredFirst.activeTimer;
      createdActivity = createdActivity || ensuredFirst.created;
    }

    const ensuredSecond = ensureSavedActivity(
      { activities: nextActivities, entries: nextEntries, activeTimer: nextActiveTimer },
      {
        label: secondEntry.activity,
        categoryId: secondEntry.categoryId,
        durationMins: secondEntry.mins,
      }
    );
    nextActivities = ensuredSecond.activities;
    nextActiveTimer = ensuredSecond.activeTimer;
    createdActivity = createdActivity || ensuredSecond.created;
  }

  return {
    entries: nextEntries,
    activities: nextActivities,
    activeTimer: nextActiveTimer,
    firstEntry,
    secondEntry,
    createdActivity,
  };
}
