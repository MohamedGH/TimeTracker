import { getValue, STORAGE_KEYS } from '../core/storage.js';
import { DEFAULT_CATEGORIES } from '../core/model.js';
import { renderCategoryActivityTree } from './category-activity-tree.js';

export async function renderCategoryHierarchy(container, entries = [], options = {}) {
  if (!container) return null;

  const categories = Array.isArray(options.categories) && options.categories.length
    ? options.categories
    : mergeCategories(await getValue(STORAGE_KEYS.categories, []));

  const activities = Array.isArray(options.activities)
    ? options.activities
    : await getValue(STORAGE_KEYS.activities, []);

  return renderCategoryActivityTree({
    container,
    categories,
    activities,
    entries,
    includeEmptyCategories: options.includeEmptyCategories ?? true,
    onStartActivity: options.onStartActivity || null,
    onSelectCategory: options.onSelectCategory || null,
    onAddCategory: options.onAddCategory || null,
    onAddActivity: options.onAddActivity || null,
  });
}

function mergeCategories(stored) {
  const result = [];
  const ids = new Set();
  for (const c of [...DEFAULT_CATEGORIES, ...(Array.isArray(stored) ? stored : [])]) {
    if (!c?.id || ids.has(c.id)) continue;
    result.push(c);
    ids.add(c.id);
  }
  return result;
}
