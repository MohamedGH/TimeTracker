/**
 * Shortcuts By Category — Pure functional module for collecting, classifying,
 * sorting, and filtering one-click activity shortcuts grouped by category.
 */

import { formatCategoryPath, getAncestors } from './category-tree.js';
import { getCategoryColor } from './category-palette.js';
import { normalizeSearchText } from './ui-state.js';
import {
  getRecentActivities,
  getFrequentActivities,
  getUsualCategoryForActivity,
} from './suggestions-engine.js';

export const UNCATEGORIZED_SHORTCUT_KEY = 'uncategorized';

/**
 * Resolves the canonical categoryId for a shortcut, validating against known categories.
 * Pure function.
 */
export function resolveShortcutCategoryId(
  activityName,
  preferredCategoryId,
  entries = [],
  activities = [],
  categoryMap = new Map(),
) {
  const key = String(activityName || '').trim().toLowerCase();
  if (key) {
    const saved = activities.find(
      a => String(a?.label || a?.name || a?.activity || '').trim().toLowerCase() === key,
    );
    const savedCatId = saved?.categoryId ?? saved?.cat ?? null;
    if (savedCatId && categoryMap.has(savedCatId)) {
      return savedCatId;
    }
  }

  if (preferredCategoryId && categoryMap.has(preferredCategoryId)) {
    return preferredCategoryId;
  }

  const usual = getUsualCategoryForActivity(activityName, entries, activities);
  if (usual && categoryMap.has(usual)) {
    return usual;
  }

  return null;
}

/**
 * Resolves the grouping category key ('category' preserves exact leaf/subcategory,
 * 'root' rolls subcategories up to their top-level root category).
 */
function resolveGroupCategoryId(categoryId, categories = [], groupBy = 'category') {
  if (!categoryId) return null;
  if (groupBy !== 'root') return categoryId;
  const ancestors = getAncestors(categories, categoryId);
  return ancestors.length ? ancestors[0].id : categoryId;
}

/**
 * Computes a deterministic priority score for ranking shortcuts inside a category.
 */
function computeShortcutScore({ count = 0, lastDate = null, isRecent = false, isSaved = false }) {
  return count * 2 + (lastDate ? 3 : 0) + (isRecent ? 2 : 0) + (isSaved ? 1 : 0);
}

/**
 * Collects unique activity shortcuts from recent, frequent, and saved activities,
 * and groups them by category.
 *
 * Pure function: ({ entries, activities, categories, groupBy?, maxPerCategory?, maxTotal? })
 *   -> { groups, totalShortcuts, categoriesCount }
 */
