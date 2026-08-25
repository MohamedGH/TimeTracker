import { defineStore } from 'pinia';
import type { Category, CategoryInput } from '../types/category';
import { addCategory, deleteCategory, moveCategory, renameCategory } from '../state/category-actions.js';
import { getAncestors, getChildren, getDescendants, getRoots, formatCategoryPath } from '../core/category-tree.js';
import { loadPersistedCategories, persistCategories } from './category-persistence';

export const useCategoriesStore = defineStore('categories', {
  state: (): { categories: Category[]; initialized: boolean; loading: boolean } => ({
    categories: [],
    initialized: false,
    loading: false,
  }),

  getters: {
    roots: (state): Category[] => getRoots(state.categories) as Category[],
    children: (state) => (parentId: string | null): Category[] => getChildren(state.categories, parentId) as Category[],
    ancestors: (state) => (id: string): Category[] => getAncestors(state.categories, id) as Category[],
    descendants: (state) => (id: string): Category[] => getDescendants(state.categories, id) as Category[],
    path: (state) => (id: string): string => formatCategoryPath(state.categories, id),
  },

  actions: {
    initialize(categories: Category[]) {
      this.categories = [...categories];
      this.initialized = true;
    },

    async load() {
      if (this.loading) return;
      this.loading = true;
      try {
        this.initialize(await loadPersistedCategories());
      } finally {
        this.loading = false;
      }
    },

    async persist() {
      await persistCategories(this.categories);
    },

    async add(input: CategoryInput) {
      this.categories = addCategory(this.categories, input) as Category[];
      await this.persist();
    },

    async rename(id: string, label: string) {
      this.categories = renameCategory(this.categories, id, label) as Category[];
      await this.persist();
    },

    async move(id: string, parentId: string | null) {
      this.categories = moveCategory(this.categories, id, parentId) as Category[];
      await this.persist();
    },

    async remove(id: string, cascade = false) {
      this.categories = deleteCategory(this.categories, id, { cascade }) as Category[];
      await this.persist();
    },
  },
});
