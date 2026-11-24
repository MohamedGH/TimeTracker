/**
 * Category-Activity Tree Model — Pure functional builders and transformations
 * for hierarchical Category -> Subcategory -> Activity -> Session trees.
 */

import { formatDuration } from './statistics.js';
import { wouldCreateCycle } from './category-tree.js';
import { normalizeSearchText } from './ui-state.js';

export const TREE_NODE_TYPES = Object.freeze({
  ROOT: 'root',
  CATEGORY: 'category',
  ACTIVITY: 'activity',
  SESSION: 'session',
});

/**
 * Normalizes an activity label for case-insensitive grouping.
 * Pure function: string -> string
 */
function normalizeActivityKey(label) {
  return String(label || '').trim().toLowerCase();
}

/**
 * Formats a session summary label cleanly.
 * Pure function: entry -> string
 */
function formatSessionLabel(entry) {
  const datePart = entry.date || '';
  const timePart = entry.start && entry.end ? `${entry.start}–${entry.end}` : '';
  const durPart = formatDuration(entry.mins || 0);
  return [datePart, timePart, durPart].filter(Boolean).join(' · ');
}

/**
 * Builds the immutable hierarchical tree connecting categories, subcategories,
 * activities (leaves), and their recent sessions.
 *
 * Pure function: ({ categories, activities, entries, includeEmptyCategories }) -> TreeNode
 */