export function collectCategoryShortcuts({
  entries = [],
  activities = [],
  categories = [],
  groupBy = 'category',
  maxPerCategory = 6,
  maxTotal = 24,
} = {}) {
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const recentList = getRecentActivities(entries, activities, 30);
  const frequentList = getFrequentActivities(entries, activities, 30);

  const recentByKey = new Map(
    recentList.map((item, idx) => [item.name.toLowerCase(), { ...item, recentRank: idx }]),
  );
  const frequentByKey = new Map(
    frequentList.map(item => [item.name.toLowerCase(), item]),
  );

  const mergedByKey = new Map();

  const upsertCandidate = ({
    name,
    preferredCategoryId = null,
    count = 0,
    lastDate = null,
    totalMins = 0,
    isRecent = false,
    isSaved = false,
  }) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const existing = mergedByKey.get(key);

    if (!existing) {
      mergedByKey.set(key, {
        name: trimmed,
        preferredCategoryId: preferredCategoryId || null,
        count: Math.max(0, Number(count) || 0),
        lastDate: lastDate || null,
        totalMins: Math.max(0, Number(totalMins) || 0),
        isRecent,
        isSaved,
      });
      return;
    }

    existing.count = Math.max(existing.count, Number(count) || 0);
    existing.totalMins = Math.max(existing.totalMins, Number(totalMins) || 0);
    existing.isRecent = existing.isRecent || isRecent;
    existing.isSaved = existing.isSaved || isSaved;
    if (!existing.preferredCategoryId && preferredCategoryId) {
      existing.preferredCategoryId = preferredCategoryId;
    }
    if (lastDate && (!existing.lastDate || lastDate > existing.lastDate)) {
      existing.lastDate = lastDate;
    }
  };

  for (const item of recentList) {
    const freq = frequentByKey.get(item.name.toLowerCase());
    upsertCandidate({
      name: item.name,
      preferredCategoryId: item.categoryId,
      count: Math.max(item.count || 0, freq?.count || 0),
      lastDate: item.lastDate || freq?.lastDate || null,
      totalMins: freq?.totalMins || 0,
      isRecent: true,
      isSaved: false,
    });
  }

  for (const item of frequentList) {
    const rec = recentByKey.get(item.name.toLowerCase());
    upsertCandidate({
      name: item.name,
      preferredCategoryId: item.categoryId,
      count: item.count,
      lastDate: item.lastDate || rec?.lastDate || null,
      totalMins: item.totalMins,
      isRecent: Boolean(rec),
      isSaved: false,
    });
  }

  for (const act of activities) {
    const name = String(act?.label || act?.name || act?.activity || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const freq = frequentByKey.get(key);
    const rec = recentByKey.get(key);
    upsertCandidate({
      name,
      preferredCategoryId: act?.categoryId ?? act?.cat ?? null,
      count: Math.max(Number(act?.useCount) || 0, freq?.count || 0, rec?.count || 0),
      lastDate: rec?.lastDate || freq?.lastDate || (act?.lastUsedAt ? String(act.lastUsedAt).slice(0, 10) : null),
      totalMins: freq?.totalMins || 0,
      isRecent: Boolean(rec),
      isSaved: true,
    });
  }

  if (!mergedByKey.size) {
    return { groups: [], totalShortcuts: 0, categoriesCount: 0 };
  }

  const buckets = new Map();

  for (const item of mergedByKey.values()) {
    const resolvedCatId = resolveShortcutCategoryId(
      item.name,
      item.preferredCategoryId,
      entries,
      activities,
      categoryMap,
    );
    const groupCatId = resolveGroupCategoryId(resolvedCatId, categories, groupBy);
    const filterKey = groupCatId ?? UNCATEGORIZED_SHORTCUT_KEY;

    if (!buckets.has(filterKey)) {
      const cat = groupCatId ? categoryMap.get(groupCatId) : null;
      const ancestors = groupCatId ? getAncestors(categories, groupCatId) : [];
      const rootCat = ancestors[0] || cat || null;
      const pathLabel = groupCatId
        ? (formatCategoryPath(categories, groupCatId) || cat?.label || 'Catégorie')
        : 'Sans catégorie';

      buckets.set(filterKey, {
        categoryId: groupCatId,
        filterKey,
        label: cat?.label || 'Sans catégorie',
        pathLabel,
        rootCategoryId: rootCat?.id ?? null,
        color: groupCatId ? getCategoryColor(cat || groupCatId, categories) : '#8B93A1',
        shortcuts: [],
      });
    }

    buckets.get(filterKey).shortcuts.push({
      name: item.name,
      categoryId: resolvedCatId,
      groupCategoryId: groupCatId,
      count: item.count,
      lastDate: item.lastDate,
      totalMins: item.totalMins,
      isRecent: item.isRecent,
      isSaved: item.isSaved,
      score: computeShortcutScore(item),
    });
  }

  const sortedGroups = [...buckets.values()]
    .map((group) => {
      const sortedShortcuts = [...group.shortcuts]
        .sort((a, b) => (
          b.score - a.score
          || b.count - a.count
          || (b.lastDate || '').localeCompare(a.lastDate || '')
          || a.name.localeCompare(b.name, 'fr')
        ))
        .slice(0, Math.max(1, maxPerCategory));

      const groupScore = sortedShortcuts.reduce((sum, s) => sum + s.score, 0);
      return {
        ...group,
        shortcuts: sortedShortcuts,
        count: sortedShortcuts.length,
        groupScore,
      };
    })
    .sort((a, b) => {
      // Uncategorized always appears last
      if (a.categoryId === null && b.categoryId !== null) return 1;
      if (a.categoryId !== null && b.categoryId === null) return -1;
      return b.groupScore - a.groupScore || a.pathLabel.localeCompare(b.pathLabel, 'fr');
    });

  // Cap total shortcuts fairly across groups when exceeding maxTotal
  const cappedGroups = capGroupsByTotal(sortedGroups, maxTotal);
  const totalShortcuts = cappedGroups.reduce((sum, g) => sum + g.shortcuts.length, 0);

  return {
    groups: cappedGroups,
    totalShortcuts,
    categoriesCount: cappedGroups.length,
  };
}

function capGroupsByTotal(groups, maxTotal) {
  if (!Number.isFinite(maxTotal) || maxTotal <= 0) return groups;
  const total = groups.reduce((sum, g) => sum + g.shortcuts.length, 0);
  if (total <= maxTotal) return groups;

  // Fair round-robin allocation so each category keeps representation
  const allocations = groups.map(() => 0);
  let remaining = maxTotal;
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < groups.length && remaining > 0; i += 1) {
      if (allocations[i] < groups[i].shortcuts.length) {
        allocations[i] += 1;
        remaining -= 1;
        progressed = true;
      }
    }
  }

  return groups
    .map((g, idx) => {
      const shortcuts = g.shortcuts.slice(0, allocations[idx]);
      return {
        ...g,
        shortcuts,
        count: shortcuts.length,
      };
    })
    .filter(g => g.shortcuts.length > 0);
}

/**
 * Filters grouped shortcuts by active category filter key ('all' or category filterKey).
 * Falls back to all groups if the selected category filter no longer matches any group.
 */
