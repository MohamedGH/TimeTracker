import { describe, it, expect } from 'vitest';
import {
  TREE_NODE_TYPES,
  buildCategoryActivityTree,
  filterTreeByQuery,
  collectNodeIds,
  computeTreeMetrics,
} from '../src/core/category-activity-tree-model.js';

describe('category-activity-tree-model', () => {
  const categories = [
    { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
    { id: 'dev', label: 'Développement', color: '#2980B9', parentId: 'travail', builtin: false },
    { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null, builtin: true },
  ];

  const activities = [
    { id: 'act-1', label: 'Code Frontend', categoryId: 'dev' },
    { id: 'act-2', label: 'Natation', categoryId: 'sport' },
  ];

  const entries = [
    { id: 'e-1', activity: 'Code Frontend', categoryId: 'dev', date: '2026-11-14', start: '09:00', end: '11:00', mins: 120 },
    { id: 'e-2', activity: 'code frontend', categoryId: 'dev', date: '2026-11-13', start: '14:00', end: '15:00', mins: 60 },
    { id: 'e-3', activity: 'Réunion équipe', categoryId: 'travail', date: '2026-11-14', start: '11:00', end: '11:45', mins: 45 },
    { id: 'e-4', activity: 'Courses', categoryId: null, date: '2026-11-14', start: '18:00', end: '18:30', mins: 30 },
  ];

  it('builds hierarchical tree linking categories, subcategories, activities, and sessions', () => {
    const root = buildCategoryActivityTree({ categories, activities, entries });

    expect(root.type).toBe(TREE_NODE_TYPES.ROOT);
    expect(root.totalMins).toBe(255); // 120 + 60 + 45 + 30
    expect(root.sessionCount).toBe(4);
    expect(root.activityCount).toBe(4); // Code Frontend, Réunion équipe, Natation, Courses

    const travail = root.children.find(c => c.categoryId === 'travail');
    expect(travail).toBeTruthy();
    expect(travail.totalMins).toBe(225); // 45 direct + 180 from dev

    const dev = travail.children.find(c => c.categoryId === 'dev');
    expect(dev).toBeTruthy();
    expect(dev.totalMins).toBe(180);

    // Code Frontend deduplicates saved activity and case-variant entry
    const frontend = dev.children.find(a => a.type === TREE_NODE_TYPES.ACTIVITY && a.label === 'Code Frontend');
    expect(frontend).toBeTruthy();
    expect(frontend.totalMins).toBe(180);
    expect(frontend.sessionCount).toBe(2);
    expect(frontend.children).toHaveLength(2);
    expect(frontend.children[0].type).toBe(TREE_NODE_TYPES.SESSION);

    // Uncategorized entry creates a Sans catégorie branch
    const uncat = root.children.find(c => c.label === 'Sans catégorie');
    expect(uncat).toBeTruthy();
    expect(uncat.children[0].label).toBe('Courses');
  });

  it('excludes empty categories when includeEmptyCategories is false', () => {
    const root = buildCategoryActivityTree({
      categories,
      activities: [],
      entries: [entries[0]],
      includeEmptyCategories: false,
    });

    expect(root.children.map(c => c.categoryId)).toEqual(['travail']);
  });

  it('filters tree by query preserving matching ancestors and leaves', () => {
    const root = buildCategoryActivityTree({ categories, activities, entries });
    const filtered = filterTreeByQuery(root, 'natation');

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].categoryId).toBe('sport');
    expect(filtered.children[0].children).toHaveLength(1);
    expect(filtered.children[0].children[0].label).toBe('Natation');

    const noMatch = filterTreeByQuery(root, 'introuvable');
    expect(noMatch.children).toHaveLength(0);
  });

  it('collects node IDs and computes tree metrics', () => {
    const root = buildCategoryActivityTree({ categories, activities, entries });
    const metrics = computeTreeMetrics(root);

    expect(metrics.categoriesCount).toBe(4); // travail, dev, sport, Sans catégorie
    expect(metrics.activitiesCount).toBe(4);
    expect(metrics.sessionsCount).toBe(4);
    expect(metrics.totalMins).toBe(255);

    const catIds = collectNodeIds(root, n => n.type === TREE_NODE_TYPES.CATEGORY);
    expect(catIds.has('category:travail')).toBe(true);
    expect(catIds.has('category:dev')).toBe(true);
  });
});
