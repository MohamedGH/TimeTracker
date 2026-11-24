import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_UI_STATE,
  normalizeSearchText,
  normalizeUiState,
  mergeUiState,
} from '../src/core/ui-state.js';
import {
  buildCategoryActivityTree,
  collectMatchingTreeSuggestions,
} from '../src/core/category-activity-tree-model.js';
import { parseRouteFromHash } from '../src/core/route-manager.js';
import { clearAllData } from '../src/core/storage.js';
import { createAppState } from '../src/app-state.js';
import { createUI } from '../src/ui.js';

describe('ui-state & tree search suggestions', () => {
  it('normalizes accent-insensitive search strings', () => {
    expect(normalizeSearchText('  Développement  ')).toBe('developpement');
    expect(normalizeSearchText('Étude')).toBe('etude');
  });

  it('normalizes and merges UI state safely while excluding __root__ from collapsedTreeIds', () => {
    const normalized = normalizeUiState({
      tab: 'invalid-route',
      period: '30',
      entryFormMode: 'manual',
      collapsedTreeIds: ['__root__', 'category:travail', 'category:travail', 42],
    });

    expect(normalized.tab).toBe(DEFAULT_UI_STATE.tab);
    expect(normalized.period).toBe('30');
    expect(normalized.entryFormMode).toBe('manual');
    expect(normalized.collapsedTreeIds).toEqual(['category:travail']);

    const merged = mergeUiState(normalized, { tab: 'categories', mapPointTypeFilter: 'start' });
    expect(merged.tab).toBe('categories');
    expect(merged.period).toBe('30');
    expect(merged.mapPointTypeFilter).toBe('start');
  });

  it('uses supplied fallbackRoute in parseRouteFromHash when hash is empty or unknown', () => {
    expect(parseRouteFromHash('', 'categories')).toBe('categories');
    expect(parseRouteFromHash('#unknown', 'dashboard')).toBe('dashboard');
    expect(parseRouteFromHash('#entries', 'categories')).toBe('entries');
  });

  it('collects ranked autocomplete suggestions matching categories and activities while typing', () => {
    const tree = buildCategoryActivityTree({
      categories: [
        { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null },
        { id: 'dev', label: 'Développement', color: '#2980B9', parentId: 'travail' },
      ],
      activities: [
        { id: 'act-1', label: 'Revue de code', categoryId: 'dev' },
        { id: 'act-2', label: 'Déploiement serveur', categoryId: 'dev' },
      ],
      entries: [],
    });

    const suggestions = collectMatchingTreeSuggestions(tree, 'dev');
    expect(suggestions.map(s => s.label)).toEqual([
      'Développement',
      'Déploiement serveur',
      'Revue de code',
    ]);
    expect(suggestions[0].type).toBe('category');
    expect(suggestions[1].categoryPath).toBe('Travail › Développement');
  });
});

describe('UI session state persistence across app reopenings', () => {
  beforeEach(async () => {
    await clearAllData();
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '';
  });

  it('persists active tab, period, mode, and collapsed/expanded tree state across reopenings', async () => {
    const root1 = document.createElement('div');
    document.body.appendChild(root1);

    const app1 = await createAppState();
    const ui1 = createUI({
      root: root1,
      ...app1,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    // 1. Switch entry form mode to manual
    root1.querySelector('[data-behavior-target="entry-mode-manual"]')?.click();
    await new Promise(r => setTimeout(r, 30));

    // 2. Navigate to Dashboard and switch period to '30'
    root1.querySelector('#nav-dashboard')?.click();
    root1.querySelector('[data-behavior-target="dashboard-period-30"]')?.click();
    await new Promise(r => setTimeout(r, 30));

    // 3. Navigate to Categories, add a subcategory, expand tree, then collapse all cleanly
    app1.state.categories = [
      ...app1.state.categories,
      { id: 'dev-sub', label: 'Développement', color: '#2980B9', parentId: 'travail', builtin: false },
    ];
    await app1.persist();
    root1.querySelector('#nav-categories')?.click();
    await new Promise(r => setTimeout(r, 30));

    // Expand all in D3 tree -> wait -> verify expanded persisted
    root1.querySelector('[data-tree-action="expand-all"]')?.click();
    expect(root1.querySelector('g.tree-node[data-node-id="category:dev-sub"]')).toBeTruthy();
    await new Promise(r => setTimeout(r, 40));

    ui1.destroy();
    root1.remove();

    // Reopen app with empty hash (simulating reopening from home screen / fresh tab)
    window.location.hash = '';
    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    const app2 = await createAppState();
    const ui2 = createUI({
      root: root2,
      ...app2,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    expect(app2.state.tab).toBe('categories');
    expect(app2.state.period).toBe('30');
    expect(app2.state.uiState.entryFormMode).toBe('manual');
    // Expanded tree state preserved across reopen!
    expect(root2.querySelector('g.tree-node[data-node-id="category:dev-sub"]')).toBeTruthy();

    // Clicking "Tout replier" collapses branches without triggering search empty state
    root2.querySelector('[data-tree-action="collapse-all"]')?.click();
    expect(root2.querySelector('.cat-tree-empty').hidden).toBe(true);
    expect(root2.querySelector('g.tree-node[data-node-id="category:travail"]')).toBeTruthy();
    expect(root2.querySelector('g.tree-node[data-node-id="category:dev-sub"]')).toBeNull();
    await new Promise(r => setTimeout(r, 40));

    ui2.destroy();
    root2.remove();

    // Reopen a 3rd time -> collapsed state is also persisted!
    window.location.hash = '';
    const root3 = document.createElement('div');
    document.body.appendChild(root3);
    const app3 = await createAppState();
    const ui3 = createUI({
      root: root3,
      ...app3,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    expect(root3.querySelector('.cat-tree-empty').hidden).toBe(true);
    expect(root3.querySelector('g.tree-node[data-node-id="category:travail"]')).toBeTruthy();
    expect(root3.querySelector('g.tree-node[data-node-id="category:dev-sub"]')).toBeNull();

    ui3.destroy();
    root3.remove();
  });
});
