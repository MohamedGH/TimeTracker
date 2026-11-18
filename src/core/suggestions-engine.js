import { MINUTES_PER_DAY, parseTime, today } from './time.js';

/**
 * Suggestions Engine — Pure functional module for local personalized business observations.
 * Analyzes time entries, saved activities, categories, routines, and tracking modes.
 * Every surfaced item includes transparent provenance and cautious wording (never certitudes).
 */

const DEFAULT_RECENT_DAYS = 30;
const DEFAULT_HALF_LIFE_DAYS = 14;
const DEFAULT_MAX_ROUTINE_GAP_MINS = 90;
const DEFAULT_MIN_ORIGIN_SAMPLE = 5;

function parseIsoDateDays(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(utc / 86_400_000);
}

function resolveReferenceDate(entries = [], explicitReferenceDate = null) {
  if (explicitReferenceDate && parseIsoDateDays(explicitReferenceDate) !== null) {
    return explicitReferenceDate;
  }
  let maxDate = null;
  let maxDays = -Infinity;
  for (const entry of entries) {
    const days = parseIsoDateDays(entry?.date);
    if (days !== null && days > maxDays) {
      maxDays = days;
      maxDate = entry.date;
    }
  }
  return maxDate || today();
}

function recencyWeight(entryDateStr, referenceDateStr, halfLifeDays = DEFAULT_HALF_LIFE_DAYS) {
  const entryDays = parseIsoDateDays(entryDateStr);
  const refDays = parseIsoDateDays(referenceDateStr);
  if (entryDays === null || refDays === null) return 0.6;
  const daysAgo = Math.max(0, refDays - entryDays);
  return Math.max(0.15, Math.exp(-daysAgo / Math.max(1, halfLifeDays)));
}

function filterEntriesByRecentWindow(entries = [], { recentDays = DEFAULT_RECENT_DAYS, referenceDate = null } = {}) {
  const refDate = resolveReferenceDate(entries, referenceDate);
  if (!Number.isFinite(recentDays) || recentDays <= 0) {
    return {
      filteredEntries: [...entries],
      referenceDate: refDate,
      periodLabel: 'Historique complet',
    };
  }

  const refDays = parseIsoDateDays(refDate);
  if (refDays === null) {
    return {
      filteredEntries: [...entries],
      referenceDate: refDate,
      periodLabel: `${recentDays} derniers jours`,
    };
  }

  const minDays = refDays - (recentDays - 1);
  const filtered = entries.filter((entry) => {
    const d = parseIsoDateDays(entry?.date);
    return d === null ? true : (d >= minDays && d <= refDays);
  });

  return {
    filteredEntries: filtered,
    referenceDate: refDate,
    periodLabel: `${recentDays} derniers jours`,
  };
}

function circularHourDiff(hourA, hourB) {
  const a = ((Math.round(hourA) % 24) + 24) % 24;
  const b = ((Math.round(hourB) % 24) + 24) % 24;
  const diff = Math.abs(a - b);
  return Math.min(diff, 24 - diff);
}

