import { durationBetween } from './time.js';

/**
 * Canonical TimeEntry domain factory.
 * Categories are identified exclusively by categoryId, regardless of depth.
 */
export function createTimeEntry({
  id,
  activity = '',
  categoryId = null,
  date,
  start,
  end,
  endDate,
  mins,
} = {}) {
  const duration = Number.isFinite(mins) ? Math.max(0, mins) : durationBetween(start, end);

  return {
    id,
    activity: String(activity).trim(),
    categoryId: categoryId ?? null,
    date,
    start,
    end,
    ...(endDate ? { endDate } : {}),
    mins: duration,
  };
}

export function updateTimeEntry(entry, changes = {}) {
  return createTimeEntry({ ...entry, ...changes });
}

export function isTimeEntry(value) {
  return Boolean(
    value &&
    typeof value.id === 'string' &&
    typeof value.activity === 'string' &&
    typeof value.date === 'string' &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    Number.isFinite(value.mins) &&
    (value.categoryId === null || typeof value.categoryId === 'string'),
  );
}
