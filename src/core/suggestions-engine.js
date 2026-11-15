/**
 * Suggestions Engine — Pure functional module for local personalized suggestions.
 * Mines local user habits (frequency, recency, time of day, category association, routines).
 * All suggestions are explicitly formulated as observations or hypotheses, never certitudes.
 */

/**
 * Discovers the habitual category for an activity name based on historical usage and saved activities.
 * Pure function: (activityName, entries, activities) -> categoryId | null
 */
export function getUsualCategoryForActivity(activityName, entries = [], activities = []) {
  const query = String(activityName || '').trim().toLowerCase();
  if (!query) return null;

  // 1. Check saved activities first
  for (const a of activities) {
    const label = String(a.label || a.activity || a.name || '').trim().toLowerCase();
    if (label === query && a.categoryId) {
      return a.categoryId;
    }
  }

  // 2. Count frequency and recency of categories used with this activity in past entries
  const categoryScores = new Map();
  const sortedEntries = [...entries]
    .filter(e => String(e.activity || '').trim().toLowerCase() === query && e.categoryId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (!sortedEntries.length) return null;

  sortedEntries.forEach((entry, idx) => {
    const catId = entry.categoryId;
    // Higher weight for recent entries
    const weight = 1 + (sortedEntries.length - idx) / sortedEntries.length;
    categoryScores.set(catId, (categoryScores.get(catId) || 0) + weight);
  });

  let bestCatId = null;
  let bestScore = -1;
  for (const [catId, score] of categoryScores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestCatId = catId;
    }
  }

  return bestCatId;
}

/**
 * Returns distinct recent activities with their usual category and last used date.
 * Pure function: (entries, activities, limit = 5) -> Array<{ name, categoryId, lastDate, count }>
 */
