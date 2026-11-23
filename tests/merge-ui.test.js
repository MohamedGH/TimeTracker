import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { createStateManager } from '../src/core/state-manager.js';
import { resolveInitialMergeSelection, renderMergeModal } from '../src/components/merge/merge-modal.js';

function createSampleState(overrides = {}) {
  return {
    entries: [
      { id: 'e-1', activity: 'Dev', categoryId: 'dev', date: '2026-11-20', start: '09:00', end: '10:00', mins: 60 },
      { id: 'e-2', activity: 'Développement', categoryId: 'travail', date: '2026-11-20', start: '10:00', end: '11:00', mins: 60 },
    ],
    activities: [
      { id: 'a-1', label: 'Dev', categoryId: 'dev', useCount: 2 },
      { id: 'a-2', label: 'Développement', categoryId: 'travail', useCount: 4 },
    ],
    categories: [
      { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
      { id: 'dev', label: 'Dev', color: '#2980B9', parentId: null, builtin: false },
      { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null, builtin: true },
    ],
    activeTimer: { activity: 'Dev', categoryId: 'dev', date: '2026-11-20', startTime: '11:30', startTs: 5000 },
    timerUpdatedAt: 5000,
    quickTilesConfig: {
      allowOnLockScreen: true,
      slots: [
        { slot: 1, enabled: true, activity: 'Dev', categoryId: 'dev', categoryLabel: 'Dev', tileLabel: 'TimeTracker — Dev' },
        { slot: 2, enabled: true, activity: null, categoryId: null, categoryLabel: null, tileLabel: null },
        { slot: 3, enabled: true, activity: null, categoryId: null, categoryLabel: null, tileLabel: null },
        { slot: 4, enabled: true, activity: null, categoryId: null, categoryLabel: null, tileLabel: null },
        { slot: 5, enabled: false, activity: null, categoryId: null, categoryLabel: null, tileLabel: null },
        { slot: 6, enabled: false, activity: null, categoryId: null, categoryLabel: null, tileLabel: null },
      ],
    },
    authUser: null,
    tab: 'entry',
    period: '7',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    ...overrides,
  };
}

describe('Merge Modal & UI Integration', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('resolves distinct initial source and target selections for categories and activities', () => {
    const state = createSampleState();
    const catInit = resolveInitialMergeSelection({
      mode: 'categories',
      categories: state.categories,
      sourceCategoryId: 'dev',
    });
    expect(catInit.sourceId).toBe('dev');
    expect(catInit.targetId).toBe('travail');

    const actInit = resolveInitialMergeSelection({
      mode: 'activities',
      categories: state.categories,
      activities: state.activities,
      entries: state.entries,
    });
    expect(actInit.sourceKey).not.toBe('');
    expect(actInit.targetKey).not.toBe('');
    expect(actInit.sourceKey).not.toBe(actInit.targetKey);
  });

  it('renders MergeModal with live preview and swaps source/target correctly', () => {
    const state = createSampleState();
    const modal = { type: 'merge-items', mode: 'categories', sourceCategoryId: 'dev', targetCategoryId: 'travail' };
    const overlay = renderMergeModal({
      state,
      modal,
      onClose: vi.fn(),
      onSwitchMode: vi.fn(),
      onSubmitCategoryMerge: vi.fn(),
      onSubmitActivityMerge: vi.fn(),
    });

    const sourceSel = overlay.querySelector('[data-behavior-field="merge-source"]');
    const targetSel = overlay.querySelector('[data-behavior-field="merge-target"]');
    expect(sourceSel.dataset.categorySelectorEnhanced).toBe('1');
    expect(sourceSel.value).toBe('dev');
    expect(targetSel.value).toBe('travail');

    const preview = overlay.querySelector('[data-merge-preview="true"]');
    expect(preview.textContent).toContain('1 session transférée');

    overlay.querySelector('[data-behavior-target="merge-swap"]').click();
    expect(sourceSel.value).toBe('travail');
    expect(targetSel.value).toBe('dev');
  });

  it('merges two activities from the Activités enregistrées page UI and syncs stateManager, persistence, and Quick Tiles', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    window.location.hash = '#activities';

    const persist = vi.fn().mockResolvedValue(undefined);
    const stateManager = createStateManager({
      initialState: createSampleState({ tab: 'activities' }),
      persistFn: persist,
    });
    const bridgeMock = {
      isNativeAndroid: false,
      getCapabilities: vi.fn().mockResolvedValue({ supported: false, platform: 'web', isNative: false, apiLevel: 0 }),
      syncConfiguration: vi.fn().mockResolvedValue({ supported: false }),
      syncActiveTimer: vi.fn().mockResolvedValue({ supported: false }),
      getPendingSyncSnapshot: vi.fn().mockResolvedValue(null),
      acknowledgePendingEntries: vi.fn().mockResolvedValue({ acknowledged: 0 }),
      requestAddTile: vi.fn().mockResolvedValue({ supported: false }),
      refreshTiles: vi.fn().mockResolvedValue({ supported: false }),
      addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    };

    const ui = createUI({
      root,
      state: stateManager.getState(),
      stateManager,
      persist,
      quickTilesBridgeFactory: () => bridgeMock,
    });

    const openBtn = root.querySelector('[data-behavior-target="activity-merge-open"]');
    expect(openBtn).toBeTruthy();
    expect(openBtn.disabled).toBe(false);
    openBtn.click();

    const sourceSel = root.querySelector('[data-behavior-field="merge-source"]');
    const targetSel = root.querySelector('[data-behavior-field="merge-target"]');
    expect(sourceSel).toBeTruthy();
    expect(targetSel).toBeTruthy();

    sourceSel.value = 'dev::dev';
    sourceSel.dispatchEvent(new Event('change'));
    targetSel.value = 'travail::développement';
    targetSel.dispatchEvent(new Event('change'));

    const form = root.querySelector('[data-behavior-form="merge-form"]');
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.waitFor(() => {
      const s = stateManager.getState();
      expect(s.activities).toHaveLength(1);
      expect(s.activities[0].label).toBe('Développement');
      expect(s.activities[0].useCount).toBe(6);
      expect(s.entries.every(e => e.activity === 'Développement' && e.categoryId === 'travail')).toBe(true);
      expect(s.activeTimer.activity).toBe('Développement');
      expect(s.activeTimer.categoryId).toBe('travail');
      expect(s.quickTilesConfig.slots[0].activity).toBe('Développement');
      expect(s.quickTilesConfig.slots[0].tileLabel).toBe('TimeTracker — Développement');
      expect(persist).toHaveBeenCalled();
      expect(bridgeMock.syncConfiguration).toHaveBeenCalled();
      expect(root.querySelector('.app-notice-toast.success')?.textContent).toContain('fusionnée dans');
    });

    ui.destroy();
    root.remove();
  });

  it('merges two categories from the Categories tab UI and updates entries, activities, and notice', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const persist = vi.fn().mockResolvedValue(undefined);
    const stateManager = createStateManager({
      initialState: createSampleState({ tab: 'categories' }),
      persistFn: persist,
    });
    window.location.hash = '#categories';

    const ui = createUI({
      root,
      state: stateManager.getState(),
      stateManager,
      persist,
    });

    const mergeOpenBtn = root.querySelector('[data-behavior-target="category-merge-open"]');
    expect(mergeOpenBtn).toBeTruthy();
    mergeOpenBtn.click();

    // Verify tab switch inside merge modal works in both directions
    root.querySelector('[data-behavior-target="merge-tab-activities"]').click();
    expect(root.querySelector('.merge-modal .card-title').textContent).toBe('Fusionner deux activités');
    root.querySelector('[data-behavior-target="merge-tab-categories"]').click();
    expect(root.querySelector('.merge-modal .card-title').textContent).toBe('Fusionner deux catégories');

    const sourceSel = root.querySelector('[data-behavior-field="merge-source"]');
    const targetSel = root.querySelector('[data-behavior-field="merge-target"]');
    sourceSel.value = 'dev';
    sourceSel.dispatchEvent(new Event('change'));
    targetSel.value = 'travail';
    targetSel.dispatchEvent(new Event('change'));

    const form = root.querySelector('[data-behavior-form="merge-form"]');
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.waitFor(() => {
      const s = stateManager.getState();
      expect(s.categories.some(c => c.id === 'dev')).toBe(false);
      expect(s.entries.find(e => e.id === 'e-1').categoryId).toBe('travail');
      expect(s.activities.find(a => a.id === 'a-1').categoryId).toBe('travail');
      expect(s.activeTimer.categoryId).toBe('travail');
      expect(s.quickTilesConfig.slots[0].categoryId).toBe('travail');
      expect(persist).toHaveBeenCalled();
      expect(root.querySelector('.app-notice-toast.success')?.textContent).toContain('fusionnée dans');
    });

    ui.destroy();
    root.remove();
  });

  it('pre-selects source category when clicking Fusionner directly on a category row', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const stateManager = createStateManager({
      initialState: createSampleState({ tab: 'categories' }),
      persistFn: vi.fn().mockResolvedValue(undefined),
    });
    window.location.hash = '#categories';

    const ui = createUI({
      root,
      state: stateManager.getState(),
      stateManager,
      persist: vi.fn().mockResolvedValue(undefined),
    });

    const devRowMergeBtn = root.querySelector('.category-item-row[data-category-id="dev"] [data-behavior-target="category-merge"]');
    expect(devRowMergeBtn).toBeTruthy();
    devRowMergeBtn.click();

    const sourceSel = root.querySelector('[data-behavior-field="merge-source"]');
    expect(sourceSel.value).toBe('dev');

    ui.destroy();
    root.remove();
  });
});
