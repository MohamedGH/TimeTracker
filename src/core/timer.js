/**
 * Timer domain logic. No DOM access.
 * The Vue migration can expose this through a useTimer() composable.
 */

export function createTimerState(timer = null) {
  return timer ? { ...timer } : null;
}

export function createActiveTimer({ activity, cat, sub = null, startTs = Date.now(), startTime, date }) {
  if (!activity || !cat || !Number.isFinite(startTs) || !startTime || !date) {
    throw new Error('Timer invalide.');
  }

  return { activity, cat, sub, startTs, startTime, date };
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
    cat: timer.cat,
    sub: timer.sub ?? null,
    date: timer.date,
    start: timer.startTime,
    end: endTime,
    endDate,
    mins: elapsedMinutes(timer),
  };
}
