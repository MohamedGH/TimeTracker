import {
  createCategory,
  getDescendants,
  wouldCreateCycle,
} from '../core/category-tree.js';

export function addCategory(categories, { id, label, color = null, parentId = null, builtin = false }) {
  if (categories.some(category => category.id === id)) {
    throw new Error(`La catégorie "${id}" existe déjà.`);
  }
  if (parentId && !categories.some(category => category.id === parentId)) {
    throw new Error('Catégorie parente introuvable.');
  }
  return [...categories, createCategory({ id, label, color, parentId, builtin })];
}

export function renameCategory(categories, id, label) {
  if (!categories.some(category => category.id === id)) throw new Error('Catégorie introuvable.');
  return categories.map(category => category.id === id ? { ...category, label: label.trim() } : category);
}

export function updateCategory(categories, id, { label, color, parentId } = {}) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');

  const nextLabel = label !== undefined ? String(label).trim() : category.label;
  if (!nextLabel) throw new Error('Le nom de la catégorie ne peut pas être vide.');

  const nextParentId = parentId !== undefined ? (parentId || null) : category.parentId;
  if (nextParentId && !categories.some(item => item.id === nextParentId)) {
    throw new Error('Catégorie parente introuvable.');
  }
  if (nextParentId && nextParentId !== category.parentId && wouldCreateCycle(categories, id, nextParentId)) {
    throw new Error('Déplacement impossible : il créerait une boucle.');
  }

  const nextColor = color !== undefined ? (color || null) : category.color;

  return categories.map(item => item.id === id ? {
    ...item,
    label: nextLabel,
    color: nextColor,
    parentId: nextParentId,
  } : item);
}

export function moveCategory(categories, id, parentId = null) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');
  if (parentId && !categories.some(item => item.id === parentId)) throw new Error('Catégorie parente introuvable.');
  if (parentId && wouldCreateCycle(categories, id, parentId)) throw new Error('Déplacement impossible : il créerait une boucle.');
  return categories.map(item => item.id === id ? { ...item, parentId } : item);
}

export function deleteCategory(categories, id, { cascade = false, deleteDescendants = false } = {}) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');
  const descendants = getDescendants(categories, id);
  const idsToDelete = new Set((cascade || deleteDescendants) ? [id, ...descendants.map(item => item.id)] : [id]);
  if (!cascade && !deleteDescendants && descendants.length) {
    throw new Error('Cette catégorie contient des enfants. Utilisez une suppression en cascade ou déplacez-les d’abord.');
  }
  return categories.filter(item => !idsToDelete.has(item.id));
}

