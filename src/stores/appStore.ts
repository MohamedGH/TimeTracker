import { defineStore } from 'pinia';
import type { TimeEntry, SavedActivity, Category, ActiveTimer } from '../types';
import { getValue, setValue, clearAllData, STORAGE_KEYS } from '../core/storage';
import { migratePersistedData } from '../core/persistence-migration';
import { DEFAULT_CATEGORIES, normalizeEntries } from '../core/model';
import { getDescendants } from '../core/category-tree';
import { migrateCategoryTree } from '../core/category-migration';
import { addCategory, renameCategory, moveCategory, deleteCategory } from '../state/category-actions';
import { createTimeEntry } from '../core/time-entry';
import { createActiveTimer, elapsedMinutes } from '../core/timer';
import { today, addDays } from '../core/time';

export const useAppStore = defineStore('app', {
  state: () => ({
    entries: [] as TimeEntry[],
    activities: [] as SavedActivity[],
    categories: [] as Category[],
    activeTimer: null as ActiveTimer | null,
    tab: 'entry' as 'entry' | 'dashboard' | 'categories',
    period: '7' as string,
    customStart: null as string | null,
    customEnd: null as string | null,
    editingEntryId: null as string | null,
    modal: null as any,
    error: null as string | null,
    isLoaded: false,
  }),

  actions: {
    async init() {
      await migratePersistedData();

      const [entries, activities, storedCategories, activeTimer] = await Promise.all([
        getValue(STORAGE_KEYS.entries, []),
        getValue(STORAGE_KEYS.activities, []),
        getValue(STORAGE_KEYS.categories, []),
        getValue(STORAGE_KEYS.activeTimer, null),
      ]);

      const categories = mergeCategories(DEFAULT_CATEGORIES, migrateCategoryTree(storedCategories, []));
      const categoryIds = new Set(categories.map(c => c.id));
      const categoryLabels = new Set(categories.map(c => String(c.label || '').trim().toLowerCase()).filter(Boolean));

      const normalizedActivities = Array.isArray(activities)
        ? activities.filter(activity => {
            if (!activity?.id || !String(activity.name || activity.label || '').trim()) return false;
            if (categoryIds.has(activity.id)) return false;
            const name = String(activity.name || activity.label).trim().toLowerCase();
            if (name === 'sans catégorie') return false;
            if (categoryLabels.has(name)) return false;
            return true;
          })
        : [];

      this.categories = categories;
      this.entries = normalizeEntries(entries, categories, []);
      this.activities = normalizedActivities;
      this.activeTimer = activeTimer || null;
      this.isLoaded = true;
    },

    async persist() {
      await Promise.all([
        setValue(STORAGE_KEYS.entries, this.entries),
        setValue(STORAGE_KEYS.activities, this.activities),
        setValue(STORAGE_KEYS.categories, this.categories.filter(c => !c.builtin)),
        setValue(STORAGE_KEYS.activeTimer, this.activeTimer),
      ]);
    },

    async addTimeEntry(entryData: { id?: string; activity: string; categoryId: string | null; date: string; start: string; end: string }) {
      const entry = createTimeEntry({
        id: entryData.id || crypto.randomUUID(),
        activity: entryData.activity,
        categoryId: entryData.categoryId,
        date: entryData.date,
        start: entryData.start,
        end: entryData.end,
      });

      if (!entry.activity || entry.mins <= 0) {
        throw new Error('Vérifiez l’activité et les horaires.');
      }

      if (entryData.id) {
        this.entries = this.entries.map(e => e.id === entryData.id ? entry : e);
      } else {
        this.entries = [entry, ...this.entries];
      }

      this.editingEntryId = null;
      this.error = null;
      await this.persist();
    },

    async removeEntry(id: string) {
      this.entries = this.entries.filter(e => e.id !== id);
      await this.persist();
    },

    async startTimer(activity: string, categoryId: string | null, date: string, startTime: string) {
      if (!activity || !categoryId) return;
      this.activeTimer = createActiveTimer({ activity, categoryId, startTs: Date.now(), startTime, date });
      await this.persist();
    },

    async stopTimer() {
      if (!this.activeTimer) return;
      const t = this.activeTimer;
      const now = new Date();
      const end = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const entry = createTimeEntry({
        id: crypto.randomUUID(),
        activity: t.activity,
        categoryId: t.categoryId ?? (t as any).cat,
        date: t.date,
        start: t.startTime,
        end,
        mins: elapsedMinutes(t),
      });

      this.entries = [entry, ...this.entries];
      this.activeTimer = null;
      await this.persist();
    },

    async addNewCategory(label: string, color: string, parentId: string | null) {
      const uniqueId = this.generateCategoryId(label);
      this.categories = addCategory(this.categories, { id: uniqueId, label, color, parentId, builtin: false });
      await this.persist();
    },

    async updateCategoryName(id: string, label: string) {
      this.categories = renameCategory(this.categories, id, label);
      await this.persist();
    },

    async moveCategoryParent(id: string, parentId: string | null) {
      this.categories = moveCategory(this.categories, id, parentId);
      await this.persist();
    },

    async removeCategory(id: string) {
      const ids = new Set([id, ...getDescendants(this.categories, id).map(x => x.id)]);
      this.categories = deleteCategory(this.categories, id, { cascade: true });
      this.entries = this.entries.map(e => ids.has(e.categoryId!) ? { ...e, categoryId: null } : e);
      this.activities = this.activities.map(a => ids.has(a.categoryId!) ? { ...a, categoryId: null } : a);
      await this.persist();
    },

    async addSavedActivity(label: string, categoryId: string | null) {
      if (!label.trim()) return;
      this.activities.push({ id: crypto.randomUUID(), label: label.trim(), categoryId });
      await this.persist();
    },

    async removeSavedActivity(id: string) {
      this.activities = this.activities.filter(a => a.id !== id);
      await this.persist();
    },

    async clearAll() {
      await clearAllData();
      this.entries = [];
      this.activities = [];
      this.categories = DEFAULT_CATEGORIES.map(c => ({ ...c }));
      this.activeTimer = null;
      this.modal = null;
      this.editingEntryId = null;
      this.error = null;
      this.tab = 'entry';
      await this.persist();
    },

    generateCategoryId(text: string): string {
      const base = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'category';
      let id = base, n = 2;
      while (this.categories.some(c => c.id === id)) id = `${base}-${n++}`;
      return id;
    }
  }
});

function mergeCategories(defaults: Category[], stored: Category[]): Category[] {
  const result: Category[] = [];
  const ids = new Set<string>();
  for (const category of [...defaults, ...stored]) {
    if (!category?.id || ids.has(category.id)) continue;
    result.push({
      id: category.id,
      label: String(category.label || '').trim(),
      color: category.color || null,
      parentId: category.parentId ?? null,
      builtin: Boolean((category as any).builtin),
    });
    ids.add(category.id);
  }
  return result;
}
