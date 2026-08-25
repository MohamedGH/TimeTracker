import { getCategoryPath } from './category-tree.js';
import { escapeHtml } from './html.js';

/** Build a flat select while preserving unlimited hierarchy visually. */
export function buildCategoryOptions(categories, selectedId = null, parentId = null, depth = 0) {
  const children = categories.filter(category => (category.parentId ?? null) === parentId);

  return children.map(category => {
    const selected = category.id === selectedId ? ' selected' : '';
    const prefix = depth ? `${'— '.repeat(depth)}` : '';
    const path = getCategoryPath(categories, category.id).map(item => item.label).join(' > ');
    return `<option value="${escapeHtml(category.id)}"${selected} title="${escapeHtml(path)}">${escapeHtml(prefix + category.label)}</option>`
      + buildCategoryOptions(categories, selectedId, category.id, depth + 1);
  }).join('');
}
