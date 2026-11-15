/**
 * Statistics & Aggregation Module — Pure functional domain logic for TimeTracker.
 * Calculates period metrics, recursive category breakdowns, and activity frequencies.
 */

import { splitEntryByDay, today } from './time.js';
import { getDescendants } from './category-tree.js';

export const PERIODS = Object.freeze({
  TODAY: 'today',
  DAYS_7: '7',
  DAYS_14: '14',
  DAYS_30: '30',
  MONTH: 'month',
  DAYS_90: '90',
  ALL: 'all',
});

/**
 * Filters and normalizes entries within a specified date window.
 * Splits cross-midnight entries cleanly into their respective days.
 * Pure function: (entries, period, referenceDate) -> normalizedEntries
 */
export function filterEntriesByPeriod(entries = [], period = PERIODS.DAYS_7, refDate = today()) {
  const dateRange = getDateRangeForPeriod(period, refDate);
  const splitted = entries.flatMap(splitEntryByDay);

  if (!dateRange) return splitted;

  return splitted.filter(entry => {
    if (!entry.date) return false;
    return entry.date >= dateRange.min && entry.date <= dateRange.max;
  });
}

/**
 * Calculates start and end YYYY-MM-DD for a given period.
 * Pure function: (period, referenceDate) -> { min: string, max: string } | null
 */
export function getDateRangeForPeriod(period, refDate = today()) {
  const end = new Date(`${refDate}T12:00:00`);
  if (Number.isNaN(end.getTime())) return null;

  const max = refDate;

  if (period === PERIODS.TODAY || period === '1') {
    return { min: max, max };
  }

  if (period === PERIODS.MONTH) {
    const min = `${refDate.slice(0, 7)}-01`;
    return { min, max };
  }

  if (period === PERIODS.ALL) {
    return null; // no date boundary
  }

  const days = Number(period) || 7;
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  const min = start.toISOString().slice(0, 10);

  return { min, max };
}

/**
 * Aggregates duration by category, rolling up sub-category minutes to their ancestors.
 * Pure function: (entries, categories) -> CategoryAggregate[]
 */
export function aggregateCategoryBreakdown(entries = [], categories = []) {
  const directMinsMap = new Map();
  const directCountMap = new Map();

  for (const entry of entries) {
    const mins = Math.max(0, Number(entry.mins) || 0);
    const catId = entry.categoryId || '__uncategorized__';
    directMinsMap.set(catId, (directMinsMap.get(catId) || 0) + mins);
    directCountMap.set(catId, (directCountMap.get(catId) || 0) + 1);
  }

  const totalPeriodMins = [...directMinsMap.values()].reduce((sum, v) => sum + v, 0);

  // For each category, compute its total (direct + all its descendants)
  const result = categories.map(cat => {
    const descendantIds = new Set(getDescendants(categories, cat.id).map(d => d.id));
    descendantIds.add(cat.id);

    let recursiveMins = 0;
    let recursiveCount = 0;
    for (const [id, mins] of directMinsMap.entries()) {
      if (descendantIds.has(id)) {
        recursiveMins += mins;
        recursiveCount += directCountMap.get(id) || 0;
      }
    }

    const directMins = directMinsMap.get(cat.id) || 0;
    const percentage = totalPeriodMins > 0 ? (recursiveMins / totalPeriodMins) * 100 : 0;

    return {
      id: cat.id,
      label: cat.label,
      color: cat.color || '#948C7E',
      parentId: cat.parentId ?? null,
      directMins,
      totalMins: recursiveMins,
      count: recursiveCount,
      percentage: Math.round(percentage * 10) / 10,
      percentageFormatted: `${(Math.round(percentage * 10) / 10).toFixed(1)}%`,
      formattedTotal: formatDuration(recursiveMins),
      hasChildren: categories.some(c => c.parentId === cat.id),
    };
  });

  // Include uncategorized if any exists
  const uncategorizedMins = directMinsMap.get('__uncategorized__') || 0;
  if (uncategorizedMins > 0) {
    const pct = totalPeriodMins > 0 ? (uncategorizedMins / totalPeriodMins) * 100 : 0;
    result.push({
      id: '__uncategorized__',
      label: 'Sans catégorie',
      color: '#B0B0B0',
      parentId: null,
      directMins: uncategorizedMins,
      totalMins: uncategorizedMins,
      count: directCountMap.get('__uncategorized__') || 0,
      percentage: Math.round(pct * 10) / 10,
      percentageFormatted: `${(Math.round(pct * 10) / 10).toFixed(1)}%`,
      formattedTotal: formatDuration(uncategorizedMins),
      hasChildren: false,
    });
  }

  // Filter to roots or categories with activity, sorted descending by total time
  return result
    .filter(c => c.totalMins > 0)
    .sort((a, b) => b.totalMins - a.totalMins);
}

/**
 * Aggregates top recurring activities by frequency and total time.
 * Pure function: (entries, categories, limit = 10) -> ActivityAggregate[]
 */
