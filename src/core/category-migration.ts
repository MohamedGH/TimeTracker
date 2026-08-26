import type { Category } from '../types';
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

export function migrateEntriesToCategoryTree(entries: any[], categories: any[], legacySubCategories: any[] = []): any[] {
  return entries;
}

export function migrateBackupToCategoryTree(backup: any): any {
  if (!backup || typeof backup !== 'object') return backup;
  const categories = migrateCategoryTree(backup.categories || backup.customCategories || [], backup.subCategories || []);
  return {
    ...backup,
    categories,
  };
}
