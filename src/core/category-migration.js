import { migrateCategoryTree } from './category-tree.js';
import { migrateSavedActivities } from './saved-activities.js';

const BUILTIN_CATEGORIES = [
  { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
  { id: 'sommeil', label: 'Sommeil', color: '#5B4E7E', parentId: null, builtin: true },
  { id: 'loisirs', label: 'Loisirs', color: '#C98A3D', parentId: null, builtin: true },
  { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null, builtin: true },
  { id: 'social', label: 'Social', color: '#B5697A', parentId: null, builtin: true },
  { id: 'transport', label: 'Transport', color: '#8B93A1', parentId: null, builtin: true },
  { id: 'etude', label: 'Étude', color: '#3F7068', parentId: null, builtin: true },
  { id: 'autre', label: 'Autre', color: '#948C7E', parentId: null, builtin: true },
];

/** One-way compatibility migration for legacy TimeEntry data. */
export function migrateEntriesToCategoryTree(entries = [], customCategories = [], subCategories = []) {
  const categories = migrateCategoryTree([...BUILTIN_CATEGORIES, ...customCategories], subCategories);
  const byId = new Set(categories.map(category => category.id));
  const subByPair = new Map();

  for (const item of subCategories) {
    if (!item?.catId || !item?.label) continue;
    const migrated = categories.find(category =>
      category.parentId === item.catId && category.label === String(item.label).trim()
    );
    if (migrated) subByPair.set(`${item.catId}::${String(item.label).trim()}`, migrated.id);
  }

  const categoryById = new Map(categories.map(category => [String(category.id), category]));
  const categoryByLabel = new Map(
    categories
      .filter(category => category.parentId == null)
      .map(category => [String(category.label).trim().toLowerCase(), category.id]),
  );

  return entries.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;

    let categoryId = entry.categoryId && byId.has(entry.categoryId)
      ? entry.categoryId
      : null;

    if (!categoryId && entry.sub) {
      categoryId = subByPair.get(`${entry.cat}::${String(entry.sub).trim()}`) ?? null;
    }

    if (!categoryId && entry.cat) {
      const rawCat = String(entry.cat).trim();
      categoryId = byId.has(rawCat)
        ? rawCat
        : categoryById.has(rawCat)
          ? categoryById.get(rawCat).id
          : categoryByLabel.get(rawCat.toLowerCase()) ?? null;
    }

    const { cat: _cat, sub: _sub, ...rest } = entry;
    return { ...rest, categoryId };
  });
}

export function migrateBackupToCategoryTree(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const hasCanonicalCategories = Array.isArray(data.categories);
  const customCategories = hasCanonicalCategories ? data.categories : (data.customCategories ?? []);
  const subCategories = hasCanonicalCategories ? [] : (data.subCategories ?? []);
  const categories = migrateCategoryTree([...BUILTIN_CATEGORIES, ...customCategories], subCategories);
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
