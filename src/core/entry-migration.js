import { migrateCategoryTree } from './category-tree.js';

/**
 * One-time compatibility migration from legacy { cat, sub } entries to
 * categoryId. The returned domain objects never contain cat/sub.
 */
export function migrateEntriesToCategoryId(entries = [], categories = [], legacySubCategories = []) {
  const tree = migrateCategoryTree(categories, []);
  const byId = new Set(tree.map(category => category.id));
  const subByPair = new Map(
    legacySubCategories
      .filter(item => item?.id && item?.catId)
      .map(item => [`${item.catId}::${item.label}`, item.id]),
  );

  return entries.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;

    const categoryId = entry.categoryId && byId.has(entry.categoryId)
      ? entry.categoryId
      : entry.sub
        ? subByPair.get(`${entry.cat}::${entry.sub}`) ?? null
        : entry.cat && byId.has(entry.cat)
          ? entry.cat
          : null;

    const { cat: _cat, sub: _sub, ...rest } = entry;
    return { ...rest, categoryId };
  });
}
