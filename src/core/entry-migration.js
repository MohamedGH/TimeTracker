import { migrateCategoryTree } from './category-tree.js';

/**
 * One-time compatibility migration from legacy { cat, sub } entries to
 * categoryId. The returned domain objects never contain cat/sub.
 */
export function migrateEntriesToCategoryId(entries = [], categories = [], legacySubCategories = []) {
  const tree = migrateCategoryTree(categories, []);
  const byId = new Set(tree.map(category => category.id));
  const rootByLabel = new Map(
    tree
      .filter(category => category.parentId == null)
      .map(category => [String(category.label).trim().toLowerCase(), category.id]),
  );
  const subByPair = new Map(
    legacySubCategories
      .filter(item => item?.id && item?.catId)
      .map(item => [`${item.catId}::${String(item.label ?? '').trim().toLowerCase()}`, item.id]),
  );

  return entries.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;

    let categoryId = entry.categoryId && byId.has(entry.categoryId)
      ? entry.categoryId
      : null;

    if (!categoryId && entry.sub) {
      categoryId = subByPair.get(
        `${entry.cat}::${String(entry.sub).trim().toLowerCase()}`,
      ) ?? null;
    }

    if (!categoryId && entry.cat) {
      const cat = String(entry.cat).trim();
      categoryId = byId.has(cat)
        ? cat
        : rootByLabel.get(cat.toLowerCase()) ?? null;
    }

    const { cat: _cat, sub: _sub, ...rest } = entry;
    return { ...rest, categoryId };
  });
}
