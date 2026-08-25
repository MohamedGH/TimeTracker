import { renderCategoryTree } from './category-tree-renderer.js';
import { buildCategoryOptions } from './category-select.js';
import { addCategory, deleteCategory, moveCategory, renameCategory } from '../state/category-actions.js';

/**
 * Transitional DOM adapter. It keeps category UI behavior outside the legacy
 * application and can be discarded when the Vue recursive component lands.
 */
export function createCategoryUiController({ root, getCategories, setCategories, onSelect }) {
  if (!root) throw new Error('Racine UI des catégories introuvable.');

  function render(selectedId = null) {
    root.innerHTML = renderCategoryTree(getCategories(), { selectedId });
  }

  function add({ id, label, parentId = null, color = null }) {
    setCategories(addCategory(getCategories(), { id, label, parentId, color }));
    render(id);
  }

  function rename(id, label) {
    setCategories(renameCategory(getCategories(), id, label));
    render(id);
  }

  function move(id, parentId = null) {
    setCategories(moveCategory(getCategories(), id, parentId));
    render(id);
  }

  function remove(id, options = {}) {
    setCategories(deleteCategory(getCategories(), id, options));
    render();
  }

  function options(selectedId = null) {
    return buildCategoryOptions(getCategories(), selectedId);
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button)) return;

    const id = button.dataset.categoryId;
    const action = button.dataset.action;
    if (action === 'select-category') onSelect?.(id);
    if (action === 'add-category') onSelect?.(null, { parentId: button.dataset.parentId });
  });

  return { render, add, rename, move, remove, options };
}
