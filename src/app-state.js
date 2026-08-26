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

  // Older migration builds could accidentally persist category records in the
  // saved-activities collection. They are identifiable because a category id
  // is globally unique and must never also be an activity id. Remove these
  // stale records when loading so existing browser data is repaired too.
  const normalizedActivities = Array.isArray(activities)
    ? activities.filter(activity => activity?.id && !categoryIds.has(activity.id))
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
        setValue(STORAGE_KEYS.categories, state.categories.filter(c => !c.builtin)),
        setValue(STORAGE_KEYS.activeTimer, state.activeTimer),
      ]);
    },
  };
}

function mergeCategories(defaults, stored) {
  const result = [];
  const ids = new Set();
  for (const category of [...defaults, ...stored]) {
    if (!category?.id || ids.has(category.id)) continue;
    result.push({
      id: category.id,
      label: String(category.label || '').trim(),
      color: category.color || null,
      parentId: category.parentId ?? null,
      builtin: Boolean(category.builtin),
    });
    ids.add(category.id);
  }
  return result;
}