function circularMinuteDiff(minsA, minsB) {
  const a = ((minsA % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const b = ((minsB % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const diff = Math.abs(a - b);
  return Math.min(diff, MINUTES_PER_DAY - diff);
}

function entryToChronoSpan(entry) {
  const dateDays = parseIsoDateDays(entry?.date);
  const startMins = parseTime(entry?.start);
  if (dateDays === null || startMins === null) return null;

  const parsedEnd = parseTime(entry?.end);
  const explicitEndDays = parseIsoDateDays(entry?.endDate);
  const durationMins = Number.isFinite(Number(entry?.mins)) ? Math.max(0, Number(entry.mins)) : null;

  const startAbs = dateDays * MINUTES_PER_DAY + startMins;
  let endAbs;

  if (parsedEnd !== null) {
    if (explicitEndDays !== null && explicitEndDays >= dateDays) {
      endAbs = explicitEndDays * MINUTES_PER_DAY + parsedEnd;
    } else if (parsedEnd < startMins) {
      // Cross-midnight entry without explicit endDate
      endAbs = (dateDays + 1) * MINUTES_PER_DAY + parsedEnd;
    } else {
      endAbs = dateDays * MINUTES_PER_DAY + parsedEnd;
    }
  } else if (durationMins !== null) {
    endAbs = startAbs + durationMins;
  } else {
    endAbs = startAbs;
  }

  return {
    entry,
    date: entry.date,
    dateDays,
    startMins,
    startAbs,
    endAbs: Math.max(startAbs, endAbs),
  };
}

function computeConfidence({ score = 0, occurrences = 0, distinctDays = 0 } = {}) {
  const normalized = Math.max(0, Math.min(1, Number(score) || 0));
  let level = 'faible';
  let label = 'Faible';

  if (normalized >= 0.72 && occurrences >= 4 && distinctDays >= 3) {
    level = 'élevée';
    label = 'Élevée';
  } else if (normalized >= 0.45 && occurrences >= 2 && distinctDays >= 2) {
    level = 'moyenne';
    label = 'Moyenne';
  }

  return {
    score: Number(normalized.toFixed(2)),
    level,
    label,
  };
}

/**
 * Detailed habitual category analysis for an activity name.
 * Priority 1: explicit saved activity category.
 * Priority 2: recency-weighted entry history, rejecting ambiguous single/tied events.
 */
export function analyzeActivityCategory(
  activityName,
  entries = [],
  activities = [],
  {
    referenceDate = null,
    halfLifeDays = DEFAULT_HALF_LIFE_DAYS,
    minOccurrences = 1,
    minDominanceShare = 0.6,
  } = {},
) {
  const query = String(activityName || '').trim().toLowerCase();
  if (!query) {
    return {
      categoryId: null,
      source: 'none',
      count: 0,
      distinctDays: 0,
      totalOccurrences: 0,
      confidenceShare: 0,
    };
  }

  // 1. Saved activities take priority
  for (const a of activities) {
    const label = String(a?.label || a?.activity || a?.name || '').trim().toLowerCase();
    const catId = a?.categoryId ?? a?.cat ?? null;
    if (label === query && catId) {
      return {
        categoryId: catId,
        source: 'saved_activity',
        count: 1,
        distinctDays: 1,
        totalOccurrences: 1,
        confidenceShare: 1,
      };
    }
  }

  // 2. Analyze entry history
  const matching = entries.filter(e => String(e?.activity || '').trim().toLowerCase() === query);
  if (!matching.length) {
    return {
      categoryId: null,
      source: 'none',
      count: 0,
      distinctDays: 0,
      totalOccurrences: 0,
      confidenceShare: 0,
    };
  }

  const refDate = resolveReferenceDate(matching, referenceDate);
  const statsByCat = new Map();
  let uncategorizedCount = 0;
  let totalCategorizedScore = 0;

  for (const entry of matching) {
    const catId = entry?.categoryId ?? null;
    if (!catId) {
      uncategorizedCount += 1;
      continue;
    }

    const weight = recencyWeight(entry.date, refDate, halfLifeDays);
    totalCategorizedScore += weight;

    if (!statsByCat.has(catId)) {
      statsByCat.set(catId, {
        categoryId: catId,
        score: 0,
        count: 0,
        days: new Set(),
      });
    }
    const stat = statsByCat.get(catId);
    stat.score += weight;
    stat.count += 1;
    if (entry.date) stat.days.add(entry.date);
  }

  if (!statsByCat.size) {
    return {
      categoryId: null,
      source: 'none',
      count: 0,
      distinctDays: 0,
      totalOccurrences: matching.length,
      confidenceShare: 0,
    };
  }

  const ranked = [...statsByCat.values()].sort(
    (a, b) => b.score - a.score || b.count - a.count,
  );
  const top = ranked[0];
  const second = ranked[1] || null;
  const share = totalCategorizedScore > 0 ? top.score / totalCategorizedScore : 0;

  // Ambiguity guards:
  // 1) A single categorized occurrence alongside uncategorized/competing occurrences is ambiguous.
  if (top.count === 1 && (ranked.length > 1 || uncategorizedCount > 0)) {
    return {
      categoryId: null,
      source: 'ambiguous',
      count: top.count,
      distinctDays: top.days.size,
      totalOccurrences: matching.length,
      confidenceShare: Number(share.toFixed(2)),
    };
  }

  // 2) Tie or weak dominance among categories (e.g. 2 vs 2) is ambiguous.
  if (second && (top.count === second.count && Math.abs(top.score - second.score) < 0.25 || share < minDominanceShare)) {
    return {
      categoryId: null,
      source: 'ambiguous',
      count: top.count,
      distinctDays: top.days.size,
      totalOccurrences: matching.length,
      confidenceShare: Number(share.toFixed(2)),
    };
  }

  if (top.count < minOccurrences) {
    return {
      categoryId: null,
      source: 'insufficient',
      count: top.count,
      distinctDays: top.days.size,
      totalOccurrences: matching.length,
      confidenceShare: Number(share.toFixed(2)),
    };
  }

  return {
    categoryId: top.categoryId,
    source: 'history',
    count: top.count,
    distinctDays: top.days.size,
    totalOccurrences: matching.length,
    confidenceShare: Number(share.toFixed(2)),
  };
}

/**
 * Discovers the habitual category for an activity name based on saved activities
 * and non-ambiguous, recency-weighted entry history.
 * Pure function: (activityName, entries, activities, options?) -> categoryId | null
 */
export function getUsualCategoryForActivity(activityName, entries = [], activities = [], options = {}) {
  return analyzeActivityCategory(activityName, entries, activities, options).categoryId;
}

/**
 * Returns distinct recent activities with their usual category and last used date.
 * Pure function: (entries, activities, limit = 5) -> Array<{ name, categoryId, lastDate, count }>
 */
export function getRecentActivities(entries = [], activities = [], limit = 5) {
  const seen = new Set();
  const result = [];

  const sorted = [...entries].sort((a, b) => {
    const dateCmp = (b.date || '').localeCompare(a.date || '');
    if (dateCmp !== 0) return dateCmp;
    return (b.start || '').localeCompare(a.start || '');
  });

  for (const entry of sorted) {
    const name = String(entry.activity || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const categoryId = entry.categoryId || getUsualCategoryForActivity(name, entries, activities);
    result.push({
      name,
      categoryId,
      lastDate: entry.date,
      count: entries.filter(e => String(e.activity || '').trim().toLowerCase() === key).length,
    });

    if (result.length >= limit) break;
  }

  if (result.length < limit) {
    for (const a of activities) {
      const name = String(a.label || a.activity || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          name,
          categoryId: a.categoryId ?? null,
          lastDate: null,
          count: a.useCount || 0,
        });
        if (result.length >= limit) break;
      }
    }
  }

  return result;
}

/**
 * Returns distinct most frequent & regular activities with total/average durations and recency.
 * Pure function: (entries, activities, limit = 5, options?) -> Array<{ name, categoryId, count, totalMins, avgMins, distinctDays, lastDate, regularityScore }>
 */
export function getFrequentActivities(
  entries = [],
  activities = [],
  limit = 5,
  { recentDays = null, referenceDate = null, halfLifeDays = DEFAULT_HALF_LIFE_DAYS } = {},
) {
  const { filteredEntries, referenceDate: refDate } = filterEntriesByRecentWindow(entries, {
    recentDays,
    referenceDate,
  });
  const frequencyMap = new Map();

  for (const entry of filteredEntries) {
    const name = String(entry.activity || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const mins = Math.max(0, Number(entry.mins) || 0);
    const weight = recencyWeight(entry.date, refDate, halfLifeDays);

    if (!frequencyMap.has(key)) {
      frequencyMap.set(key, {
        name,
        count: 0,
        totalMins: 0,
        weightedScore: 0,
        days: new Set(),
        lastDate: entry.date || null,
      });
    }

    const item = frequencyMap.get(key);
    item.count += 1;
    item.totalMins += mins;
    item.weightedScore += weight;
    if (entry.date) {
      item.days.add(entry.date);
      if (!item.lastDate || entry.date > item.lastDate) item.lastDate = entry.date;
    }
  }

  return [...frequencyMap.values()]
    .map((item) => {
      const distinctDays = item.days.size || 1;
      const regularityScore = Number(
        (item.count + distinctDays * 0.4 + item.weightedScore * 0.35).toFixed(2),
      );
      return {
        name: item.name,
        categoryId: getUsualCategoryForActivity(item.name, filteredEntries, activities, { referenceDate: refDate }),
        count: item.count,
        totalMins: item.totalMins,
        avgMins: Math.round(item.totalMins / item.count),
        distinctDays,
        lastDate: item.lastDate,
        regularityScore,
      };
    })
    .sort((a, b) => b.count - a.count || b.regularityScore - a.regularityScore || b.totalMins - a.totalMins)
    .slice(0, limit);
}

/**
 * Generates local business observations & hypotheses with full explainable provenance.
 */
export function generatePersonalizedSuggestions({
  entries = [],
  activities = [],
  categories = [],
  currentHour = new Date().getHours(),
  currentMinute = 30,
  recentDays = DEFAULT_RECENT_DAYS,
  referenceDate = null,
  maxRoutineGapMins = DEFAULT_MAX_ROUTINE_GAP_MINS,
  minOriginSample = DEFAULT_MIN_ORIGIN_SAMPLE,
} = {}) {
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  if (!entries.length) {
    return [
      {
        id: 'welcome_observation',
        engine: 'business',
        kind: 'status',
        type: 'observation',
        status: 'insufficient_data',
        badge: 'Données insuffisantes',
        title: 'Premiers pas',
        message: 'Vous n’avez pas encore de sessions enregistrées. Lancez un premier chrono pour commencer votre suivi.',
        rule: 'Historique vide',
        occurrences: 0,
        sessionCount: 0,
        periodLabel: recentDays ? `${recentDays} derniers jours` : 'Historique complet',
        confidence: computeConfidence({ score: 0 }),
        action: null,
      },
    ];
  }

  const { filteredEntries: recentEntries, referenceDate: refDate, periodLabel } = filterEntriesByRecentWindow(entries, {
    recentDays,
    referenceDate,
  });

  const suggestions = [];
  const coveredActivities = new Set();

  // ---------------------------------------------------------------------------
  // 1. Time-of-day habit (handles midnight crossing, multi-day spread & recency)
  // ---------------------------------------------------------------------------
  const targetMinutesOfDay = ((currentHour % 24) + 24) % 24 * 60 + Math.max(0, Math.min(59, currentMinute));
  const hourMatches = new Map();

  for (const e of recentEntries) {
    const name = String(e.activity || '').trim();
    if (!name || !e.start) continue;
    const startMins = parseTime(e.start);
    if (startMins === null) continue;

    const entryHour = Math.floor(startMins / 60);
    const matchesSlot = circularHourDiff(entryHour, currentHour) <= 1 || circularMinuteDiff(startMins, targetMinutesOfDay) <= 75;
    if (!matchesSlot) continue;

    const key = name.toLowerCase();
    const weight = recencyWeight(e.date, refDate);
    if (!hourMatches.has(key)) {
      hourMatches.set(key, {
        name,
        count: 0,
        mins: 0,
        weightedScore: 0,
        days: new Set(),
      });
    }
    const bucket = hourMatches.get(key);
    bucket.count += 1;
    bucket.mins += Math.max(0, Number(e.mins) || 0);
    bucket.weightedScore += weight;
    if (e.date) bucket.days.add(e.date);
  }

  const bestHourMatch = [...hourMatches.values()]
    .filter(m => m.count >= 2 && m.days.size >= 2)
    .map(m => ({
      ...m,
      score: m.weightedScore * (1 + 0.35 * m.days.size),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count)[0];

  if (bestHourMatch) {
    const usualCatId = getUsualCategoryForActivity(bestHourMatch.name, recentEntries, activities, { referenceDate: refDate });
    const cat = usualCatId ? categoryMap.get(usualCatId) : null;
    const catText = cat ? ` (${cat.label})` : '';
    const avgM = Math.round(bestHourMatch.mins / bestHourMatch.count);
    const conf = computeConfidence({
      score: Math.min(1, bestHourMatch.weightedScore / 4 + bestHourMatch.days.size * 0.1),
      occurrences: bestHourMatch.count,
      distinctDays: bestHourMatch.days.size,
    });

    coveredActivities.add(bestHourMatch.name.toLowerCase());
    suggestions.push({
      id: `time_habit_${bestHourMatch.name.toLowerCase()}`,
      engine: 'business',
      kind: 'time_habit',
      type: 'observation',
      status: 'observation',
      badge: 'Habitude horaire',
      title: `Créneau de ${currentHour}h`,
      message: `Observation : vers cette heure, vous utilisez souvent « ${bestHourMatch.name} »${catText} pour environ ${avgM} min (${bestHourMatch.count} sessions sur ${bestHourMatch.days.size} jours).`,
      rule: 'Habitude horaire (±1h avec passage de minuit, ≥ 2 jours distincts)',
      occurrences: bestHourMatch.count,
      sessionCount: bestHourMatch.days.size,
      periodLabel,
      confidence: conf,
      action: {
        label: `Démarrer ${bestHourMatch.name}`,
        activity: bestHourMatch.name,
        categoryId: usualCatId || null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Sequential routines (strict chronological spans, interval <= maxRoutineGapMins, multi-day)
  // ---------------------------------------------------------------------------
  const chronoSpans = recentEntries
    .map(entryToChronoSpan)
    .filter(Boolean)
    .sort((a, b) => a.startAbs - b.startAbs || a.endAbs - b.endAbs);

  const transitions = new Map();
  for (let i = 0; i < chronoSpans.length - 1; i += 1) {
    const prev = chronoSpans[i];
    const next = chronoSpans[i + 1];
    const prevName = String(prev.entry.activity || '').trim();
    const nextName = String(next.entry.activity || '').trim();
    if (!prevName || !nextName) continue;

    const prevKey = prevName.toLowerCase();
    const nextKey = nextName.toLowerCase();
    if (prevKey === nextKey) continue;

    const gapMins = next.startAbs - prev.endAbs;
    if (gapMins < -5 || gapMins > maxRoutineGapMins) continue;

    const pairKey = `${prevKey}=>${nextKey}`;
    const weight = recencyWeight(next.date, refDate);

    if (!transitions.has(pairKey)) {
      transitions.set(pairKey, {
        prevKey,
        prevName,
        nextKey,
        nextName,
        count: 0,
        days: new Set(),
        weightedScore: 0,
        gaps: [],
      });
    }
    const tr = transitions.get(pairKey);
    tr.count += 1;
    tr.weightedScore += weight;
    tr.days.add(prev.date);
    tr.gaps.push(Math.max(0, gapMins));
  }

  const lastSpan = chronoSpans.at(-1) || null;
  const lastKey = lastSpan ? String(lastSpan.entry.activity || '').trim().toLowerCase() : '';

  const matchingLastRoutine = lastKey
    ? [...transitions.values()]
        .filter(t => t.prevKey === lastKey && t.count >= 2 && t.days.size >= 2)
        .sort((a, b) => (b.weightedScore * b.days.size) - (a.weightedScore * a.days.size) || b.count - a.count)[0]
    : null;

  const fallbackRoutine = !matchingLastRoutine
    ? [...transitions.values()]
        .filter(t => t.count >= 2 && t.days.size >= 2)
        .sort((a, b) => (b.weightedScore * b.days.size) - (a.weightedScore * a.days.size) || b.count - a.count)[0]
    : null;

  const chosenRoutine = matchingLastRoutine || fallbackRoutine;
  if (chosenRoutine) {
    const nextCatId = getUsualCategoryForActivity(chosenRoutine.nextName, recentEntries, activities, { referenceDate: refDate });
    const cat = nextCatId ? categoryMap.get(nextCatId) : null;
    const catText = cat ? ` (${cat.label})` : '';
    const avgGap = chosenRoutine.gaps.length
      ? Math.round(chosenRoutine.gaps.reduce((s, g) => s + g, 0) / chosenRoutine.gaps.length)
      : 0;
    const conf = computeConfidence({
      score: Math.min(1, chosenRoutine.weightedScore / 3.5 + chosenRoutine.days.size * 0.1),
      occurrences: chosenRoutine.count,
      distinctDays: chosenRoutine.days.size,
    });

    const isAfterLast = Boolean(matchingLastRoutine);
    suggestions.push({
      id: `routine_${chosenRoutine.prevKey}_to_${chosenRoutine.nextKey}`,
      engine: 'business',
      kind: 'routine',
      type: 'hypothesis',
      status: 'hypothesis',
      badge: 'Routine',
      title: isAfterLast
        ? `Après « ${chosenRoutine.prevName} »`
        : `Enchaînement « ${chosenRoutine.prevName} » → « ${chosenRoutine.nextName} »`,
      message: isAfterLast
        ? `Une tendance semble se dessiner : après « ${chosenRoutine.prevName} », cette séquence vers « ${chosenRoutine.nextName} »${catText} a été observée ${chosenRoutine.count} fois sur ${chosenRoutine.days.size} jours (intervalle moy. ${avgGap} min).`
        : `Cette séquence (« ${chosenRoutine.prevName} » suivi de « ${chosenRoutine.nextName} »${catText}) a été observée ${chosenRoutine.count} fois sur ${chosenRoutine.days.size} jours (intervalle moy. ${avgGap} min).`,
      rule: `Enchaînement chronologique (intervalle ≤ ${maxRoutineGapMins} min, ≥ 2 jours distincts)`,
      occurrences: chosenRoutine.count,
      sessionCount: chosenRoutine.days.size,
      periodLabel,
      confidence: conf,
      action: {
        label: isAfterLast ? `Enchaîner avec ${chosenRoutine.nextName}` : `Démarrer ${chosenRoutine.nextName}`,
        activity: chosenRoutine.nextName,
        categoryId: nextCatId || null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Frequent & regular activities (non-redundant with time habit)
  // ---------------------------------------------------------------------------
  const frequentList = getFrequentActivities(recentEntries, activities, 5, { recentDays: null, referenceDate: refDate });
  const topFrequent = frequentList.find(
    item => item.count >= 3 && item.distinctDays >= 2 && !coveredActivities.has(item.name.toLowerCase()),
  );

  if (topFrequent) {
    const cat = topFrequent.categoryId ? categoryMap.get(topFrequent.categoryId) : null;
    const catText = cat ? ` (${cat.label})` : '';
    const conf = computeConfidence({
      score: Math.min(1, topFrequent.count / 6 + topFrequent.distinctDays * 0.08),
      occurrences: topFrequent.count,
      distinctDays: topFrequent.distinctDays,
    });

    coveredActivities.add(topFrequent.name.toLowerCase());
    suggestions.push({
      id: `top_frequent_${topFrequent.name.toLowerCase()}`,
      engine: 'business',
      kind: 'frequent_activity',
      type: 'observation',
      status: 'observation',
      badge: 'Activité fréquente',
      title: topFrequent.name,
      message: `Vous utilisez souvent « ${topFrequent.name} »${catText} : ${topFrequent.count} sessions sur ${topFrequent.distinctDays} jours (durée moy. ${topFrequent.avgMins} min).`,
      rule: 'Fréquence, régularité multi-jours et récence pondérée',
      occurrences: topFrequent.count,
      sessionCount: topFrequent.distinctDays,
      periodLabel,
      confidence: conf,
      action: {
        label: `Démarrer ${topFrequent.name}`,
        activity: topFrequent.name,
        categoryId: topFrequent.categoryId || null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Usual category association observation (non-ambiguous, multi-day)
  // ---------------------------------------------------------------------------
  const categoryUsage = new Map();
  for (const e of recentEntries) {
    if (!e.categoryId || !categoryMap.has(e.categoryId)) continue;
    if (!categoryUsage.has(e.categoryId)) {
      categoryUsage.set(e.categoryId, {
        categoryId: e.categoryId,
        count: 0,
        mins: 0,
        days: new Set(),
        weightedScore: 0,
      });
    }
    const item = categoryUsage.get(e.categoryId);
    item.count += 1;
    item.mins += Math.max(0, Number(e.mins) || 0);
    item.weightedScore += recencyWeight(e.date, refDate);
    if (e.date) item.days.add(e.date);
  }

  const topCategoryStat = [...categoryUsage.values()]
    .filter(c => c.count >= 3 && c.days.size >= 2)
    .sort((a, b) => b.weightedScore - a.weightedScore || b.count - a.count)[0];

  if (topCategoryStat) {
    const totalCategorized = [...categoryUsage.values()].reduce((s, c) => s + c.count, 0);
    const sharePct = totalCategorized > 0 ? Math.round((topCategoryStat.count / totalCategorized) * 100) : 0;
    const cat = categoryMap.get(topCategoryStat.categoryId);

    if (cat && sharePct >= 40) {
      const conf = computeConfidence({
        score: Math.min(1, topCategoryStat.count / 7 + (sharePct / 100) * 0.3),
        occurrences: topCategoryStat.count,
        distinctDays: topCategoryStat.days.size,
      });

      suggestions.push({
        id: `usual_category_${cat.id}`,
        engine: 'business',
        kind: 'usual_category',
        type: 'observation',
        status: 'observation',
        badge: 'Catégorie habituelle',
        title: cat.label,
        message: `Une tendance semble se dessiner vers la catégorie « ${cat.label} » (${sharePct} % des sessions catégorisées sur ${topCategoryStat.days.size} jours).`,
        rule: 'Catégorie dominante pondérée par récence (≥ 3 sessions, ≥ 2 jours)',
        occurrences: topCategoryStat.count,
        sessionCount: topCategoryStat.days.size,
        periodLabel,
        confidence: conf,
        action: null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Tracking mode observation (ONLY entries with explicit boolean viaTimer)
  // ---------------------------------------------------------------------------
  const knownOriginEntries = recentEntries.filter(e => typeof e.viaTimer === 'boolean');
  const unknownOriginCount = recentEntries.length - knownOriginEntries.length;
  const timerCount = knownOriginEntries.filter(e => e.viaTimer === true).length;
  const manualCount = knownOriginEntries.filter(e => e.viaTimer === false).length;

  if (knownOriginEntries.length >= minOriginSample) {
    const distinctOriginDays = new Set(knownOriginEntries.map(e => e.date).filter(Boolean)).size || 1;
    const unknownNote = unknownOriginCount > 0
      ? ` (${unknownOriginCount} entrée${unknownOriginCount > 1 ? 's' : ''} ancienne${unknownOriginCount > 1 ? 's' : ''} sans origine exclue${unknownOriginCount > 1 ? 's' : ''})`
      : '';

    if (timerCount >= manualCount * 2 && timerCount / knownOriginEntries.length >= 0.65) {
      const conf = computeConfidence({
        score: Math.min(1, timerCount / Math.max(1, knownOriginEntries.length)),
        occurrences: timerCount,
        distinctDays: distinctOriginDays,
      });
      suggestions.push({
        id: 'timer_usage_habit',
        engine: 'business',
        kind: 'usage_mode',
        type: 'observation',
        status: 'observation',
        badge: 'Mode de suivi',
        title: 'Chronomètre privilégié',
        message: `Vous utilisez souvent le chronomètre en direct (${timerCount} sur ${knownOriginEntries.length} sessions récentes à origine connue)${unknownNote}.`,
        rule: `Préférence chronomètre (échantillon connu ≥ ${minOriginSample}, ratio ≥ 2:1)`,
        occurrences: timerCount,
        sessionCount: knownOriginEntries.length,
        periodLabel,
        confidence: conf,
        action: null,
      });
    } else if (manualCount >= timerCount * 2 && manualCount / knownOriginEntries.length >= 0.65) {
      const conf = computeConfidence({
        score: Math.min(1, manualCount / Math.max(1, knownOriginEntries.length)),
        occurrences: manualCount,
        distinctDays: distinctOriginDays,
      });
      suggestions.push({
        id: 'manual_usage_habit',
        engine: 'business',
        kind: 'usage_mode',
        type: 'observation',
        status: 'observation',
        badge: 'Mode de suivi',
        title: 'Saisie récapitulative',
        message: `Vous utilisez souvent la saisie manuelle (${manualCount} sur ${knownOriginEntries.length} sessions récentes à origine connue)${unknownNote}.`,
        rule: `Préférence saisie manuelle (échantillon connu ≥ ${minOriginSample}, ratio ≥ 2:1)`,
        occurrences: manualCount,
        sessionCount: knownOriginEntries.length,
        periodLabel,
        confidence: conf,
        action: null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Explicit no-trend / insufficient-data fallback when nothing met thresholds
  // ---------------------------------------------------------------------------
  if (!suggestions.length) {
    const isInsufficient = recentEntries.length < 3;
    return [
      {
        id: isInsufficient ? 'insufficient_recent_data' : 'no_business_trend',
        engine: 'business',
        kind: 'status',
        type: 'observation',
        status: isInsufficient ? 'insufficient_data' : 'no_trend',
        badge: isInsufficient ? 'Données insuffisantes' : 'Aucune tendance',
        title: isInsufficient ? 'Historique encore court' : 'Activités variées',
        message: isInsufficient
          ? `Données encore insuffisantes sur la période (${recentEntries.length} session${recentEntries.length > 1 ? 's' : ''}) pour identifier une habitude fiable sans risque d’erreur.`
          : 'Aucune tendance marquée détectée sur la période récente : vos sessions restent variées sans répétition régulière.',
        rule: isInsufficient ? 'Échantillon minimal non atteint (< 3 sessions récentes)' : 'Aucun seuil d’habitude régulière atteint',
        occurrences: recentEntries.length,
        sessionCount: new Set(recentEntries.map(e => e.date).filter(Boolean)).size,
        periodLabel,
        confidence: computeConfidence({ score: 0 }),
        action: null,
      },
    ];
  }

  return suggestions;
}