function normalizeTextKey(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveActivityLabel(item) {
  return String(item?.label || item?.name || item?.activity || '').trim();
}

function maxIsoTimestamp(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return String(a) >= String(b) ? a : b;
}

function mergeSavedActivityPair(primary, secondary) {
  const countA = Number.isFinite(Number(primary?.useCount)) ? Math.max(0, Number(primary.useCount)) : 0;
  const countB = Number.isFinite(Number(secondary?.useCount)) ? Math.max(0, Number(secondary.useCount)) : 0;
  const avgA = Number(primary?.avgDurationMins);
  const avgB = Number(secondary?.avgDurationMins);
  let avgDurationMins = primary?.avgDurationMins ?? secondary?.avgDurationMins ?? null;
  if (Number.isFinite(avgA) && avgA > 0 && Number.isFinite(avgB) && avgB > 0 && (countA + countB) > 0) {
    avgDurationMins = Math.round(((avgA * countA) + (avgB * countB)) / (countA + countB));
  } else if (Number.isFinite(avgA) && avgA > 0) {
    avgDurationMins = avgA;
  } else if (Number.isFinite(avgB) && avgB > 0) {
    avgDurationMins = avgB;
  }

  return {
    ...primary,
    useCount: Math.max(1, countA + countB),
    lastUsedAt: maxIsoTimestamp(primary?.lastUsedAt, secondary?.lastUsedAt),
    avgDurationMins,
  };
}

/**
 * Validates whether sourceId can be merged into targetId.
 * Pure function: (categories, sourceId, targetId) -> { valid, error, sourceCategory, targetCategory }
 */
export function validateCategoryMerge(categories = [], sourceId, targetId) {
  const list = Array.isArray(categories) ? categories : [];
  if (!sourceId || !targetId) {
    return { valid: false, error: 'Veuillez sélectionner une catégorie source et une catégorie cible.', sourceCategory: null, targetCategory: null };
  }
  if (sourceId === targetId) {
    return { valid: false, error: 'Veuillez choisir deux catégories différentes à fusionner.', sourceCategory: null, targetCategory: null };
  }
  const sourceCategory = list.find(item => item.id === sourceId) || null;
  const targetCategory = list.find(item => item.id === targetId) || null;
  if (!sourceCategory || !targetCategory) {
    return { valid: false, error: 'Catégorie source ou cible introuvable.', sourceCategory, targetCategory };
  }
  const descendants = getDescendants(list, sourceId);
  if (descendants.some(item => item.id === targetId)) {
    return {
      valid: false,
      error: 'Fusion impossible : la catégorie cible est une sous-catégorie de la source. Inversez source et cible.',
      sourceCategory,
      targetCategory,
    };
  }
  return { valid: true, error: null, sourceCategory, targetCategory };
}

/**
 * Pure category-tree merge: removes sourceId and re-parents its direct children to targetId.
 * Pure function: (categories, sourceId, targetId) -> nextCategories
 */
export function mergeCategories(categories, sourceId, targetId) {
  const check = validateCategoryMerge(categories, sourceId, targetId);
  if (!check.valid) {
    throw new Error(check.error);
  }
  return categories
    .filter(item => item.id !== sourceId)
    .map(item => (item.parentId === sourceId ? { ...item, parentId: targetId } : item));
}

/**
 * Computes a read-only impact summary before merging two categories.
 * Pure function: (stateSlice, { sourceId, targetId }) -> ImpactSummary
 */
export function computeCategoryMergeImpact(
  { categories = [], entries = [], activities = [], activeTimer = null, quickTilesConfig = null } = {},
  { sourceId, targetId } = {}
) {
  const check = validateCategoryMerge(categories, sourceId, targetId);
  if (!check.valid) {
    return {
      valid: false,
      error: check.error,
      sourceCategory: check.sourceCategory,
      targetCategory: check.targetCategory,
      childCategoriesCount: 0,
      entriesCount: 0,
      savedActivitiesCount: 0,
      deduplicatedActivitiesCount: 0,
      affectsActiveTimer: false,
      quickTilesCount: 0,
    };
  }

  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeActivities = Array.isArray(activities) ? activities : [];

  const childCategoriesCount = safeCategories.filter(c => c.parentId === sourceId).length;
  const entriesCount = safeEntries.filter(e => (e.categoryId ?? null) === sourceId).length;
  const sourceActivities = safeActivities.filter(a => (a.categoryId ?? a.cat ?? null) === sourceId);
  const targetActivityKeys = new Set(
    safeActivities
      .filter(a => (a.categoryId ?? a.cat ?? null) === targetId)
      .map(a => normalizeTextKey(resolveActivityLabel(a)))
      .filter(Boolean)
  );
  const deduplicatedActivitiesCount = sourceActivities.filter(a =>
    targetActivityKeys.has(normalizeTextKey(resolveActivityLabel(a)))
  ).length;
  const affectsActiveTimer = Boolean(
    activeTimer && (activeTimer.categoryId ?? activeTimer.cat ?? null) === sourceId
  );
  const quickTilesCount = Array.isArray(quickTilesConfig?.slots)
    ? quickTilesConfig.slots.filter(s => s?.activity && (s.categoryId ?? null) === sourceId).length
    : 0;

  return {
    valid: true,
    error: null,
    sourceCategory: check.sourceCategory,
    targetCategory: check.targetCategory,
    childCategoriesCount,
    entriesCount,
    savedActivitiesCount: sourceActivities.length,
    deduplicatedActivitiesCount,
    affectsActiveTimer,
    quickTilesCount,
  };
}

/**
 * Merges a source category into a target category across categories, entries,
 * saved activities (with deduplication), active timer, and Quick Tiles config.
 * Pure function: (stateSlice, { sourceId, targetId }) -> nextStateSlice
 */
export function mergeCategoriesState(
  {
    categories = [],
    entries = [],
    activities = [],
    activeTimer = null,
    quickTilesConfig = null,
  } = {},
  { sourceId, targetId } = {}
) {
  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeActivities = Array.isArray(activities) ? activities : [];

  const impact = computeCategoryMergeImpact(
    { categories: safeCategories, entries: safeEntries, activities: safeActivities, activeTimer, quickTilesConfig },
    { sourceId, targetId }
  );
  if (!impact.valid) {
    throw new Error(impact.error);
  }

  const nextCategories = mergeCategories(safeCategories, sourceId, targetId);
  const targetLabel = impact.targetCategory.label;

  const nextEntries = safeEntries.map(entry =>
    (entry.categoryId ?? null) === sourceId
      ? { ...entry, categoryId: targetId }
      : entry
  );

  // Reassign saved activities and deduplicate any matching label already present in targetId
  const reassigned = safeActivities.map(act => {
    const actCat = act.categoryId ?? act.cat ?? null;
    if (actCat !== sourceId) return act;
    return {
      ...act,
      categoryId: targetId,
    };
  });

  const mergedActivitiesByKey = new Map();
  for (const act of reassigned) {
    const actCat = act.categoryId ?? act.cat ?? null;
    const key = `${actCat ?? ''}::${normalizeTextKey(resolveActivityLabel(act))}`;
    if (!mergedActivitiesByKey.has(key)) {
      mergedActivitiesByKey.set(key, act);
      continue;
    }
    const existing = mergedActivitiesByKey.get(key);
    // Prefer preserving an item that already belonged to targetId before merge
    const existingWasTarget = safeActivities.some(orig => orig.id === existing.id && (orig.categoryId ?? orig.cat ?? null) === targetId);
    const currentWasTarget = safeActivities.some(orig => orig.id === act.id && (orig.categoryId ?? orig.cat ?? null) === targetId);
    const [primary, secondary] = !existingWasTarget && currentWasTarget
      ? [act, existing]
      : [existing, act];
    mergedActivitiesByKey.set(key, mergeSavedActivityPair(primary, secondary));
  }
  const nextActivities = [...mergedActivitiesByKey.values()];

  const nextActiveTimer = activeTimer && (activeTimer.categoryId ?? activeTimer.cat ?? null) === sourceId
    ? { ...activeTimer, categoryId: targetId }
    : activeTimer;

  const nextQuickTilesConfig = quickTilesConfig && Array.isArray(quickTilesConfig.slots)
    ? {
        ...quickTilesConfig,
        slots: quickTilesConfig.slots.map(slot => (
          (slot?.categoryId ?? null) === sourceId
            ? {
                ...slot,
                categoryId: targetId,
                categoryLabel: targetLabel,
              }
            : slot
        )),
      }
    : quickTilesConfig;

  return {
    categories: nextCategories,
    entries: nextEntries,
    activities: nextActivities,
    activeTimer: nextActiveTimer,
    quickTilesConfig: nextQuickTilesConfig,
    summary: {
      sourceId,
      targetId,
      sourceLabel: impact.sourceCategory.label,
      targetLabel,
      childCategoriesCount: impact.childCategoriesCount,
      entriesCount: impact.entriesCount,
      savedActivitiesCount: impact.savedActivitiesCount,
      deduplicatedActivitiesCount: impact.deduplicatedActivitiesCount,
      affectsActiveTimer: impact.affectsActiveTimer,
      quickTilesCount: impact.quickTilesCount,
    },
  };
}

