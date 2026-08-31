import { defineStore } from 'pinia';
import type { Category, CategoryInput } from '../types/category';
import { addCategory, deleteCategory, moveCategory, renameCategory } from '../state/category-actions.js';
import { getAncestors, getChildren, getDescendants, getRoots, formatCategoryPath } from '../core/category-tree.js';
import { loadPersistedCategories, persistCategories } from './category-persistence';
import { trackEvent } from '../core/analytics/analytics.js';
import { categoryCreatedPayload, categoryMovedPayload, categoryDeletedPayload } from '../core/analytics/events.js';

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
      trackEvent('category_created', categoryCreatedPayload({ depth: getAncestors(this.categories, input.id).length }));
    },

    async rename(id: string, label: string) {
      this.categories = renameCategory(this.categories, id, label) as Category[];
      await this.persist();
      trackEvent('category_renamed');
    },

    async move(id: string, parentId: string | null) {
      this.categories = moveCategory(this.categories, id, parentId) as Category[];
      await this.persist();
      trackEvent('category_moved', categoryMovedPayload({ depth: getAncestors(this.categories, id).length }));
    },

    async remove(id: string, cascade = false) {
      const descendantCount = getDescendants(this.categories, id).length;
      this.categories = deleteCategory(this.categories, id, { cascade }) as Category[];
      await this.persist();
      trackEvent('category_deleted', categoryDeletedPayload({ cascade, descendantCount }));
    },
  },
});