export function aggregateTopActivities(entries = [], categories = [], limit = 10) {
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const byActivity = new Map();

  for (const entry of entries) {
    const rawName = String(entry.activity || '').trim();
    if (!rawName) continue;
    const key = rawName.toLowerCase();
    const mins = Math.max(0, Number(entry.mins) || 0);

    if (!byActivity.has(key)) {
      byActivity.set(key, {
        name: rawName,
        categoryId: entry.categoryId ?? null,
        count: 0,
        totalMins: 0,
        recentDate: entry.date,
      });
    }

    const record = byActivity.get(key);
    record.count += 1;
    record.totalMins += mins;
    if (entry.date && (!record.recentDate || entry.date > record.recentDate)) {
      record.recentDate = entry.date;
      record.categoryId = entry.categoryId ?? record.categoryId;
    }
  }

  const totalPeriodMins = entries.reduce((s, e) => s + (Math.max(0, Number(e.mins) || 0)), 0);

  return [...byActivity.values()]
    .map(item => {
      const cat = item.categoryId ? categoryMap.get(item.categoryId) : null;
      const pct = totalPeriodMins > 0 ? (item.totalMins / totalPeriodMins) * 100 : 0;
      return {
        name: item.name,
        categoryId: item.categoryId,
        categoryLabel: cat ? cat.label : 'Sans catégorie',
        categoryColor: cat?.color || '#948C7E',
        count: item.count,
        totalMins: item.totalMins,
        avgMins: Math.round(item.totalMins / item.count),
        percentage: Math.round(pct * 10) / 10,
        formattedTotal: formatDuration(item.totalMins),
        formattedAvg: formatDuration(Math.round(item.totalMins / item.count)),
        recentDate: item.recentDate,
      };
    })
    .sort((a, b) => b.totalMins - a.totalMins || b.count - a.count)
    .slice(0, limit);
}

/**
 * Calculates complete dashboard metrics answering all key user questions:
 * - Où ai-je passé mon temps ?
 * - Combien de temps aujourd'hui ?
 * - Quelles catégories prennent le plus de temps ?
 * - Quelles activités reviennent le plus souvent ?
 *
 * Pure function: (entries, categories, period, refDate) -> DashboardStats
 */
export function calculateDashboardStats(allEntries = [], categories = [], period = PERIODS.DAYS_7, refDate = today()) {
  const periodEntries = filterEntriesByPeriod(allEntries, period, refDate);
  const todayEntries = filterEntriesByPeriod(allEntries, PERIODS.TODAY, refDate);

  const totalMinutes = periodEntries.reduce((sum, e) => sum + (Math.max(0, Number(e.mins) || 0)), 0);
  const todayMinutes = todayEntries.reduce((sum, e) => sum + (Math.max(0, Number(e.mins) || 0)), 0);

  const activeDates = new Set(periodEntries.map(e => e.date).filter(Boolean));
  const activeDaysCount = activeDates.size;
  const dailyAverageMinutes = activeDaysCount > 0 ? Math.round(totalMinutes / activeDaysCount) : 0;

  const categoryBreakdown = aggregateCategoryBreakdown(periodEntries, categories);
  const rootCategoryBreakdown = categoryBreakdown.filter(c => !c.parentId);
  const topActivities = aggregateTopActivities(periodEntries, categories, 6);

  // Hourly distribution
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const e of periodEntries) {
    const mins = Math.max(0, Number(e.mins) || 0);
    const hour = Number(String(e.start || '').slice(0, 2));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
      byHour[hour] += mins;
    }
  }

  // Daily totals
  const byDayMap = new Map();
  for (const e of periodEntries) {
    if (!e.date) continue;
    const mins = Math.max(0, Number(e.mins) || 0);
    byDayMap.set(e.date, (byDayMap.get(e.date) || 0) + mins);
  }
  const dailyTrends = [...byDayMap.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, mins]) => ({ date, mins, formatted: formatDuration(mins) }));

  return {
    period,
    entryCount: periodEntries.length,
    totalMinutes,
    formattedTotal: formatDuration(totalMinutes),
    todayMinutes,
    formattedToday: formatDuration(todayMinutes),
    activeDaysCount,
    dailyAverageMinutes,
    formattedDailyAverage: formatDuration(dailyAverageMinutes),
    categoryBreakdown,
    rootCategoryBreakdown,
    topCategories: rootCategoryBreakdown.slice(0, 5),
    topActivities,
    hourlyDistribution: byHour,
    dailyTrends,
  };
}

/**
 * Formats minutes into human-readable French format: "3h 45m" or "25m".
 * Pure function: number -> string
 */
export function formatDuration(totalMinutes = 0) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;

  if (hours === 0) return `${remainingMins} min`;
  if (remainingMins === 0) return `${hours} h`;
  return `${hours} h ${String(remainingMins).padStart(2, '0')}`;
}
