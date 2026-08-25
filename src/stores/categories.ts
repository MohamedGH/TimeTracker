import { defineStore } from 'pinia';
import type { Category, CategoryInput } from '../types/category';
import {
  addCategory,
  deleteCategory,
  moveCategory,
  renameCategory,
} from '../state/category-actions.js';
import {
  getAncestors,
  getChildren,
  getDescendants,
  getRoots,
  formatCategoryPath,
} from '../core/category-tree.js';

export const useCategoriesStore = defineStore('categories', {
  state: (): { categories: Category[] } => ({
    categories: [],
  }),

  getters: {
    roots: (state): Category[] => getRoots(state.categories) as Category[],

    children: (state) => (parentId: string | null): Category[] =>
      getChildren(state.categories, parentId) as Category[],

    ancestors: (state) => (id: string): Category[] =>
      getAncestors(state.categories, id) as Category[],

    descendants: (state) => (id: string): Category[] =>
      getDescendants(state.categories, id) as Category[],

    path: (state) => (id: string): string =>
      formatCategoryPath(state.categories, id),
  },

  actions: {
    initialize(categories: Category[]) {
      this.categories = [...categories];
    },

    add(input: CategoryInput) {
      this.categories = addCategory(this.categories, input) as Category[];
    },

    rename(id: string, label: string) {
      this.categories = renameCategory(this.categories, id, label) as Category[];
    },

    move(id: string, parentId: string | null) {
      this.categories = moveCategory(this.categories, id, parentId) as Category[];
    },

    remove(id: string, cascade = false) {
      this.categories = deleteCategory(this.categories, id, { cascade }) as Category[];
    },
  },
});
