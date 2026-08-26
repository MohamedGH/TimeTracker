import { migrateCategoryTree } from './category-tree.js';

/** One-way compatibility migration for legacy TimeEntry data. */
export function migrateEntriesToCategoryTree(entries = [], customCategories = [], subCategories = []) {
  const categories = migrateCategoryTree(customCategories, subCategories);
  const byId = new Set(categories.map(category => category.id));
  const subByPair = new Map(
    subCategories.filter(item => item?.id && item?.catId)
      .map(item => [`${item.catId}::${item.label}`, item.id]),
  );

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
  const hasCanonicalCategories = Array.isArray(data?.categories);
  const categories = hasCanonicalCategories
    ? migrateCategoryTree(data.categories, [])
    : migrateCategoryTree(data?.customCategories ?? [], data?.subCategories ?? []);

  const legacyCategories = hasCanonicalCategories
    ? categories
    : (data?.customCategories ?? []);
  const legacySubCategories = hasCanonicalCategories
    ? []
    : (data?.subCategories ?? []);

  const { customCategories: _customCategories, subCategories: _subCategories, ...rest } = data ?? {};

  return {
    ...rest,
    version: Math.max(2, Number(data?.version) || 1),
    categories,
    entries: migrateEntriesToCategoryTree(data?.entries ?? [], legacyCategories, legacySubCategories),
  };
}
