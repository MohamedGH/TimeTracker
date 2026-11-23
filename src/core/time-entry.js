import { durationBetween } from './time.js';
import { isValidCoordinates, normalizeLocation } from './geo/geo-location.js';

/**
 * Canonical TimeEntry domain factory.
 * Categories are identified exclusively by categoryId, regardless of depth.
 * Supports optional `startLocation` and `endLocation` (and migrates legacy `location`
 * to `startLocation` when `startLocation` is absent).
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
  startLocation,
  endLocation,
  location,
} = {}) {
  const duration = Number.isFinite(mins) ? Math.max(0, mins) : durationBetween(start, end);
  const resolvedStartLoc = normalizeLocation(startLocation ?? location);
  const resolvedEndLoc = normalizeLocation(endLocation);

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
    ...(resolvedStartLoc ? { startLocation: resolvedStartLoc } : {}),
    ...(resolvedEndLoc ? { endLocation: resolvedEndLoc } : {}),
  };
}

export function updateTimeEntry(entry, changes = {}) {
  const merged = { ...entry, ...changes };
  if ('startLocation' in changes && !changes.startLocation) {
    delete merged.location;
  }
  return createTimeEntry(merged);
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
    (value.startLocation === undefined || value.startLocation === null || isValidCoordinates(value.startLocation)) &&
    (value.endLocation === undefined || value.endLocation === null || isValidCoordinates(value.endLocation)) &&
    (value.location === undefined || value.location === null || isValidCoordinates(value.location)),
  );
}