export function buildCategoryActivityTree({
  categories = [],
  activities = [],
  entries = [],
  includeEmptyCategories = true,
} = {}) {
  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeActivities = Array.isArray(activities) ? activities : [];
  const safeEntries = Array.isArray(entries) ? entries : [];

  const categoryMap = new Map(safeCategories.map(c => [c.id, c]));

  // Group child categories by parentId
  const childrenByParent = new Map();
  for (const cat of safeCategories) {
    const parentKey = cat.parentId && categoryMap.has(cat.parentId) ? cat.parentId : '__root__';
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey).push(cat);
  }

  // Group activities & entries per categoryId
  const activityMapByCat = new Map();

  const ensureActivityBucket = (catKey, activityName, savedId = null) => {
    const trimmed = String(activityName || '').trim();
    if (!trimmed) return null;
    if (!activityMapByCat.has(catKey)) activityMapByCat.set(catKey, new Map());
    const catActivities = activityMapByCat.get(catKey);
    const key = normalizeActivityKey(trimmed);

    if (!catActivities.has(key)) {
      catActivities.set(key, {
        id: savedId ? `activity:${savedId}` : `activity:${catKey}:${key}`,
        rawId: savedId,
        label: trimmed,
        categoryId: catKey === '__uncategorized__' ? null : catKey,
        totalMins: 0,
        sessionCount: 0,
        sessions: [],
        isSaved: Boolean(savedId),
      });
    } else if (savedId && !catActivities.get(key).rawId) {
      catActivities.get(key).rawId = savedId;
      catActivities.get(key).isSaved = true;
    }

    return catActivities.get(key);
  };

  for (const act of safeActivities) {
    const label = act.label || act.name || act.activity;
    const catKey = act.categoryId && categoryMap.has(act.categoryId)
      ? act.categoryId
      : (act.cat && categoryMap.has(act.cat) ? act.cat : '__uncategorized__');
    ensureActivityBucket(catKey, label, act.id);
  }

  for (const entry of safeEntries) {
    const label = entry.activity;
    const catKey = entry.categoryId && categoryMap.has(entry.categoryId)
      ? entry.categoryId
      : '__uncategorized__';
    const bucket = ensureActivityBucket(catKey, label, null);
    if (!bucket) continue;
    const mins = Math.max(0, Number(entry.mins) || 0);
    bucket.totalMins += mins;
    bucket.sessionCount += 1;
    bucket.sessions.push({
      id: `session:${entry.id || `${entry.date}-${entry.start}-${bucket.sessionCount}`}`,
      type: TREE_NODE_TYPES.SESSION,
      label: formatSessionLabel(entry),
      date: entry.date || '',
      start: entry.start || '',
      end: entry.end || '',
      mins,
      formattedDuration: formatDuration(mins),
    });
  }

  // Recursive category node builder
  const buildCategoryNode = (cat, visited = new Set()) => {
    if (visited.has(cat.id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(cat.id);

    const subCats = (childrenByParent.get(cat.id) || [])
      .map(child => buildCategoryNode(child, nextVisited))
      .filter(Boolean);

    const catColor = cat.color || '#948C7E';
    const rawActivities = [...(activityMapByCat.get(cat.id)?.values() || [])];

    const activityNodes = rawActivities
      .sort((a, b) => b.totalMins - a.totalMins || b.sessionCount - a.sessionCount || a.label.localeCompare(b.label, 'fr'))
      .map(act => {
        const sortedSessions = [...act.sessions]
          .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.start || '').localeCompare(a.start || ''))
          .slice(0, 6);

        return {
          id: act.id,
          activityId: act.rawId || null,
          type: TREE_NODE_TYPES.ACTIVITY,
          label: act.label,
          categoryId: cat.id,
          color: catColor,
          totalMins: act.totalMins,
          formattedDuration: formatDuration(act.totalMins),
          sessionCount: act.sessionCount,
          isSaved: act.isSaved,
          children: sortedSessions.map(s => ({ ...s, color: catColor })),
        };
      });

    const allChildren = [...subCats, ...activityNodes];
    const totalMins = allChildren.reduce((sum, child) => sum + (child.totalMins || 0), 0);
    const sessionCount = allChildren.reduce((sum, child) => sum + (child.sessionCount || 0), 0);
    const activityCount = subCats.reduce((sum, c) => sum + c.activityCount, 0) + activityNodes.length;

    if (!includeEmptyCategories && allChildren.length === 0 && totalMins === 0) {
      return null;
    }

    return {
      id: `category:${cat.id}`,
      categoryId: cat.id,
      parentId: cat.parentId ?? null,
      type: TREE_NODE_TYPES.CATEGORY,
      label: cat.label,
      color: catColor,
      builtin: Boolean(cat.builtin),
      totalMins,
      formattedDuration: formatDuration(totalMins),
      sessionCount,
      activityCount,
      children: allChildren,
    };
  };

  const rootChildren = (childrenByParent.get('__root__') || [])
    .map(cat => buildCategoryNode(cat))
    .filter(Boolean);

  // Include uncategorized branch only if uncategorized activities/entries exist
  const uncategorizedActivities = [...(activityMapByCat.get('__uncategorized__')?.values() || [])];
  if (uncategorizedActivities.length > 0) {
    const uncatColor = '#8B93A1';
    const uncatNodes = uncategorizedActivities
      .sort((a, b) => b.totalMins - a.totalMins || a.label.localeCompare(b.label, 'fr'))
      .map(act => ({
        id: act.id,
        activityId: act.rawId || null,
        type: TREE_NODE_TYPES.ACTIVITY,
        label: act.label,
        categoryId: null,
        color: uncatColor,
        totalMins: act.totalMins,
        formattedDuration: formatDuration(act.totalMins),
        sessionCount: act.sessionCount,
        isSaved: act.isSaved,
        children: [...act.sessions].slice(0, 6).map(s => ({ ...s, color: uncatColor })),
      }));

    const uncatTotal = uncatNodes.reduce((s, a) => s + a.totalMins, 0);
    const uncatSessions = uncatNodes.reduce((s, a) => s + a.sessionCount, 0);

    rootChildren.push({
      id: 'category:__uncategorized__',
      categoryId: null,
      parentId: null,
      type: TREE_NODE_TYPES.CATEGORY,
      label: 'Sans catégorie',
      color: uncatColor,
      builtin: false,
      totalMins: uncatTotal,
      formattedDuration: formatDuration(uncatTotal),
      sessionCount: uncatSessions,
      activityCount: uncatNodes.length,
      children: uncatNodes,
    });
  }

  const totalMins = rootChildren.reduce((sum, c) => sum + c.totalMins, 0);
  const sessionCount = rootChildren.reduce((sum, c) => sum + c.sessionCount, 0);
  const activityCount = rootChildren.reduce((sum, c) => sum + c.activityCount, 0);

  return {
    id: '__root__',
    type: TREE_NODE_TYPES.ROOT,
    label: 'Carnet du temps',
    color: '#232821',
    totalMins,
    formattedDuration: formatDuration(totalMins),
    sessionCount,
    activityCount,
    children: rootChildren,
  };
}

