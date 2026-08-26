import type { TimeEntry } from '../types';
import { durationBetween } from './time';

export function createTimeEntry({
  id,
  activity = '',
  categoryId = null,
  date,
  start,
  end,
  endDate,
  mins,
}: {
  id: string;
  activity?: string;
  categoryId?: string | null;
  date: string;
  start: string;
  end: string;
  endDate?: string;
  mins?: number;
}): TimeEntry {
  const duration = typeof mins === 'number' && Number.isFinite(mins)
    ? Math.max(0, mins)
    : durationBetween(start, end);

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

export function updateTimeEntry(entry: TimeEntry, changes: Partial<TimeEntry>): TimeEntry {
  return createTimeEntry({ ...entry, ...changes });
}

export function isTimeEntry(value: any): value is TimeEntry {
  return Boolean(
    value &&
    typeof value.id === 'string' &&
    typeof value.activity === 'string' &&
    typeof value.date === 'string' &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    typeof value.mins === 'number' &&
    Number.isFinite(value.mins) &&
    (value.categoryId === null || typeof value.categoryId === 'string'),
  );
}