export function filterShortcutGroups(groups = [], selectedFilter = 'all') {
  if (!selectedFilter || selectedFilter === 'all') return groups;
  const matched = groups.filter(g => g.filterKey === selectedFilter);
  return matched.length ? matched : groups;
}

/**
 * Searches saved activities and historical entries (accent-insensitive) so users can
 * immediately launch the chronometer on a matching activity.
 * Pure function.
 */
export function searchLaunchableActivities({
  query = '',
  entries = [],
  activities = [],
  categories = [],
  limit = 12,
} = {}) {
  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeActivities = Array.isArray(activities) ? activities : [];
  const safeEntries = Array.isArray(entries) ? entries : [];
  const categoryMap = new Map(safeCategories.map(c => [c.id, c]));
  const cleanQuery = normalizeSearchText(query);

  const byKey = new Map();

  for (const act of safeActivities) {
    const name = String(act?.label || act?.name || act?.activity || '').trim();
    if (!name) continue;
    const rawCatId = act?.categoryId ?? act?.cat ?? null;
    const categoryId = rawCatId && categoryMap.has(rawCatId) ? rawCatId : null;
    const key = `${name.toLowerCase()}::${categoryId || ''}`;
    const content = typeof act?.content === 'string' ? act.content.trim() : '';
    const startContent = typeof act?.startContent === 'string' ? act.startContent.trim() : '';
    const endContent = typeof act?.endContent === 'string' ? act.endContent.trim() : '';
    byKey.set(key, {
      name,
      activityId: act.id || null,
      categoryId,
      count: Math.max(0, Number(act.useCount) || 0),
      avgDurationMins: Number.isFinite(Number(act.avgDurationMins)) ? Number(act.avgDurationMins) : null,
      lastDate: act.lastUsedAt ? String(act.lastUsedAt).slice(0, 10) : null,
      content,
      startContent,
      endContent,
      isSaved: true,
    });
  }

  for (const entry of safeEntries) {
    const name = String(entry?.activity || '').trim();
    if (!name) continue;
    const rawCatId = entry?.categoryId ?? null;
    const categoryId = rawCatId && categoryMap.has(rawCatId) ? rawCatId : null;
    const key = `${name.toLowerCase()}::${categoryId || ''}`;
    const existing = byKey.get(key);
    const entryContent = typeof entry?.content === 'string' ? entry.content.trim() : '';
    const entryStart = typeof entry?.startContent === 'string' ? entry.startContent.trim() : '';
    const entryEnd = typeof entry?.endContent === 'string' ? entry.endContent.trim() : '';
    if (existing) {
      existing.count += 1;
      if (entry.date && (!existing.lastDate || entry.date > existing.lastDate)) {
        existing.lastDate = entry.date;
      }
      if (!existing.content && entryContent) existing.content = entryContent;
      if (!existing.startContent && entryStart) existing.startContent = entryStart;
      if (!existing.endContent && entryEnd) existing.endContent = entryEnd;
    } else {
      byKey.set(key, {
        name,
        activityId: null,
        categoryId,
        count: 1,
        avgDurationMins: Number.isFinite(Number(entry.mins)) ? Number(entry.mins) : null,
        lastDate: entry.date || null,
        content: entryContent,
        startContent: entryStart,
        endContent: entryEnd,
        isSaved: false,
      });
    }
  }

  const results = [];
  for (const item of byKey.values()) {
    const cat = item.categoryId ? categoryMap.get(item.categoryId) : null;
    const categoryPath = item.categoryId
      ? (formatCategoryPath(safeCategories, item.categoryId) || cat?.label || 'Catégorie')
      : 'Sans catégorie';
    const color = item.categoryId ? getCategoryColor(cat || item.categoryId, safeCategories) : '#8B93A1';

    let matchScore = 0;
    if (cleanQuery) {
      const normName = normalizeSearchText(item.name);
      const normPath = normalizeSearchText(categoryPath);
      const normContent = normalizeSearchText(item.content);
      const normStart = normalizeSearchText(item.startContent);
      const normEnd = normalizeSearchText(item.endContent);

      if (normName === cleanQuery) {
        matchScore = 4;
      } else if (normName.startsWith(cleanQuery)) {
        matchScore = 3;
      } else if (normName.includes(cleanQuery)) {
        matchScore = 2;
      } else if (
        normPath.includes(cleanQuery)
        || normContent.includes(cleanQuery)
        || normStart.includes(cleanQuery)
        || normEnd.includes(cleanQuery)
      ) {
        matchScore = 1;
      } else {
        continue;
      }
    }

    results.push({
      ...item,
      categoryPath,
      color,
      _matchScore: matchScore,
    });
  }

  return results
    .sort((a, b) => (
      b._matchScore - a._matchScore
      || (b.isSaved ? 1 : 0) - (a.isSaved ? 1 : 0)
      || b.count - a.count
      || (b.lastDate || '').localeCompare(a.lastDate || '')
      || a.name.localeCompare(b.name, 'fr')
    ))
    .slice(0, Math.max(1, limit))
    .map(({ _matchScore, ...item }) => item);
}