/**
 * Filters a Category-Activity tree by search query, keeping matching nodes
 * and their full ancestor/descendant context.
 * Pure function: (TreeNode, string) -> TreeNode | null
 */
export function filterTreeByQuery(node, query = '') {
  const clean = normalizeSearchText(query);
  if (!clean) return node;
  if (!node) return null;

  const selfMatches = node.type !== TREE_NODE_TYPES.ROOT
    && normalizeSearchText(node.label).includes(clean);

  if (selfMatches) {
    return node;
  }

  const filteredChildren = (node.children || [])
    .map(child => filterTreeByQuery(child, clean))
    .filter(Boolean);

  if (filteredChildren.length > 0) {
    return {
      ...node,
      children: filteredChildren,
    };
  }

  return node.type === TREE_NODE_TYPES.ROOT
    ? { ...node, children: [] }
    : null;
}

/**
 * Collects ranked autocomplete suggestions (categories and activities) matching a typed query.
 * Pure function: (TreeNode, string, number) -> Array<{ id, type, label, categoryPath, color, totalMins, formattedDuration }>
 */
export function collectMatchingTreeSuggestions(rawTree, query = '', limit = 8) {
  const clean = normalizeSearchText(query);
  if (!clean || !rawTree) return [];

  const candidates = [];
  const seen = new Set();

  const visit = (node, ancestors = []) => {
    if (!node) return;
    if (node.type === TREE_NODE_TYPES.CATEGORY || node.type === TREE_NODE_TYPES.ACTIVITY) {
      const label = String(node.label || '').trim();
      const normLabel = normalizeSearchText(label);
      const pathText = ancestors.join(' › ');
      const normPath = normalizeSearchText(pathText);

      if (normLabel.includes(clean) || normPath.includes(clean)) {
        const dedupKey = `${node.type}:${normLabel}:${normPath}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          const startsWithLabel = normLabel.startsWith(clean);
          const includesLabel = normLabel.includes(clean);
          const score = startsWithLabel ? 0 : includesLabel ? 1 : 2;
          candidates.push({
            id: node.id,
            type: node.type,
            label,
            categoryPath: pathText,
            color: node.color || '#948C7E',
            totalMins: node.totalMins || 0,
            formattedDuration: node.formattedDuration || '',
            _score: score,
          });
        }
      }
    }

    const nextAncestors = node.type === TREE_NODE_TYPES.CATEGORY
      ? [...ancestors, node.label]
      : ancestors;

    for (const child of node.children || []) {
      if (child.type === TREE_NODE_TYPES.SESSION) continue;
      visit(child, nextAncestors);
    }
  };

  visit(rawTree, []);

  return candidates
    .sort((a, b) => (
      a._score - b._score
      || (a.type === b.type ? 0 : a.type === TREE_NODE_TYPES.CATEGORY ? -1 : 1)
      || b.totalMins - a.totalMins
      || a.label.localeCompare(b.label, 'fr')
    ))
    .slice(0, Math.max(1, limit))
    .map(({ _score, ...item }) => item);
}

/**
 * Collects node IDs matching a predicate across the tree.
 * Pure function: (TreeNode, predicate) -> Set<string>
 */
export function collectNodeIds(root, predicate = () => true) {
  const ids = new Set();
  const visit = (node) => {
    if (!node) return;
    if (predicate(node)) ids.add(node.id);
    for (const child of node.children || []) {
      visit(child);
    }
  };
  visit(root);
  return ids;
}

/**
 * Computes summary counts for the tree.
 * Pure function: TreeNode -> { categoriesCount, activitiesCount, sessionsCount, totalMins }
 */
export function computeTreeMetrics(root) {
  let categoriesCount = 0;
  let activitiesCount = 0;
  let sessionsCount = 0;

  const visit = (node) => {
    if (!node) return;
    if (node.type === TREE_NODE_TYPES.CATEGORY) categoriesCount += 1;
    if (node.type === TREE_NODE_TYPES.ACTIVITY) activitiesCount += 1;
    if (node.type === TREE_NODE_TYPES.SESSION) sessionsCount += 1;
    for (const child of node.children || []) {
      visit(child);
    }
  };
  visit(root);

  return {
    categoriesCount,
    activitiesCount,
    sessionsCount,
    totalMins: root?.totalMins || 0,
  };
}

/**
 * Checks whether a dragged tree node can be dropped onto a target node.
 * Pure function: ({ draggedNode, targetNode, categories }) -> { valid: boolean, reason: string | null }
 */
export function canDropTreeNode({ draggedNode, targetNode, categories = [] } = {}) {
  if (!draggedNode || !targetNode) {
    return { valid: false, reason: null };
  }
  if (draggedNode.id === targetNode.id) {
    return { valid: false, reason: null };
  }
  if (targetNode.type === TREE_NODE_TYPES.SESSION || targetNode.type === TREE_NODE_TYPES.ACTIVITY) {
    return { valid: false, reason: null };
  }

  if (draggedNode.type === TREE_NODE_TYPES.CATEGORY) {
    if (!draggedNode.categoryId) {
      return { valid: false, reason: null };
    }
    if (targetNode.type === TREE_NODE_TYPES.ROOT) {
      if ((draggedNode.parentId ?? null) === null) {
        return { valid: false, reason: 'Déjà en catégorie racine' };
      }
      return { valid: true, reason: null };
    }
    if (targetNode.type === TREE_NODE_TYPES.CATEGORY) {
      if (targetNode.categoryId === null) {
        return { valid: false, reason: 'Impossible de déposer une catégorie dans Sans catégorie' };
      }
      if ((draggedNode.parentId ?? null) === targetNode.categoryId) {
        return { valid: false, reason: 'Déjà dans cette catégorie' };
      }
      if (wouldCreateCycle(categories, draggedNode.categoryId, targetNode.categoryId)) {
        return { valid: false, reason: 'Déplacement impossible : créerait une boucle' };
      }
      return { valid: true, reason: null };
    }
  }

  if (draggedNode.type === TREE_NODE_TYPES.ACTIVITY) {
    const sourceCatId = draggedNode.categoryId ?? null;
    if (targetNode.type === TREE_NODE_TYPES.ROOT) {
      if (sourceCatId === null) {
        return { valid: false, reason: 'Déjà sans catégorie' };
      }
      return { valid: true, reason: null };
    }
    if (targetNode.type === TREE_NODE_TYPES.CATEGORY) {
      const targetCatId = targetNode.categoryId ?? null;
      if (sourceCatId === targetCatId) {
        return { valid: false, reason: 'Déjà dans cette catégorie' };
      }
      return { valid: true, reason: null };
    }
  }

  return { valid: false, reason: null };
}

/**
 * Finds the tree drop target node intersecting `(pointX, pointY)` in horizontal D3 tree coordinates
 * where horizontal screen X = `node.y` and vertical screen Y = `node.x`.
 * Pure function: ({ pointX, pointY, nodes, draggedNode, categories, nodeDimensions, padding }) -> { node, valid, reason } | null
 */
export function findTreeDropTarget({
  pointX,
  pointY,
  nodes = [],
  draggedNode,
  categories = [],
  nodeDimensions = {},
  padding = 12,
} = {}) {
  if (!draggedNode || !Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;

  let bestMatch = null;
  let bestDist = Infinity;

  for (const hNode of nodes) {
    const data = hNode?.data;
    if (!data || data.id === draggedNode.id) continue;
    if (data.type !== TREE_NODE_TYPES.ROOT && data.type !== TREE_NODE_TYPES.CATEGORY) continue;

    const dims = nodeDimensions[data.type] || { width: 220, height: 44 };
    const left = hNode.y - padding;
    const right = hNode.y + dims.width + padding;
    const top = hNode.x - dims.height / 2 - padding;
    const bottom = hNode.x + dims.height / 2 + padding;

    if (pointX >= left && pointX <= right && pointY >= top && pointY <= bottom) {
      const cx = hNode.y + dims.width / 2;
      const cy = hNode.x;
      const dist = Math.hypot(pointX - cx, pointY - cy);
      const check = canDropTreeNode({ draggedNode, targetNode: data, categories });
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = { node: hNode, valid: check.valid, reason: check.reason };
      }
    }
  }

  return bestMatch;
}

