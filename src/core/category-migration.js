import { migrateCategoryTree } from './category-tree.js';

/**
 * Converts the legacy `{ cat, sub }` entry representation to a single
 * `categoryId` pointing at any node in the category tree.
 *
 * Existing `cat` values are preserved as roots. Existing `sub` values are
 * matched against legacy subcategories. Entries without a valid match keep
 * their original category fields so no information is lost during migration.
 */
export function migrateEntriesToCategoryTree(entries = [], customCategories = [], subCategories = []) {
  const categories = migrateCategoryTree(customCategories, subCategories);
  const byId = new Map(categories.map(category => [category.id, category]));
  const subByLegacyPair = new Map(
    subCategories
      .filter(item => item?.id && item?.catId)
      .map(item => [`${item.catId}::${item.label}`, item.id]),
  );

  return entries.map(entry => {
    if (entry?.categoryId && byId.has(entry.categoryId)) {
      return { ...entry };
    }

    const directCategoryId = entry?.cat && byId.has(entry.cat) ? entry.cat : null;
    const subCategoryId = entry?.sub
      ? subByLegacyPair.get(`${entry.cat}::${entry.sub}`) ?? null
      : null;

    return {
      ...entry,
      categoryId: subCategoryId ?? directCategoryId,
    };
  });
}

export function migrateBackupToCategoryTree(data) {
  const categories = migrateCategoryTree(
    data?.categories ?? data?.customCategories ?? [],
    data?.subCategories ?? [],
  );

  return {
    ...data,
    version: Math.max(2, Number(data?.version) || 1),
    categories,
    entries: migrateEntriesToCategoryTree(
      data?.entries ?? [],
      data?.categories ?? data?.customCategories ?? [],
      data?.subCategories ?? [],
    ),
  };
}