export function getRecentActivities(entries = [], activities = [], limit = 5) {
  const seen = new Set();
  const result = [];

  // Sort entries descending by date and time
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

  // If we have fewer than limit, supplement with saved activities not yet in result
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
 * Returns distinct most frequent activities across the entry history.
 * Pure function: (entries, activities, limit = 5) -> Array<{ name, categoryId, count, totalMins, avgMins }>
 */
export function getFrequentActivities(entries = [], activities = [], limit = 5) {
  const frequencyMap = new Map();

  for (const entry of entries) {
    const name = String(entry.activity || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const mins = Math.max(0, Number(entry.mins) || 0);

    if (!frequencyMap.has(key)) {
      frequencyMap.set(key, {
        name,
        categoryId: entry.categoryId ?? null,
        count: 0,
        totalMins: 0,
      });
    }

    const item = frequencyMap.get(key);
    item.count += 1;
    item.totalMins += mins;
    if (entry.categoryId) item.categoryId = entry.categoryId;
  }

  const list = [...frequencyMap.values()]
    .map(item => ({
      name: item.name,
      categoryId: item.categoryId || getUsualCategoryForActivity(item.name, entries, activities),
      count: item.count,
      totalMins: item.totalMins,
      avgMins: Math.round(item.totalMins / item.count),
    }))
    .sort((a, b) => b.count - a.count || b.totalMins - a.totalMins);

  return list.slice(0, limit);
}

/**
 * Generates personalized observations & hypotheses for the current user.
 * Pure function: ({ entries, activities, categories, currentHour }) -> Suggestion[]
 */
export function generatePersonalizedSuggestions({
  entries = [],
  activities = [],
  categories = [],
  currentHour = new Date().getHours(),
} = {}) {
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const suggestions = [];

  if (!entries.length) {
    return [
      {
        id: 'welcome_observation',
        type: 'observation',
        badge: 'Observation',
        title: 'Premiers pas',
        message: 'Vous n’avez pas encore de sessions enregistrées. Lancez un premier chrono pour commencer votre suivi.',
        action: null,
      },
    ];
  }

  // 1. Time of day habit
  // Look for activities frequently started around currentHour (+/- 1h)
  const hourMatches = new Map();
  for (const e of entries) {
    const name = String(e.activity || '').trim();
    if (!name || !e.start) continue;
    const entryHour = Number(e.start.slice(0, 2));
    if (Math.abs(entryHour - currentHour) <= 1) {
      const key = name.toLowerCase();
      hourMatches.set(key, {
        name,
        categoryId: e.categoryId,
        count: (hourMatches.get(key)?.count || 0) + 1,
        mins: (hourMatches.get(key)?.mins || 0) + (Number(e.mins) || 0),
      });
    }
  }

  const bestHourMatch = [...hourMatches.values()]
    .filter(m => m.count >= 2)
    .sort((a, b) => b.count - a.count)[0];

  if (bestHourMatch) {
    const cat = bestHourMatch.categoryId ? categoryMap.get(bestHourMatch.categoryId) : null;
    const catText = cat ? ` (${cat.label})` : '';
    const avgM = Math.round(bestHourMatch.mins / bestHourMatch.count);
    suggestions.push({
      id: `time_habit_${bestHourMatch.name}`,
      type: 'observation',
      badge: 'Habitude horaire',
      title: `Créneau de ${currentHour}h`,
      message: `Observation : vers cette heure, vous commencez souvent « ${bestHourMatch.name} »${catText} pour environ ${avgM} min (${bestHourMatch.count} fois observées).`,
      action: {
        label: `Démarrer ${bestHourMatch.name}`,
        activity: bestHourMatch.name,
        categoryId: bestHourMatch.categoryId || null,
      },
    });
  }

  // 2. Sequential habit (routine after last logged activity)
  const sortedEntries = [...entries].sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '');
    return d !== 0 ? d : (b.start || '').localeCompare(a.start || '');
  });
  const lastEntry = sortedEntries[0];

  if (lastEntry) {
    const lastActivityName = String(lastEntry.activity || '').trim().toLowerCase();
    // Look at same-day or chronological successors of this activity in past data
    const successors = new Map();
    for (let i = 0; i < sortedEntries.length - 1; i += 1) {
      const current = sortedEntries[i + 1]; // chronologically before the one after it
      const next = sortedEntries[i];
      if (String(current.activity || '').trim().toLowerCase() === lastActivityName && current.date === next.date) {
        const succName = String(next.activity || '').trim();
        if (succName && succName.toLowerCase() !== lastActivityName) {
          const key = succName.toLowerCase();
          successors.set(key, {
            name: succName,
            categoryId: next.categoryId,
            count: (successors.get(key)?.count || 0) + 1,
          });
        }
      }
    }

    const bestSuccessor = [...successors.values()]
      .filter(s => s.count >= 2)
      .sort((a, b) => b.count - a.count)[0];

    if (bestSuccessor) {
      const cat = bestSuccessor.categoryId ? categoryMap.get(bestSuccessor.categoryId) : null;
      const catText = cat ? ` (${cat.label})` : '';
      suggestions.push({
        id: `routine_after_${lastActivityName}`,
        type: 'hypothesis',
        badge: 'Enchaînement',
        title: `Après « ${lastEntry.activity} »`,
        message: `Hypothèse : après avoir fait « ${lastEntry.activity} », vous enchaînez fréquemment avec « ${bestSuccessor.name} »${catText}.`,
        action: {
          label: `Enchaîner avec ${bestSuccessor.name}`,
          activity: bestSuccessor.name,
          categoryId: bestSuccessor.categoryId || null,
        },
      });
    }
  }

  // 3. Most recurring activity overall
  const frequentList = getFrequentActivities(entries, activities, 3);
  if (frequentList.length) {
    const topFrequent = frequentList[0];
    if (topFrequent.count >= 3 && (!bestHourMatch || bestHourMatch.name.toLowerCase() !== topFrequent.name.toLowerCase())) {
      const cat = topFrequent.categoryId ? categoryMap.get(topFrequent.categoryId) : null;
      const catText = cat ? ` (${cat.label})` : '';
      suggestions.push({
        id: `top_frequent_${topFrequent.name}`,
        type: 'observation',
        badge: 'Activité favorite',
        title: topFrequent.name,
        message: `Observation : « ${topFrequent.name} »${catText} est votre activité la plus régulière (${topFrequent.count} sessions, durée moy. ${topFrequent.avgMins} min).`,
        action: {
          label: `Démarrer ${topFrequent.name}`,
          activity: topFrequent.name,
          categoryId: topFrequent.categoryId || null,
        },
      });
    }
  }

  // 4. Timer vs manual entry habit observation
  const manualCount = entries.filter(e => !e.viaTimer && e.mins).length;
  const timerCount = entries.length - manualCount;
  if (entries.length >= 5) {
    if (timerCount > manualCount * 2) {
      suggestions.push({
        id: 'timer_usage_habit',
        type: 'observation',
        badge: 'Mode de suivi',
        title: 'Chronomètre privilégié',
        message: 'Observation : vous utilisez majoritairement le chronomètre en temps réel plutôt que la saisie différée.',
        action: null,
      });
    } else if (manualCount > timerCount * 2) {
      suggestions.push({
        id: 'manual_usage_habit',
        type: 'observation',
        badge: 'Mode de suivi',
        title: 'Saisie récapitulative',
        message: 'Observation : vous préférez saisir vos sessions après coup. Pensez au chrono direct pour les tâches imprévues.',
        action: null,
      });
    }
  }

  return suggestions;
}
