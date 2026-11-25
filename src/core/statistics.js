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
  CUSTOM: 'custom',
});

/**
 * Filters and normalizes entries within a specified date window.
 * Splits cross-midnight entries cleanly into their respective days.
 * Pure function: (entries, period, referenceDate, customRange) -> normalizedEntries
 */
export function filterEntriesByPeriod(
  entries = [],
  period = PERIODS.DAYS_7,
  refDate = today(),
  customRange = null
) {
  const effectiveRange = (customRange && typeof customRange === 'object' && customRange.customRange)
    ? customRange.customRange
    : customRange;
  const dateRange = getDateRangeForPeriod(period, refDate, effectiveRange);
  const splitted = entries.flatMap(splitEntryByDay);

  if (!dateRange) return splitted;

  return splitted.filter(entry => {
    if (!entry.date) return false;
    if (dateRange.min && entry.date < dateRange.min) return false;
    if (dateRange.max && entry.date > dateRange.max) return false;
    return true;
  });
}

/**
 * Calculates start and end YYYY-MM-DD for a given period.
 * Pure function: (period, referenceDate, customRange) -> { min: string, max: string } | null
 */
export function getDateRangeForPeriod(period, refDate = today(), customRange = null) {
  const effectiveRange = (customRange && typeof customRange === 'object' && customRange.customRange)
    ? customRange.customRange
    : customRange;
  const end = new Date(`${refDate}T12:00:00`);
  if (Number.isNaN(end.getTime())) return null;

  const max = refDate;

  if (period === PERIODS.CUSTOM) {
    const start = typeof effectiveRange?.start === 'string' && effectiveRange.start ? effectiveRange.start : null;
    const customEnd = typeof effectiveRange?.end === 'string' && effectiveRange.end ? effectiveRange.end : null;
    if (!start && !customEnd) return null;
    if (start && customEnd && start > customEnd) {
      return { min: customEnd, max: start };
    }
    return { min: start || '0000-01-01', max: customEnd || '9999-12-31' };
  }

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
  const directMaxMap = new Map();

  for (const entry of entries) {
    const mins = Math.max(0, Number(entry.mins) || 0);
    const catId = entry.categoryId || '__uncategorized__';
    directMinsMap.set(catId, (directMinsMap.get(catId) || 0) + mins);
    directCountMap.set(catId, (directCountMap.get(catId) || 0) + 1);
    directMaxMap.set(catId, Math.max(directMaxMap.get(catId) || 0, mins));
  }

  const totalPeriodMins = [...directMinsMap.values()].reduce((sum, v) => sum + v, 0);

  // For each category, compute its total (direct + all its descendants)
  const result = categories.map(cat => {
    const descendantIds = new Set(getDescendants(categories, cat.id).map(d => d.id));
    descendantIds.add(cat.id);

    let recursiveMins = 0;
    let recursiveCount = 0;
    let recursiveMax = 0;
    for (const [id, mins] of directMinsMap.entries()) {
      if (descendantIds.has(id)) {
        recursiveMins += mins;
        recursiveCount += directCountMap.get(id) || 0;
        recursiveMax = Math.max(recursiveMax, directMaxMap.get(id) || 0);
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
      max: recursiveMax,
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
        maxMins: 0,
        recentDate: entry.date,
      });
    }

    const record = byActivity.get(key);
    record.count += 1;
    record.totalMins += mins;
    record.maxMins = Math.max(record.maxMins || 0, mins);
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
        maxMins: item.maxMins || 0,
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
 * Filters entries belonging to a category or any of its descendant subcategories.
 * Pure function: (entries, categories, categoryId) -> entries[]
 */
export function filterEntriesByCategorySubtree(entries = [], categories = [], categoryId = 'all') {
  if (!categoryId || categoryId === 'all' || categoryId === 'global') {
    return entries;
  }
  if (categoryId === '__uncategorized__') {
    return entries.filter(e => !e.categoryId);
  }
  const allowedIds = new Set(getDescendants(categories, categoryId).map(d => d.id));
  allowedIds.add(categoryId);
  return entries.filter(e => allowedIds.has(e.categoryId));
}

/**
 * Calculates complete dashboard metrics answering all key user questions:
 * - Où ai-je passé mon temps ?
 * - Combien de temps aujourd'hui ?
 * - Quelles catégories prennent le plus de temps ?
 * - Quelles activités reviennent le plus souvent ?
 *
 * Pure function: (entries, categories, period, refDate, options) -> DashboardStats
 */
export function calculateDashboardStats(
  allEntries = [],
  categories = [],
  period = PERIODS.DAYS_7,
  refDate = today(),
  options = {}
) {
  const { customRange = null, categoryFilter = 'all' } = options || {};
  const scopedEntries = filterEntriesByCategorySubtree(allEntries, categories, categoryFilter);
  const periodEntries = filterEntriesByPeriod(scopedEntries, period, refDate, customRange);
  const todayEntries = filterEntriesByPeriod(scopedEntries, PERIODS.TODAY, refDate);

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

const WEEKDAY_LABELS = Object.freeze(['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']);
const MONDAY_FIRST_INDEXES = Object.freeze([1, 2, 3, 4, 5, 6, 0]);
const TIME_BANDS = Object.freeze([
  { id: 'night', label: 'Nuit (00-06h)', minHour: 0, maxHour: 6 },
  { id: 'morning', label: 'Matin (06-12h)', minHour: 6, maxHour: 12 },
  { id: 'afternoon', label: 'Après-midi (12-18h)', minHour: 12, maxHour: 18 },
  { id: 'evening', label: 'Soir (18-24h)', minHour: 18, maxHour: 24 },
]);

function formatMetricValue(value, metric) {
  if (metric === 'count') {
    const n = Math.round(value);
    return `${n} session${n > 1 ? 's' : ''}`;
  }
  return formatDuration(value);
}

function selectMetricValue(item, metric) {
  if (!item) return 0;
  if (metric === 'count') return item.count || 0;
  if (metric === 'avg') return item.count > 0 ? Math.round((item.minutes || 0) / item.count) : 0;
  if (metric === 'max') return item.max || item.maxMins || 0;
  return item.minutes || 0;
}

function buildRootResolver(categories = []) {
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  return (catId) => {
    if (!catId) return { id: '__uncategorized__', label: 'Sans catégorie', color: '#948C7E' };
    let current = categoryMap.get(catId);
    if (!current) return { id: '__uncategorized__', label: 'Sans catégorie', color: '#948C7E' };
    const visited = new Set();
    while (current.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = categoryMap.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return { id: current.id, label: current.label, color: current.color || '#6E7F72' };
  };
}

function finalizeSeries(items = [], metric = 'minutes') {
  const totalValue = items.reduce((s, item) => s + Math.max(0, item.value || 0), 0);
  const totalMinutes = items.reduce((s, item) => s + Math.max(0, item.minutes || 0), 0);
  const totalCount = items.reduce((s, item) => s + Math.max(0, item.count || 0), 0);

  const series = items.map(item => {
    const value = Math.max(0, Number(item.value) || 0);
    const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
    return {
      ...item,
      value,
      formattedValue: formatMetricValue(value, metric),
      avgMinutes: item.count > 0 ? Math.round(item.minutes / item.count) : 0,
      formattedMinutes: formatDuration(item.minutes),
      formattedAvg: formatDuration(item.count > 0 ? Math.round(item.minutes / item.count) : 0),
      sharePct: Math.round(pct * 10) / 10,
      shareFormatted: `${(Math.round(pct * 10) / 10).toFixed(1)}%`,
    };
  });

  return {
    metric,
    unit: metric === 'count' ? 'sessions' : 'min',
    totalValue,
    totalMinutes,
    totalCount,
    formattedTotal: metric === 'avg'
      ? formatMetricValue(totalCount > 0 ? Math.round(totalMinutes / totalCount) : 0, 'avg')
      : formatMetricValue(totalValue, metric),
    empty: series.every(s => s.value === 0) || series.length === 0,
    series,
  };
}

/**
 * Builds a normalized dataset for any customizable dashboard chart widget.
 * Pure function: ({ entries, categories, dataSource, metric, period, customRange, categoryFilter, refDate }) -> Dataset
 */
export function buildCustomDashboardDataset({
  entries = [],
  categories = [],
  dataSource = 'daily',
  metric = 'minutes',
  period = PERIODS.DAYS_7,
  customRange = null,
  categoryFilter = 'global',
  timeGrain = 'day',
  refDate = today(),
} = {}) {
  const periodEntries = filterEntriesByPeriod(
    filterEntriesByCategorySubtree(entries, categories, categoryFilter),
    period,
    refDate,
    customRange
  );

  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const resolveRoot = buildRootResolver(categories);

  if (dataSource === 'daily') {
    const byDay = new Map();
    const stackMeta = new Map();

    for (const entry of periodEntries) {
      if (!entry.date) continue;
      const mins = Math.max(0, Number(entry.mins) || 0);
      const root = resolveRoot(entry.categoryId);
      stackMeta.set(root.id, root);

      if (!byDay.has(entry.date)) {
        byDay.set(entry.date, {
          date: entry.date,
          minutes: 0,
          count: 0,
          max: 0,
          byStack: new Map(),
        });
      }
      const bucket = byDay.get(entry.date);
      bucket.minutes += mins;
      bucket.count += 1;
      bucket.max = Math.max(bucket.max || 0, mins);

      const prevStack = bucket.byStack.get(root.id) || { minutes: 0, count: 0, max: 0 };
      bucket.byStack.set(root.id, {
        minutes: prevStack.minutes + mins,
        count: prevStack.count + 1,
        max: Math.max(prevStack.max || 0, mins),
      });
    }

    const dateRange = getDateRangeForPeriod(period, refDate, customRange);
    if (dateRange && dateRange.min && dateRange.max) {
      const dStart = new Date(`${dateRange.min}T12:00:00`);
      const dEnd = new Date(`${dateRange.max}T12:00:00`);
      const diffDays = Math.round((dEnd.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 62) {
        const curr = new Date(dStart);
        while (curr <= dEnd) {
          const ymd = curr.toISOString().slice(0, 10);
          if (!byDay.has(ymd)) {
            byDay.set(ymd, {
              date: ymd,
              minutes: 0,
              count: 0,
              max: 0,
              byStack: new Map(),
            });
          }
          curr.setDate(curr.getDate() + 1);
        }
      }
    }

    const sortedDays = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    const stacks = [...stackMeta.values()];

    let processedDays = sortedDays;

    if (timeGrain === 'cumulative') {
      let cumMins = 0;
      let cumCount = 0;
      let cumMax = 0;
      const stackRunning = new Map();

      processedDays = sortedDays.map(day => {
        cumMins += day.minutes;
        cumCount += day.count;
        cumMax = Math.max(cumMax, day.max || 0);

        const cumByStack = new Map();
        for (const stack of stacks) {
          const prev = stackRunning.get(stack.id) || 0;
          const st = day.byStack.get(stack.id) || { minutes: 0, count: 0, max: 0 };
          const next = prev + st.minutes;
          stackRunning.set(stack.id, next);
          cumByStack.set(stack.id, { minutes: next, count: cumCount, max: cumMax });
        }

        return {
          date: day.date,
          label: day.date.slice(5).replace('-', '/'),
          minutes: cumMins,
          count: cumCount,
          max: cumMax,
          byStack: cumByStack,
        };
      });
    } else if (timeGrain === 'week') {
      const byWeek = new Map();
      for (const day of sortedDays) {
        const d = new Date(`${day.date}T12:00:00`);
        const dayOfWeek = d.getDay();
        const diff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
        d.setDate(d.getDate() + diff);
        const weekKey = d.toISOString().slice(0, 10);

        if (!byWeek.has(weekKey)) {
          byWeek.set(weekKey, {
            date: weekKey,
            label: `Sem. ${weekKey.slice(5).replace('-', '/')}`,
            minutes: 0,
            count: 0,
            max: 0,
            byStack: new Map(),
          });
        }
        const wBucket = byWeek.get(weekKey);
        wBucket.minutes += day.minutes;
        wBucket.count += day.count;
        wBucket.max = Math.max(wBucket.max, day.max || 0);

        for (const stack of stacks) {
          const st = day.byStack.get(stack.id) || { minutes: 0, count: 0, max: 0 };
          const prevSt = wBucket.byStack.get(stack.id) || { minutes: 0, count: 0, max: 0 };
          wBucket.byStack.set(stack.id, {
            minutes: prevSt.minutes + st.minutes,
            count: prevSt.count + st.count,
            max: Math.max(prevSt.max, st.max || 0),
          });
        }
      }
      processedDays = [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
    } else if (timeGrain === 'month') {
      const byMonth = new Map();
      for (const day of sortedDays) {
        const monthKey = day.date.slice(0, 7);
        if (!byMonth.has(monthKey)) {
          byMonth.set(monthKey, {
            date: `${monthKey}-01`,
            label: `${monthKey.slice(5)}/${monthKey.slice(0, 4)}`,
            minutes: 0,
            count: 0,
            max: 0,
            byStack: new Map(),
          });
        }
        const mBucket = byMonth.get(monthKey);
        mBucket.minutes += day.minutes;
        mBucket.count += day.count;
        mBucket.max = Math.max(mBucket.max, day.max || 0);

        for (const stack of stacks) {
          const st = day.byStack.get(stack.id) || { minutes: 0, count: 0, max: 0 };
          const prevSt = mBucket.byStack.get(stack.id) || { minutes: 0, count: 0, max: 0 };
          mBucket.byStack.set(stack.id, {
            minutes: prevSt.minutes + st.minutes,
            count: prevSt.count + st.count,
            max: Math.max(prevSt.max, st.max || 0),
          });
        }
      }
      processedDays = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
    }

    const seriesItems = processedDays.map(day => {
      const value = selectMetricValue(day, metric);
      return {
        key: day.date,
        label: day.label || day.date.slice(5).replace('-', '/'),
        fullLabel: day.date,
        color: '#3F7068',
        minutes: day.minutes,
        count: day.count,
        max: day.max,
        value,
      };
    });

    const rows = processedDays.map(day => {
      const valuesByStack = {};
      for (const stack of stacks) {
        const st = day.byStack.get(stack.id) || { minutes: 0, count: 0, max: 0 };
        valuesByStack[stack.id] = selectMetricValue(st, metric);
      }
      return {
        date: day.date,
        label: day.label || day.date.slice(5).replace('-', '/'),
        total: selectMetricValue(day, metric),
        minutes: day.minutes,
        count: day.count,
        max: day.max,
        valuesByStack,
      };
    });

    return {
      dataSource,
      timeGrain,
      ...finalizeSeries(seriesItems, metric),
      stacks,
      rows,
    };
  }

  if (dataSource === 'categories') {
    const breakdown = aggregateCategoryBreakdown(periodEntries, categories)
      .filter(c => !c.parentId || c.id === '__uncategorized__');
    const items = breakdown.map(c => ({
      key: c.id,
      label: c.label,
      color: c.color,
      minutes: c.totalMins,
      count: c.count,
      max: c.max,
      value: selectMetricValue({ minutes: c.totalMins, count: c.count, max: c.max }, metric),
    }));
    items.sort((a, b) => b.value - a.value);
    return { dataSource, ...finalizeSeries(items, metric) };
  }

  if (dataSource === 'subcategories') {
    const directMap = new Map();
    for (const entry of periodEntries) {
      const mins = Math.max(0, Number(entry.mins) || 0);
      const id = entry.categoryId || '__uncategorized__';
      const prev = directMap.get(id) || { minutes: 0, count: 0, max: 0 };
      directMap.set(id, {
        minutes: prev.minutes + mins,
        count: prev.count + 1,
        max: Math.max(prev.max || 0, mins),
      });
    }
    const items = [...directMap.entries()].map(([id, agg]) => {
      const cat = id === '__uncategorized__' ? null : categoryMap.get(id);
      return {
        key: id,
        label: cat ? cat.label : 'Sans catégorie',
        color: cat?.color || '#948C7E',
        minutes: agg.minutes,
        count: agg.count,
        max: agg.max,
        value: selectMetricValue(agg, metric),
      };
    }).sort((a, b) => b.value - a.value);
    return { dataSource, ...finalizeSeries(items, metric) };
  }

  if (dataSource === 'activities') {
    const top = aggregateTopActivities(periodEntries, categories, 12);
    const items = top.map(act => ({
      key: act.name,
      label: act.name,
      subLabel: act.categoryLabel,
      color: act.categoryColor,
      minutes: act.totalMins,
      count: act.count,
      max: act.maxMins,
      value: selectMetricValue({ minutes: act.totalMins, count: act.count, max: act.maxMins }, metric),
    })).sort((a, b) => b.value - a.value);
    return { dataSource, ...finalizeSeries(items, metric) };
  }

  if (dataSource === 'hourly') {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      minutes: 0,
      count: 0,
      max: 0,
    }));
    for (const entry of periodEntries) {
      const mins = Math.max(0, Number(entry.mins) || 0);
      const hour = Number(String(entry.start || '').slice(0, 2));
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
        buckets[hour].minutes += mins;
        buckets[hour].count += 1;
        buckets[hour].max = Math.max(buckets[hour].max, mins);
      }
    }
    const items = buckets.map(b => ({
      key: String(b.hour),
      label: `${String(b.hour).padStart(2, '0')}h`,
      color: '#4A5A75',
      minutes: b.minutes,
      count: b.count,
      max: b.max,
      value: selectMetricValue(b, metric),
    }));
    return { dataSource, ...finalizeSeries(items, metric) };
  }

  if (dataSource === 'weekday') {
    const buckets = Array.from({ length: 7 }, (_, idx) => ({
      dayIdx: idx,
      minutes: 0,
      count: 0,
      max: 0,
    }));
    for (const entry of periodEntries) {
      if (!entry.date) continue;
      const d = new Date(`${entry.date}T12:00:00`);
      if (Number.isNaN(d.getTime())) continue;
      const idx = d.getDay();
      const mins = Math.max(0, Number(entry.mins) || 0);
      buckets[idx].minutes += mins;
      buckets[idx].count += 1;
      buckets[idx].max = Math.max(buckets[idx].max, mins);
    }
    const items = MONDAY_FIRST_INDEXES.map(dayIdx => {
      const b = buckets[dayIdx];
      return {
        key: String(dayIdx),
        label: WEEKDAY_LABELS[dayIdx],
        color: '#8C6D3F',
        minutes: b.minutes,
        count: b.count,
        max: b.max,
        value: selectMetricValue(b, metric),
      };
    });
    return { dataSource, ...finalizeSeries(items, metric) };
  }

  if (dataSource === 'heatmap') {
    const grid = Array.from({ length: 7 }, () =>
      TIME_BANDS.map(() => ({ minutes: 0, count: 0, max: 0 }))
    );

    for (const entry of periodEntries) {
      if (!entry.date) continue;
      const d = new Date(`${entry.date}T12:00:00`);
      if (Number.isNaN(d.getTime())) continue;
      const monIdx = MONDAY_FIRST_INDEXES.indexOf(d.getDay());
      const hour = Number(String(entry.start || '').slice(0, 2));
      const bandIdx = Number.isInteger(hour) && hour >= 0 && hour < 24
        ? TIME_BANDS.findIndex(b => hour >= b.minHour && hour < b.maxHour)
        : 1;
      const cell = grid[monIdx][Math.max(0, bandIdx)];
      const mins = Math.max(0, Number(entry.mins) || 0);
      cell.minutes += mins;
      cell.count += 1;
      cell.max = Math.max(cell.max, mins);
    }

    const rowLabels = MONDAY_FIRST_INDEXES.map(i => WEEKDAY_LABELS[i]);
    const colLabels = TIME_BANDS.map(b => b.label);
    const cells = [];
    const seriesItems = [];

    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < TIME_BANDS.length; c += 1) {
        const agg = grid[r][c];
        const value = selectMetricValue(agg, metric);
        const cell = {
          rowIdx: r,
          colIdx: c,
          rowLabel: rowLabels[r],
          colLabel: colLabels[c],
          minutes: agg.minutes,
          count: agg.count,
          max: agg.max,
          value,
          formattedValue: formatMetricValue(value, metric),
        };
        cells.push(cell);
        if (value > 0) {
          seriesItems.push({
            key: `${r}-${c}`,
            label: `${rowLabels[r]} · ${colLabels[c]}`,
            color: '#3F7068',
            minutes: agg.minutes,
            count: agg.count,
            max: agg.max,
            value,
          });
        }
      }
    }

    const maxValue = cells.reduce((m, c) => Math.max(m, c.value), 0);
    return {
      dataSource,
      ...finalizeSeries(seriesItems, metric),
      rowLabels,
      colLabels,
      cells,
      maxValue,
    };
  }

  if (dataSource === 'mode') {
    const timerAgg = { minutes: 0, count: 0, max: 0 };
    const manualAgg = { minutes: 0, count: 0, max: 0 };
    for (const entry of periodEntries) {
      const mins = Math.max(0, Number(entry.mins) || 0);
      const isTimer = entry.viaTimer === true || entry.manual === false;
      const target = isTimer ? timerAgg : manualAgg;
      target.minutes += mins;
      target.count += 1;
      target.max = Math.max(target.max, mins);
    }
    const items = [
      {
        id: 'chrono',
        key: 'chrono',
        label: 'Chronomètre',
        color: '#3F7068',
        minutes: timerAgg.minutes,
        count: timerAgg.count,
        max: timerAgg.max,
        value: selectMetricValue(timerAgg, metric),
      },
      {
        id: 'manual',
        key: 'manual',
        label: 'Saisie manuelle',
        color: '#8C6D3F',
        minutes: manualAgg.minutes,
        count: manualAgg.count,
        max: manualAgg.max,
        value: selectMetricValue(manualAgg, metric),
      },
    ].filter(item => item.count > 0 || item.minutes > 0);
    return { dataSource, ...finalizeSeries(items, metric) };
  }

  if (dataSource === 'durationBuckets') {
    const defs = [
      { key: 'lt15', label: '< 15 min', color: '#8B93A1', match: m => m < 15 },
      { key: '15_30', label: '15–30 min', color: '#5C7A5E', match: m => m >= 15 && m < 30 },
      { key: '30_60', label: '30–60 min', color: '#3F7068', match: m => m >= 30 && m < 60 },
      { key: '60_120', label: '1–2 h', color: '#8C6D3F', match: m => m >= 60 && m < 120 },
      { key: 'gt120', label: '> 2 h', color: '#4A5A75', match: m => m >= 120 },
    ];
    const aggs = defs.map(d => ({ ...d, minutes: 0, count: 0 }));
    for (const entry of periodEntries) {
      const mins = Math.max(0, Number(entry.mins) || 0);
      const bucket = aggs.find(b => b.match(mins)) || aggs[0];
      bucket.minutes += mins;
      bucket.count += 1;
    }
    const items = aggs.map(b => ({
      key: b.key,
      label: b.label,
      color: b.color,
      minutes: b.minutes,
      count: b.count,
      value: selectMetricValue(b, metric),
    }));
    return { dataSource, ...finalizeSeries(items, metric) };
  }

  return { dataSource, ...finalizeSeries([], metric) };
}

/**
 * Formats minutes into human-readable French format: "3 h 45" or "25 min".
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
