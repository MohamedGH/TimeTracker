/**
 * Timer domain logic. No DOM access.
 */

import { normalizeLocation } from './geo/geo-location.js';

export function createTimerState(timer = null) {
  if (!timer) return null;
  const location = normalizeLocation(timer.location);
  return {
    ...timer,
    categoryId: timer.categoryId ?? timer.cat ?? null,
    ...(location ? { location } : {}),
  };
}

export function createActiveTimer({
  activity,
  categoryId,
  cat = categoryId,
  startTs = Date.now(),
  startTime,
  date,
  location = null,
}) {
  const resolvedCategoryId = categoryId ?? cat;
  if (!activity || !resolvedCategoryId || !Number.isFinite(startTs) || !startTime || !date) {
    throw new Error('Timer invalide.');
  }
  const normalizedLocation = normalizeLocation(location);
  return {
    activity,
    categoryId: resolvedCategoryId,
    cat: resolvedCategoryId,
    startTs,
    startTime,
    date,
    ...(normalizedLocation ? { location: normalizedLocation } : {}),
  };
}

export function elapsedMinutes(timer, now = Date.now()) {
  if (!timer) return 0;
  return Math.max(0, Math.floor((now - timer.startTs) / 60000));
}

export function elapsedSeconds(timer, now = Date.now()) {
  if (!timer) return 0;
  return Math.max(0, Math.floor((now - timer.startTs) / 1000));
}

export function timerToEntry(timer, endTime, endDate, id = crypto.randomUUID()) {
  if (!timer) throw new Error('Aucun timer actif.');
  const normalizedLocation = normalizeLocation(timer.location);
  return {
    id,
    activity: timer.activity,
    categoryId: timer.categoryId ?? timer.cat ?? null,
    date: timer.date,
    start: timer.startTime,
    end: endTime,
    ...(endDate ? { endDate } : {}),
    mins: elapsedMinutes(timer),
    viaTimer: true,
    ...(normalizedLocation ? { location: normalizedLocation } : {}),
  };
}
