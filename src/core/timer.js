/**
 * Timer domain logic. No DOM access.
 */

import { normalizeLocation } from './geo/geo-location.js';

export function createTimerState(timer = null) {
  if (!timer) return null;
  const startLocation = normalizeLocation(timer.startLocation ?? timer.location);
  const { location: _legacyLoc, ...rest } = timer;
  return {
    ...rest,
    categoryId: timer.categoryId ?? timer.cat ?? null,
    ...(startLocation ? { startLocation } : {}),
  };
}

export function createActiveTimer({
  activity,
  categoryId,
  cat = categoryId,
  startTs = Date.now(),
  startTime,
  date,
  startLocation = null,
  location = null,
}) {
  const resolvedCategoryId = categoryId ?? cat;
  if (!activity || !resolvedCategoryId || !Number.isFinite(startTs) || !startTime || !date) {
    throw new Error('Timer invalide.');
  }
  const normalizedStart = normalizeLocation(startLocation ?? location);
  return {
    activity,
    categoryId: resolvedCategoryId,
    cat: resolvedCategoryId,
    startTs,
    startTime,
    date,
    ...(normalizedStart ? { startLocation: normalizedStart } : {}),
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

export function timerToEntry(timer, endTime, endDate, id = crypto.randomUUID(), endLocation = null) {
  if (!timer) throw new Error('Aucun timer actif.');
  const startLocation = normalizeLocation(timer.startLocation ?? timer.location);
  const normalizedEnd = normalizeLocation(endLocation);
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
    ...(startLocation ? { startLocation } : {}),
    ...(normalizedEnd ? { endLocation: normalizedEnd } : {}),
  };
}
