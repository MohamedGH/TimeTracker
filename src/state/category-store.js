import {
  addCategory,
  deleteCategory,
  moveCategory,
  renameCategory,
} from './category-actions.js';
import {
  getAncestors,
  getChildren,
  getDescendants,
  getRoots,
  formatCategoryPath,
} from '../core/category-tree.js';

/**
 * Pinia-compatible store factory.
 * Kept framework-free during the legacy migration; it can be wrapped with
 * defineStore() once the Vue application is introduced.
 */
export function createCategoryStore(initialCategories = []) {
  const state = {
    categories: [...initialCategories],
  };

  return {
    state,

    get roots() {
      return getRoots(state.categories);
    },

    children(parentId = null) {
      return getChildren(state.categories, parentId);
    },

    ancestors(id) {
      return getAncestors(state.categories, id);
    },

    descendants(id) {
      return getDescendants(state.categories, id);
    },

    path(id) {
      return formatCategoryPath(state.categories, id);
    },

    add(payload) {
      state.categories = addCategory(state.categories, payload);
    },

    rename(id, label) {
      state.categories = renameCategory(state.categories, id, label);
    },

    move(id, parentId = null) {
      state.categories = moveCategory(state.categories, id, parentId);
    },

    remove(id, options) {
      state.categories = deleteCategory(state.categories, id, options);
    },
  };
}
