import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectCategoryShortcuts,
  filterShortcutGroups,
  UNCATEGORIZED_SHORTCUT_KEY,
} from '../src/core/shortcuts-by-category.js';
import { createStateManager } from '../src/core/state-manager.js';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

describe('shortcuts-by-category (pure functional module)', () => {
  const categories = [
    { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null },
    { id: 'dev', label: 'Développement', color: '#3F7068', parentId: 'travail' },
    { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null },
    { id: 'loisirs', label: 'Loisirs', color: '#C98A3D', parentId: null },
  ];

  const activities = [
    { id: 'a1', label: 'Revue PR', categoryId: 'travail', useCount: 4 },
    { id: 'a2', label: 'Frontend', categoryId: 'dev', useCount: 6 },
    { id: 'a3', label: 'Yoga', categoryId: 'sport', useCount: 1 },
  ];

  const entries = [
    { id: 'e1', activity: 'Frontend', categoryId: 'dev', date: '2026-11-18', start: '09:00', end: '10:00', mins: 60 },
    { id: 'e2', activity: 'Frontend', categoryId: 'dev', date: '2026-11-17', start: '09:00', end: '10:00', mins: 60 },
    { id: 'e3', activity: 'Course', categoryId: 'sport', date: '2026-11-18', start: '18:00', end: '18:45', mins: 45 },
    { id: 'e4', activity: 'Course', categoryId: 'sport', date: '2026-11-17', start: '18:00', end: '18:45', mins: 45 },
    { id: 'e5', activity: 'Note rapide', categoryId: null, date: '2026-11-16', start: '20:00', end: '20:15', mins: 15 },
    { id: 'e6', activity: 'Archive supprimée', categoryId: 'deleted-cat', date: '2026-11-15', start: '12:00', end: '12:15', mins: 15 },
  ];

  it('returns empty structure when there are no entries or saved activities', () => {
    const res = collectCategoryShortcuts({ entries: [], activities: [], categories });
    expect(res).toEqual({ groups: [], totalShortcuts: 0, categoriesCount: 0 });
  });

  it('classifies unique shortcuts by exact category, sorts by score, and puts uncategorized last', () => {
    const { groups, totalShortcuts, categoriesCount } = collectCategoryShortcuts({
      entries,
      activities,
      categories,
    });

    expect(categoriesCount).toBe(4); // dev, sport, travail, uncategorized
    expect(totalShortcuts).toBe(6);

    // First group should be highest scoring categorized group (dev: Frontend 6×)
    expect(groups[0].categoryId).toBe('dev');
    expect(groups[0].pathLabel).toBe('Travail > Développement');
    expect(groups[0].shortcuts.map(s => s.name)).toEqual(['Frontend']);

    // Sport has Course (2×, recent) ranked before Yoga (1×)
    const sportGroup = groups.find(g => g.categoryId === 'sport');
    expect(sportGroup).toBeTruthy();
    expect(sportGroup.shortcuts.map(s => s.name)).toEqual(['Course', 'Yoga']);

    // Uncategorized (explicit null or deleted categoryId) placed last
    const lastGroup = groups.at(-1);
    expect(lastGroup.categoryId).toBeNull();
    expect(lastGroup.filterKey).toBe(UNCATEGORIZED_SHORTCUT_KEY);
    expect(lastGroup.shortcuts.map(s => s.name)).toContain('Note rapide');
    expect(lastGroup.shortcuts.map(s => s.name)).toContain('Archive supprimée');
  });

  it('supports rolling subcategories up to root category when groupBy="root"', () => {
    const { groups } = collectCategoryShortcuts({
      entries,
      activities,
      categories,
      groupBy: 'root',
    });

    const travailGroup = groups.find(g => g.categoryId === 'travail');
    expect(travailGroup).toBeTruthy();
    expect(travailGroup.shortcuts.map(s => s.name)).toEqual(['Frontend', 'Revue PR']);
    expect(groups.some(g => g.categoryId === 'dev')).toBe(false);
  });

  it('filters shortcut groups cleanly and falls back to all if filter key does not exist', () => {
    const { groups } = collectCategoryShortcuts({ entries, activities, categories });
    expect(filterShortcutGroups(groups, 'all')).toHaveLength(groups.length);
    const onlySport = filterShortcutGroups(groups, 'sport');
    expect(onlySport).toHaveLength(1);
    expect(onlySport[0].categoryId).toBe('sport');

    expect(filterShortcutGroups(groups, 'nonexistent')).toHaveLength(groups.length);
  });

  it('caps per category and fairly across categories when exceeding maxTotal', () => {
    const manyActivities = [
      { id: '1', label: 'T1', categoryId: 'travail', useCount: 10 },
      { id: '2', label: 'T2', categoryId: 'travail', useCount: 9 },
      { id: '3', label: 'T3', categoryId: 'travail', useCount: 8 },
      { id: '4', label: 'S1', categoryId: 'sport', useCount: 7 },
      { id: '5', label: 'S2', categoryId: 'sport', useCount: 6 },
      { id: '6', label: 'L1', categoryId: 'loisirs', useCount: 5 },
    ];
    const res = collectCategoryShortcuts({
      entries: [],
      activities: manyActivities,
      categories,
      maxPerCategory: 2,
      maxTotal: 4,
    });
    expect(res.totalShortcuts).toBe(4);
    expect(res.groups).toHaveLength(3); // Every category kept at least 1 shortcut
  });
});

