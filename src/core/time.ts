import type { TimeEntry } from '../types';

export function durationBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return 0;
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function splitEntryByDay(entry: TimeEntry): TimeEntry[] {
  if (!entry.endDate || entry.endDate === entry.date) return [entry];
  // Simple representation for multi-day entries
  return [entry];
}
