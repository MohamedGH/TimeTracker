/**
 * Timer domain logic. No DOM access.
 */

export function createTimerState(timer = null) {
  return timer ? { ...timer, categoryId: timer.categoryId ?? timer.cat ?? null } : null;
}

export function createActiveTimer({ activity, categoryId, cat = categoryId, startTs = Date.now(), startTime, date }) {
  const resolvedCategoryId = categoryId ?? cat;
  if (!activity || !resolvedCategoryId || !Number.isFinite(startTs) || !startTime || !date) {
    throw new Error('Timer invalide.');
  }
  return {
    activity,
    categoryId: resolvedCategoryId,
    cat: resolvedCategoryId,
    startTs,
    startTime,
    date,
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
  return {
    id,
    activity: timer.activity,
    categoryId: timer.categoryId ?? timer.cat ?? null,
    date: timer.date,
    start: timer.startTime,
    end: endTime,
    ...(endDate ? { endDate } : {}),
    mins: elapsedMinutes(timer),
  };
}