describe('stateManager shortcut category filter & UI integration', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('updates shortcutCategoryFilter via stateManager reducer', () => {
    const sm = createStateManager();
    expect(sm.getState().shortcutCategoryFilter).toBe('all');
    sm.actions.setShortcutCategoryFilter('travail');
    expect(sm.getState().shortcutCategoryFilter).toBe('travail');
  });

  it('renders shortcuts grouped by category, filters by category, and launches timer in 1 click', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const state = {
      entries: [
        { id: 'e1', activity: 'Codage', categoryId: 'travail', date: '2026-11-18', start: '09:00', end: '10:00', mins: 60 },
        { id: 'e2', activity: 'Course', categoryId: 'sport', date: '2026-11-18', start: '18:00', end: '18:30', mins: 30 },
      ],
      activities: [
        { id: 'a1', label: 'Réunion', categoryId: 'travail', useCount: 2 },
      ],
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
      activeTimer: null,
      authUser: null,
      tab: 'entry',
      period: '7',
      shortcutCategoryFilter: 'all',
      customStart: null,
      customEnd: null,
      editingEntryId: null,
      modal: null,
      error: null,
      notice: null,
    };

    const persist = vi.fn().mockResolvedValue(undefined);
    const ui = createUI({
      root,
      state,
      persist,
      authClient: { isConfigured: () => true, signOut: vi.fn() },
    });

    const card = root.querySelector('[data-shortcuts-by-category="true"]');
    expect(card).toBeTruthy();

    const groups = card.querySelectorAll('.shortcut-category-group');
    expect(groups).toHaveLength(2);
    expect(card.querySelector('[data-shortcut-category="travail"]')).toBeTruthy();
    expect(card.querySelector('[data-shortcut-category="sport"]')).toBeTruthy();

    // Filter to Sport only
    const sportFilterBtn = card.querySelector('[data-behavior-target="shortcut-filter-category"][data-shortcut-filter="sport"]');
    expect(sportFilterBtn).toBeTruthy();
    sportFilterBtn.click();

    expect(state.shortcutCategoryFilter).toBe('sport');
    const filteredGroups = root.querySelectorAll('.shortcut-category-group');
    expect(filteredGroups).toHaveLength(1);
    expect(filteredGroups[0].dataset.shortcutCategory).toBe('sport');

    // Launch shortcut in 1 click
    const courseBtn = filteredGroups[0].querySelector('[data-behavior-target="quick-shortcut-start"]');
    expect(courseBtn.textContent).toContain('Course');
    courseBtn.click();

    await vi.waitFor(() => {
      expect(state.activeTimer).toBeTruthy();
    });
    expect(state.activeTimer.activity).toBe('Course');
    expect(state.activeTimer.categoryId).toBe('sport');

    ui.destroy();
    root.remove();
  });
});
