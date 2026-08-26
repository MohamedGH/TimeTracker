import type { Category, TimeEntry } from '../types';
import { createCategory } from './category-tree.js';

export function migrateCategoryTree(customCategories: any[] = [], subCategories: any[] = []): Category[] {
  const nodes: Category[] = [];
  const ids = new Set<string>();

  for (const category of customCategories) {
    if (!category?.id || !category?.label || ids.has(category.id)) continue;
    nodes.push(createCategory({
      id: category.id,
      label: category.label,
      color: category.color ?? null,
      parentId: category.parentId ?? null,
      builtin: Boolean(category.builtin),
    }));
    ids.add(category.id);
  }

  for (const legacy of subCategories) {
    if (!legacy?.id || !legacy?.label) continue;
    const parentId = legacy.parentId ?? legacy.catId ?? null;
    if (parentId && !ids.has(parentId)) continue;

    let id = legacy.id;
    if (ids.has(id)) {
      id = `${parentId || 'root'}::${legacy.id}`;
      let suffix = 2;
      while (ids.has(id)) id = `${parentId || 'root'}::${legacy.id}-${suffix++}`;
    }

    nodes.push(createCategory({
      id,
      label: legacy.label,
      color: legacy.color ?? null,
      parentId,
      builtin: false,
    }));
    ids.add(id);
  }

  const knownIds = new Set(nodes.map(node => node.id));
  return nodes.map(node => ({
    ...node,
    parentId: node.parentId && knownIds.has(node.parentId) ? node.parentId : null,
  }));
}

export function migrateEntriesToCategoryTree(entries: any[] = [], categories: Category[] = [], legacySubCategories: any[] = []): TimeEntry[] {
  if (!Array.isArray(entries)) return [];
  const categoryIds = new Set(categories.map(c => c.id));
  const categoryByLabel = new Map(categories.map(c => [c.label.toLowerCase(), c.id]));

  return entries.map(entry => {
    if (!entry) return entry;
    let categoryId = entry.categoryId ?? null;
    if (!categoryId && entry.cat) {
      if (categoryIds.has(entry.cat)) {
        categoryId = entry.cat;
      } else if (categoryByLabel.has(String(entry.cat).toLowerCase())) {
        categoryId = categoryByLabel.get(String(entry.cat).toLowerCase())!;
      }
    }
    return {
      ...entry,
      categoryId,
    };
  });
}

export function migrateBackupToCategoryTree(backup: any): any {
  if (!backup || typeof backup !== 'object') return backup;
  const categories = migrateCategoryTree(backup.categories || backup.customCategories || [], backup.subCategories || []);
  const entries = migrateEntriesToCategoryTree(backup.entries || [], categories, backup.subCategories || []);
  return {
    ...backup,
    categories,
    entries,
  };
}
