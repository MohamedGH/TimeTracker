import { getValue, setValue, STORAGE_KEYS } from './core/storage.js';
import { migratePersistedData } from './core/persistence-migration.js';
import { DEFAULT_CATEGORIES, normalizeEntries } from './core/model.js';
import { migrateCategoryTree } from './core/category-tree.js';

export async function createAppState() {
  await migratePersistedData();

  const [entries, activities, storedCategories, activeTimer] = await Promise.all([
    getValue(STORAGE_KEYS.entries, []),
    getValue(STORAGE_KEYS.activities, []),
    getValue(STORAGE_KEYS.categories, []),
    getValue(STORAGE_KEYS.activeTimer, null),
  ]);

  const categories = mergeCategories(DEFAULT_CATEGORIES, migrateCategoryTree(storedCategories, []));
  const categoryIds = new Set(categories.map(category => category.id));
  const categoryLabels = new Set(categories.map(category => String(category.label || '').trim().toLowerCase()).filter(Boolean));

  // Repair data produced by older migration builds. Categories must never be
  // displayed as saved activities. Some legacy builds persisted category
  // records as activities and could also create label-only records such as
  // "Islam", "Code", "Maman" or "Sans catégorie".
  const normalizedActivities = Array.isArray(activities)
    ? activities.filter(activity => {
        if (!activity?.id || !String(activity.name || '').trim()) return false;
        if (categoryIds.has(activity.id)) return false;
        const name = String(activity.name).trim().toLowerCase();
        if (name === 'sans catégorie') return false;
        if (categoryLabels.has(name)) return false;
        return true;
      })
    : [];

  const state = {
    entries: normalizeEntries(entries, categories, []),
    activities: normalizedActivities,
    categories,
    activeTimer: activeTimer || null,
    tab: 'entry',
    period: '7',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
  };

  return {
    state,
    async persist() {
      await Promise.all([
        setValue(STORAGE_KEYS.entries, state.entries),
        setValue(STORAGE_KEYS.activities, state.activities),
        setValue(STORAGE_KEYS.categories, state.categories),
        setValue(STORAGE_KEYS.activeTimer, state.activeTimer),
      ]);
    },
  };
}

function mergeCategories(defaults, stored) {
  const result = [];
  const seen = new Set();

  // Load stored categories first so custom colors and edits are preserved
  for (const category of (Array.isArray(stored) ? stored : [])) {
    if (!category?.id || seen.has(category.id)) continue;
    result.push({
      id: category.id,
      label: String(category.label || '').trim(),
      color: category.color || null,
      parentId: category.parentId ?? null,
      builtin: Boolean(category.builtin),
    });
    seen.add(category.id);
  }

  // Add any initial defaults if not yet present in storage
  for (const category of (Array.isArray(defaults) ? defaults : [])) {
    if (!category?.id || seen.has(category.id)) continue;
    result.push({
      id: category.id,
      label: String(category.label || '').trim(),
      color: category.color || null,
      parentId: category.parentId ?? null,
      builtin: Boolean(category.builtin),
    });
    seen.add(category.id);
  }

  return result;
}
