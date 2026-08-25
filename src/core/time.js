/**
 * Pure time utilities used by the TimeTracker domain.
 * No DOM, IndexedDB or global application state.
 */

export const MINUTES_PER_DAY = 24 * 60;

export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

export function formatTime(totalMinutes) {
  const minutes = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function durationBetween(start, end) {
  const startMinutes = parseTime(start);
  const endMinutes = parseTime(end);
  if (startMinutes === null || endMinutes === null) return 0;

  return endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : MINUTES_PER_DAY - startMinutes + endMinutes;
}

/**
 * Split an entry at midnight. This keeps statistics day-based while allowing
 * the editor to keep the original cross-midnight interval.
 */
export function splitEntryByDay(entry) {
  const start = parseTime(entry.start);
  const end = parseTime(entry.end);
  if (start === null || end === null || !entry.date) return [];

  if (end >= start) {
    return [{ ...entry, date: entry.date, startMinutes: start, endMinutes: end, mins: end - start }];
  }

  return [
    { ...entry, date: entry.date, startMinutes: start, endMinutes: MINUTES_PER_DAY, mins: MINUTES_PER_DAY - start },
    { ...entry, date: addDays(entry.date, 1), startMinutes: 0, endMinutes: end, mins: end },
  ].filter(segment => segment.mins > 0);
}

export function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function elapsedMinutes(startTs, nowTs = Date.now()) {
  if (!Number.isFinite(startTs)) return 0;
  return Math.max(0, Math.floor((nowTs - startTs) / 60000));
}
