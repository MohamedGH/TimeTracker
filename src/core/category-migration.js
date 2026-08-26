import { migrateCategoryTree } from './category-tree.js';
import { migrateSavedActivities } from './saved-activities.js';

/** One-way compatibility migration for legacy TimeEntry data. */
export function migrateEntriesToCategoryTree(entries = [], customCategories = [], subCategories = []) {
  const categories = migrateCategoryTree(customCategories, subCategories);
  const byId = new Set(categories.map(category => category.id));
  const subByPair = new Map();

  for (const item of subCategories) {
    if (!item?.catId || !item?.label) continue;
    const migrated = categories.find(category =>
      category.parentId === item.catId && category.label === String(item.label).trim()
    );
    if (migrated) subByPair.set(`${item.catId}::${item.label}`, migrated.id);
  }

  return entries.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;
    const categoryId = entry.categoryId && byId.has(entry.categoryId)
      ? entry.categoryId
      : entry.sub
        ? subByPair.get(`${entry.cat}::${entry.sub}`) ?? null
        : entry.cat && byId.has(entry.cat) ? entry.cat : null;
    const { cat: _cat, sub: _sub, ...rest } = entry;
    return { ...rest, categoryId };
  });
}

export function migrateBackupToCategoryTree(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const hasCanonicalCategories = Array.isArray(data.categories);
  const customCategories = hasCanonicalCategories ? data.categories : (data.customCategories ?? []);
  const subCategories = hasCanonicalCategories ? [] : (data.subCategories ?? []);
  const categories = migrateCategoryTree(customCategories, subCategories);
  const entries = migrateEntriesToCategoryTree(data.entries ?? [], customCategories, subCategories);

  const legacyActivities = Array.isArray(data.savedActivities)
    ? data.savedActivities
    : Array.isArray(data.activities)
      ? data.activities
      : [];
  const savedActivities = migrateSavedActivities(legacyActivities, categories, subCategories);

  const {
    customCategories: _customCategories,
    subCategories: _subCategories,
    activities: _activities,
    savedActivities: _savedActivities,
    ...rest
  } = data;

  return {
    ...rest,
    version: Math.max(2, Number(data.version) || 1),
    categories,
    entries,
    savedActivities,
  };
}
