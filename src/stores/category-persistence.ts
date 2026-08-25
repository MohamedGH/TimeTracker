import type { Category } from '../types/category';
import { getValue, setValue, STORAGE_KEYS } from '../core/storage.js';
import { migrateCategoryTree } from '../core/category-tree.js';

export async function loadPersistedCategories(): Promise<Category[]> {
  const [stored, legacy] = await Promise.all([
    getValue(STORAGE_KEYS.categories, []),
    getValue(STORAGE_KEYS.subcategories, []),
  ]);

  return migrateCategoryTree(
    Array.isArray(stored) ? stored : [],
    Array.isArray(legacy) ? legacy : [],
  ) as Category[];
}

export async function persistCategories(categories: Category[]): Promise<void> {
  await setValue(STORAGE_KEYS.categories, categories);
}
