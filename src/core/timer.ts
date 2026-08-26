import type { ActiveTimer } from '../types';

export function createActiveTimer({
  activity,
  categoryId = null,
  startTs = Date.now(),
  startTime,
  date,
}: {
  activity: string;
  categoryId?: string | null;
  startTs?: number;
  startTime: string;
  date: string;
}): ActiveTimer {
  return {
    activity: activity.trim(),
    categoryId: categoryId ?? null,
    startTs,
    startTime,
    date,
  };
}

export function elapsedSeconds(timer: ActiveTimer, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - timer.startTs) / 1000));
}

export function elapsedMinutes(timer: ActiveTimer, now: number = Date.now()): number {
  return Math.max(0, Math.round((now - timer.startTs) / 60000));
}
