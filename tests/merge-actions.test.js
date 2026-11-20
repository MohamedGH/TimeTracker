import { describe, it, expect, vi } from 'vitest';
import {
  validateCategoryMerge,
  mergeCategories,
  computeCategoryMergeImpact,
  mergeCategoriesState,
} from '../src/state/category-actions.js';
import {
  collectMergeableActivities,
  validateActivityMerge,
  computeActivityMergeImpact,
  mergeActivitiesState,
  buildActivityCompositeKey,
} from '../src/state/activity-actions.js';
import { appReducer, ACTION_TYPES, createStateManager } from '../src/core/state-manager.js';
import { normalizeError, ERROR_CODES } from '../src/core/error-manager.js';

describe('Category Merge Domain (category-actions)', () => {
  const categories = [
    { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
    { id: 'dev', label: 'Développement', color: '#2980B9', parentId: 'travail', builtin: false },
    { id: 'frontend', label: 'Frontend', color: '#3498DB', parentId: 'dev', builtin: false },
    { id: 'projets', label: 'Projets', color: '#5C7A5E', parentId: null, builtin: false },
  ];

  const entries = [
    { id: 'e-1', activity: 'Code', categoryId: 'dev', date: '2026-11-20', start: '09:00', end: '10:00', mins: 60 },
    { id: 'e-2', activity: 'Specs', categoryId: 'projets', date: '2026-11-20', start: '10:00', end: '10:30', mins: 30 },
  ];

  const activities = [
    { id: 'a-1', label: 'Code', categoryId: 'dev', useCount: 3, lastUsedAt: '2026-11-18T10:00:00.000Z', avgDurationMins: 40 },
    { id: 'a-2', label: 'code', categoryId: 'projets', useCount: 2, lastUsedAt: '2026-11-19T12:00:00.000Z', avgDurationMins: 60 },
    { id: 'a-3', label: 'Revue', categoryId: 'dev', useCount: 1, lastUsedAt: '2026-11-10T09:00:00.000Z', avgDurationMins: 20 },
  ];

  const quickTilesConfig = {
    allowOnLockScreen: true,
    slots: [
      { slot: 1, enabled: true, activity: 'Code', categoryId: 'dev', categoryLabel: 'Développement', tileLabel: 'TimeTracker — Code' },
      { slot: 2, enabled: true, activity: null, categoryId: null, categoryLabel: null, tileLabel: null },
    ],
  };

  it('validates invalid category merges (missing, same id, parent into descendant)', () => {
    expect(validateCategoryMerge(categories, 'dev', 'dev').valid).toBe(false);
    expect(validateCategoryMerge(categories, 'dev', 'missing').valid).toBe(false);
    const parentIntoChild = validateCategoryMerge(categories, 'travail', 'frontend');
    expect(parentIntoChild.valid).toBe(false);
    expect(parentIntoChild.error).toContain('sous-catégorie');
  });

  it('computes accurate impact summary before merging categories', () => {
    const impact = computeCategoryMergeImpact(
      {
        categories,
        entries,
        activities,
        activeTimer: { activity: 'Code', categoryId: 'dev', date: '2026-11-20', startTime: '11:00', startTs: 1000 },
        quickTilesConfig,
      },
      { sourceId: 'dev', targetId: 'projets' }
    );

    expect(impact.valid).toBe(true);
    expect(impact.childCategoriesCount).toBe(1);
    expect(impact.entriesCount).toBe(1);
    expect(impact.savedActivitiesCount).toBe(2);
    expect(impact.deduplicatedActivitiesCount).toBe(1);
    expect(impact.affectsActiveTimer).toBe(true);
    expect(impact.quickTilesCount).toBe(1);
  });

  it('merges categories, reparents children, reassigns entries/timer/tiles, and deduplicates activities', () => {
    const activeTimer = { activity: 'Code', categoryId: 'dev', date: '2026-11-20', startTime: '11:00', startTs: 1000 };
    const result = mergeCategoriesState(
      { categories, entries, activities, activeTimer, quickTilesConfig },
      { sourceId: 'dev', targetId: 'projets' }
    );

    // Category removed & direct child reparented
    expect(result.categories.some(c => c.id === 'dev')).toBe(false);
    expect(result.categories.find(c => c.id === 'frontend').parentId).toBe('projets');

    // Entries reassigned
    expect(result.entries.find(e => e.id === 'e-1').categoryId).toBe('projets');
    expect(result.entries.find(e => e.id === 'e-2').categoryId).toBe('projets');

    // Saved activities reassigned & deduplicated with combined stats
    expect(result.activities).toHaveLength(2);
    const mergedCode = result.activities.find(a => a.id === 'a-2');
    expect(mergedCode).toBeTruthy();
    expect(mergedCode.useCount).toBe(5);
    expect(mergedCode.lastUsedAt).toBe('2026-11-19T12:00:00.000Z');
    expect(mergedCode.avgDurationMins).toBe(48);
    expect(result.activities.find(a => a.id === 'a-3').categoryId).toBe('projets');

    // Active timer and Quick Tiles updated
    expect(result.activeTimer.categoryId).toBe('projets');
    expect(result.quickTilesConfig.slots[0].categoryId).toBe('projets');
    expect(result.quickTilesConfig.slots[0].categoryLabel).toBe('Projets');
  });

  it('throws in mergeCategories when merging parent into child', () => {
    expect(() => mergeCategories(categories, 'travail', 'dev')).toThrow();
  });
});

describe('Activity Merge Domain (activity-actions)', () => {
  const categories = [
    { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null },
    { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null },
  ];

  const activities = [
    { id: 'act-1', label: 'Dev', categoryId: 'travail', useCount: 3, lastUsedAt: '2026-11-18T09:00:00.000Z', avgDurationMins: 30 },
    { id: 'act-2', label: 'Développement', categoryId: 'travail', useCount: 7, lastUsedAt: '2026-11-19T15:00:00.000Z', avgDurationMins: 50 },
    { id: 'act-3', label: 'Course', categoryId: 'sport', useCount: 2, lastUsedAt: '2026-11-15T07:00:00.000Z', avgDurationMins: 40 },
  ];

  const entries = [
    { id: 'e-1', activity: 'Dev', categoryId: 'travail', date: '2026-11-18', start: '09:00', end: '09:30', mins: 30 },
    { id: 'e-2', activity: 'dev', categoryId: 'travail', date: '2026-11-18', start: '10:00', end: '10:30', mins: 30 },
    { id: 'e-3', activity: 'Footing', categoryId: 'sport', date: '2026-11-19', start: '08:00', end: '08:40', mins: 40 },
  ];

  const quickTilesConfig = {
    allowOnLockScreen: true,
    slots: [
      { slot: 1, enabled: true, activity: 'Dev', categoryId: 'travail', categoryLabel: 'Travail', tileLabel: 'TimeTracker — Dev' },
    ],
  };

  it('collects saved and entry-only activities with category paths and counts', () => {
    const mergeable = collectMergeableActivities({ activities, entries, categories });
    expect(mergeable).toHaveLength(4);
    const devItem = mergeable.find(i => i.key === buildActivityCompositeKey('Dev', 'travail'));
    expect(devItem.entryCount).toBe(2);
    expect(devItem.isSaved).toBe(true);

    const footingItem = mergeable.find(i => i.key === buildActivityCompositeKey('Footing', 'sport'));
    expect(footingItem.entryCount).toBe(1);
    expect(footingItem.isSaved).toBe(false);
  });

  it('rejects merging the exact same activity', () => {
    const check = validateActivityMerge(
      activities,
      { activityId: 'act-1', label: 'Dev', categoryId: 'travail' },
      { activityId: 'act-1', label: 'dev', categoryId: 'travail' }
    );
    expect(check.valid).toBe(false);
  });

  it('computes impact and merges two saved activities across entries, stats, active timer, and Quick Tiles', () => {
    const activeTimer = { activity: 'Dev', categoryId: 'travail', date: '2026-11-20', startTime: '09:00', startTs: 1234 };
    const source = { activityId: 'act-1', label: 'Dev', categoryId: 'travail' };
    const target = { activityId: 'act-2', label: 'Développement', categoryId: 'travail' };

    const impact = computeActivityMergeImpact(
      { activities, entries, activeTimer, quickTilesConfig },
      { source, target }
    );
    expect(impact.valid).toBe(true);
    expect(impact.entriesCount).toBe(2);
    expect(impact.affectsActiveTimer).toBe(true);
    expect(impact.quickTilesCount).toBe(1);

    const merged = mergeActivitiesState(
      { activities, entries, activeTimer, quickTilesConfig, categories },
      { source, target }
    );

    expect(merged.activities.some(a => a.id === 'act-1')).toBe(false);
    const kept = merged.activities.find(a => a.id === 'act-2');
    expect(kept.useCount).toBe(10);
    expect(kept.lastUsedAt).toBe('2026-11-19T15:00:00.000Z');
    expect(kept.avgDurationMins).toBe(44);

    expect(merged.entries.filter(e => e.activity === 'Développement')).toHaveLength(2);
    expect(merged.activeTimer.activity).toBe('Développement');
    expect(merged.quickTilesConfig.slots[0].activity).toBe('Développement');
    expect(merged.quickTilesConfig.slots[0].tileLabel).toBe('TimeTracker — Développement');
  });

  it('supports merging an entry-only activity into a saved activity and vice versa', () => {
    const mergedEntryIntoSaved = mergeActivitiesState(
      { activities, entries, categories },
      {
        source: { activityId: null, label: 'Footing', categoryId: 'sport' },
        target: { activityId: 'act-3', label: 'Course', categoryId: 'sport' },
      }
    );
    expect(mergedEntryIntoSaved.entries.find(e => e.id === 'e-3').activity).toBe('Course');

    const mergedSavedIntoEntry = mergeActivitiesState(
      { activities, entries, categories },
      {
        source: { activityId: 'act-3', label: 'Course', categoryId: 'sport' },
        target: { activityId: null, label: 'Footing', categoryId: 'sport' },
      }
    );
    const updatedSaved = mergedSavedIntoEntry.activities.find(a => a.id === 'act-3');
    expect(updatedSaved.label).toBe('Footing');
    expect(updatedSaved.categoryId).toBe('sport');
  });
});

describe('StateManager & ErrorManager integration for merge actions', () => {
  it('dispatches MERGE_CATEGORIES and MERGE_ACTIVITIES cleanly through appReducer and createStateManager', async () => {
    const persistFn = vi.fn().mockResolvedValue(undefined);
    const store = createStateManager({
      initialState: {
        categories: [
          { id: 'c1', label: 'Cat 1', color: '#4A5A75', parentId: null },
          { id: 'c2', label: 'Cat 2', color: '#5C7A5E', parentId: null },
        ],
        activities: [
          { id: 'a1', label: 'Alpha', categoryId: 'c1', useCount: 1 },
          { id: 'a2', label: 'Beta', categoryId: 'c2', useCount: 2 },
        ],
        entries: [
          { id: 'e1', activity: 'Alpha', categoryId: 'c1', date: '2026-11-20', start: '09:00', end: '09:30', mins: 30 },
        ],
        activeTimer: { activity: 'Alpha', categoryId: 'c1', date: '2026-11-20', startTime: '10:00', startTs: 1000 },
        timerUpdatedAt: 1000,
      },
      persistFn,
    });

    store.actions.mergeCategories({ sourceId: 'c1', targetId: 'c2' });
    expect(store.getState().categories.map(c => c.id)).toEqual(['c2']);
    expect(store.getState().entries[0].categoryId).toBe('c2');
    expect(store.getState().activeTimer.categoryId).toBe('c2');
    expect(store.getState().timerUpdatedAt).toBeGreaterThan(1000);

    const nextState = appReducer(store.getState(), {
      type: ACTION_TYPES.MERGE_ACTIVITIES,
      payload: {
        source: { activityId: 'a1', label: 'Alpha', categoryId: 'c2' },
        target: { activityId: 'a2', label: 'Beta', categoryId: 'c2' },
      },
    });
    expect(nextState.activities).toHaveLength(1);
    expect(nextState.activities[0].label).toBe('Beta');
    expect(nextState.activities[0].useCount).toBe(3);
    expect(nextState.entries[0].activity).toBe('Beta');
    expect(nextState.activeTimer.activity).toBe('Beta');
    expect(persistFn).toHaveBeenCalled();
  });

  it('preserves specific validation error messages for merge/category/activity contexts', () => {
    const err = normalizeError(new Error('Veuillez choisir deux activités différentes à fusionner.'), 'merge');
    expect(err.code).toBe(ERROR_CODES.VALIDATION);
    expect(err.message).toBe('Veuillez choisir deux activités différentes à fusionner.');
  });
});
