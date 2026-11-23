import { durationBetween } from './time.js';
import { isValidCoordinates, normalizeLocation } from './geo/geo-location.js';

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
  viaTimer,
  location,
} = {}) {
  const duration = Number.isFinite(mins) ? Math.max(0, mins) : durationBetween(start, end);
  const normalizedLocation = normalizeLocation(location);

  return {
    id,
    activity: String(activity).trim(),
    categoryId: categoryId ?? null,
    date,
    start,
    end,
    ...(endDate ? { endDate } : {}),
    mins: duration,
    ...(typeof viaTimer === 'boolean' ? { viaTimer } : {}),
    ...(normalizedLocation ? { location: normalizedLocation } : {}),
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
    (value.categoryId === null || typeof value.categoryId === 'string') &&
    (value.viaTimer === undefined || typeof value.viaTimer === 'boolean') &&
    (value.location === undefined || value.location === null || isValidCoordinates(value.location)),
  );
}
