import { getChildren, getCategoryPath } from './category-tree.js';
import { escapeHtml } from './html.js';

/** Transitional recursive renderer. Vue will replace this with CategoryTree.vue. */
export function renderCategoryTree(categories, { rootId = null, selectedId = null, depth = 0 } = {}) {
  const children = getChildren(categories, rootId);
  if (!children.length) return '';

  return `<ul class="category-tree category-tree--depth-${depth}">${children.map(category => {
    const selected = category.id === selectedId ? ' aria-current="true"' : '';
    const path = getCategoryPath(categories, category.id).map(item => item.label).join(' > ');
    const descendants = getChildren(categories, category.id);

    return `<li class="category-tree__item" data-category-id="${escapeHtml(category.id)}">
      <button type="button" class="category-tree__select" data-action="select-category" data-category-id="${escapeHtml(category.id)}" title="${escapeHtml(path)}"${selected}>
        <span class="category-tree__label">${escapeHtml(category.label)}</span>
      </button>
      <button type="button" class="category-tree__add" data-action="add-category" data-parent-id="${escapeHtml(category.id)}" aria-label="Ajouter une catégorie enfant">+</button>
      ${descendants.length ? renderCategoryTree(categories, { rootId: category.id, selectedId, depth: depth + 1 }) : ''}
    </li>`;
  }).join('')}</ul>`;
}
