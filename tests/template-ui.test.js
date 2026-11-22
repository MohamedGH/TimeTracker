import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { createStateManager } from '../src/core/state-manager.js';

function createBaseState(overrides = {}) {
  return {
    entries: [],
    activities: [
      { id: 'act-1', label: 'Mosquée trajet', categoryId: 'transport', useCount: 3 },
      { id: 'act-2', label: 'Mosquée prière', categoryId: 'autre', useCount: 3 },
      { id: 'act-3', label: 'Mosquée doha', categoryId: 'etude', useCount: 3 },
    ],
    categories: [
      { id: 'transport', label: 'Transport', color: '#8B93A1', parentId: null, builtin: true },
      { id: 'etude', label: 'Étude', color: '#3F7068', parentId: null, builtin: true },
      { id: 'autre', label: 'Autre', color: '#948C7E', parentId: null, builtin: true },
    ],
    activityTemplates: [],
    activeTemplateRun: null,
    activeTimer: null,
    timerUpdatedAt: 0,
    quickTilesConfig: null,
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

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

function mountUI(initialOverrides = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const persist = vi.fn().mockResolvedValue(undefined);
  const stateManager = createStateManager({
    initialState: createBaseState(initialOverrides),
    persistFn: persist,
  });
  const state = stateManager.getState();
  const syncActiveTimer = vi.fn().mockResolvedValue(undefined);
  const ui = createUI({
    root,
    state,
    stateManager,
    persist,
    quickTilesBridgeFactory: () => ({
      isNativeAndroid: false,
      getCapabilities: vi.fn().mockResolvedValue({ supported: false, platform: 'web', maxSlots: 6 }),
      getPendingSyncSnapshot: vi.fn().mockResolvedValue({}),
      syncConfiguration: vi.fn().mockResolvedValue(undefined),
      syncActiveTimer,
      acknowledgePendingEntries: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn().mockResolvedValue({ remove: () => {} }),
    }),
  });
  return { root, state, persist, ui, syncActiveTimer };
}

describe('Activity Templates UI & Runner Integration', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('creates an ordered activity sequence template manually via modal (trajet -> prière -> doha)', async () => {
    const { root, state, persist } = mountUI();

    const createBtn = root.querySelector('[data-behavior-target="template-create-open"]');
    expect(createBtn).toBeTruthy();
    createBtn.click();

    const modal = root.querySelector('.template-editor-modal');
    expect(modal).toBeTruthy();

    // Add a 3rd step (modal starts with 2 step rows)
    modal.querySelector('[data-behavior-target="template-add-step"]').click();
    expect(modal.querySelectorAll('[data-template-step-index]').length).toBe(3);

    const nameInput = modal.querySelector('[data-template-field="name"]');
    nameInput.value = 'Mosquée';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    const stepInputs = modal.querySelectorAll('[data-template-step-activity]');
    const stepCats = modal.querySelectorAll('[data-template-step-category]');
    const stepMins = modal.querySelectorAll('[data-template-step-mins]');

    stepInputs[0].value = 'Mosquée trajet';
    stepInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    stepCats[0].value = 'transport';
    stepCats[0].dispatchEvent(new Event('change', { bubbles: true }));
    stepMins[0].value = '15';
    stepMins[0].dispatchEvent(new Event('input', { bubbles: true }));

    stepInputs[1].value = 'Mosquée prière';
    stepInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    stepCats[1].value = 'autre';
    stepCats[1].dispatchEvent(new Event('change', { bubbles: true }));
    stepMins[1].value = '20';
    stepMins[1].dispatchEvent(new Event('input', { bubbles: true }));

    stepInputs[2].value = 'Mosquée doha';
    stepInputs[2].dispatchEvent(new Event('input', { bubbles: true }));
    stepCats[2].value = 'etude';
    stepCats[2].dispatchEvent(new Event('change', { bubbles: true }));
    stepMins[2].value = '15';
    stepMins[2].dispatchEvent(new Event('input', { bubbles: true }));

    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();

    expect(persist).toHaveBeenCalled();
    expect(state.activityTemplates).toHaveLength(1);
    expect(state.activityTemplates[0].name).toBe('Mosquée');
    expect(state.activityTemplates[0].steps.map(s => s.activity)).toEqual([
      'Mosquée trajet',
      'Mosquée prière',
      'Mosquée doha',
    ]);
    expect(root.querySelector('.template-row-name').textContent).toBe('Mosquée');
    expect(root.querySelector('.template-sequence-preview').textContent).toContain('1. Mosquée trajet');
    expect(root.querySelector('.template-sequence-preview').textContent).toContain('3. Mosquée doha');
  });

  it('shows inline validation error in modal when template name or step is missing', async () => {
    const { root, state } = mountUI();

    root.querySelector('[data-behavior-target="template-create-open"]').click();
    const modal = root.querySelector('.template-editor-modal');
    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    const err = root.querySelector('[data-template-error]');
    expect(err).toBeTruthy();
    expect(err.textContent).toContain('Veuillez donner un nom');
    expect(state.activityTemplates).toHaveLength(0);
    expect(state.modal).not.toBeNull();
  });

  it('creates a template from already-recorded chronological data (and detected recurring sequences)', async () => {
    const recordedEntries = [
      // Unordered array representing 2 days of Mosquée trajet -> Mosquée prière -> Doha
      { id: 'd2-3', activity: 'Mosquée doha', categoryId: 'etude', date: '2026-11-22', start: '08:40', end: '08:55', mins: 15 },
      { id: 'd2-1', activity: 'Mosquée trajet', categoryId: 'transport', date: '2026-11-22', start: '08:05', end: '08:20', mins: 15 },
      { id: 'd2-2', activity: 'Mosquée prière', categoryId: 'autre', date: '2026-11-22', start: '08:20', end: '08:40', mins: 20 },
      { id: 'd1-1', activity: 'Mosquée trajet', categoryId: 'transport', date: '2026-11-21', start: '08:00', end: '08:15', mins: 15 },
      { id: 'd1-2', activity: 'Mosquée prière', categoryId: 'autre', date: '2026-11-21', start: '08:15', end: '08:35', mins: 20 },
      { id: 'd1-3', activity: 'Mosquée doha', categoryId: 'etude', date: '2026-11-21', start: '08:35', end: '08:50', mins: 15 },
    ];

    const { root, state } = mountUI({ entries: recordedEntries });

    root.querySelector('[data-behavior-target="template-from-history-open"]').click();
    const modal = root.querySelector('.template-editor-modal');
    expect(modal).toBeTruthy();

    // Recurring section detected!
    const recurringFlow = modal.querySelector('.template-recurring-flow');
    expect(recurringFlow).toBeTruthy();
    expect(recurringFlow.textContent).toBe('Mosquée trajet → Mosquée prière → Mosquée doha');

    // Day extractor also lists entries in chronological order
    const dayEntryTitles = Array.from(modal.querySelectorAll('.template-history-entry-content strong')).map(n => n.textContent);
    expect(dayEntryTitles).toEqual(['Mosquée trajet', 'Mosquée prière', 'Mosquée doha']);

    // Load from day entries
    modal.querySelector('[data-behavior-target="template-load-from-entries"]').click();
    const loadedSteps = Array.from(modal.querySelectorAll('[data-template-step-activity]')).map(i => i.value);
    expect(loadedSteps).toEqual(['Mosquée trajet', 'Mosquée prière', 'Mosquée doha']);

    // Rename & save
    const nameInput = modal.querySelector('[data-template-field="name"]');
    nameInput.value = 'Routine Mosquée';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(state.activityTemplates).toHaveLength(1);
    expect(state.activityTemplates[0].name).toBe('Routine Mosquée');
    expect(state.activityTemplates[0].steps).toHaveLength(3);
  });

  it('executes a 3-step template sequentially (chrono 1 -> chrono 2 -> chrono 3 -> finish)', async () => {
    const template = {
      id: 'tpl-mosque',
      name: 'Mosquée',
      steps: [
        { id: 's1', activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 15 },
        { id: 's2', activity: 'Mosquée prière', categoryId: 'autre', targetMins: 20 },
        { id: 's3', activity: 'Mosquée doha', categoryId: 'etude', targetMins: 15 },
      ],
      useCount: 0,
      updatedAt: 1000,
    };

    const { root, state, syncActiveTimer } = mountUI({ activityTemplates: [template] });

    // Launch template
    root.querySelector('[data-behavior-target="template-start"]').click();
    await flushAsync();

    expect(state.activeTimer.activity).toBe('Mosquée trajet');
    expect(state.activeTemplateRun.currentIndex).toBe(0);
    expect(root.querySelector('[data-template-runner="running"]')).toBeTruthy();
    expect(root.querySelector('[data-behavior-target="template-next-step"]').textContent).toContain('Mosquée prière');
    expect(syncActiveTimer).toHaveBeenCalled();

    // Advance to Step 2
    root.querySelector('[data-behavior-target="template-next-step"]').click();
    await flushAsync();

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].activity).toBe('Mosquée trajet');
    expect(state.activeTimer.activity).toBe('Mosquée prière');
    expect(state.activeTemplateRun.currentIndex).toBe(1);

    // Floating bar on dashboard also shows template progression & next button
    root.querySelector('#nav-dashboard').click();
    await flushAsync();
    const floatingNext = root.querySelector('[data-behavior-target="floating-template-next"]');
    expect(floatingNext).toBeTruthy();
    expect(root.querySelector('.floating-timer-template-step').textContent).toBe('Gabarit 2/3');

    // Advance to Step 3 from floating bar
    floatingNext.click();
    await flushAsync();

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0].activity).toBe('Mosquée prière');
    expect(state.activeTimer.activity).toBe('Mosquée doha');
    expect(state.activeTemplateRun.currentIndex).toBe(2);

    // Complete final step
    root.querySelector('[data-behavior-target="floating-template-complete"]').click();
    await flushAsync();

    expect(state.entries).toHaveLength(3);
    expect(state.entries[0].activity).toBe('Mosquée doha');
    expect(state.activeTimer).toBeNull();
    expect(state.activeTemplateRun).toBeNull();
  });

  it('allows pausing mid-sequence via normal stop button and resuming the next step cleanly', async () => {
    const template = {
      id: 'tpl-mosque',
      name: 'Mosquée',
      steps: [
        { id: 's1', activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 15 },
        { id: 's2', activity: 'Mosquée prière', categoryId: 'autre', targetMins: 20 },
      ],
      useCount: 0,
      updatedAt: 1000,
    };

    const { root, state } = mountUI({ activityTemplates: [template] });

    root.querySelector('[data-behavior-target="template-start"]').click();
    await flushAsync();

    // User stops timer manually
    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await flushAsync();

    expect(state.entries).toHaveLength(1);
    expect(state.activeTimer).toBeNull();
    expect(state.activeTemplateRun).toMatchObject({
      currentIndex: 1,
      stepState: 'ready',
    });

    const resumeBtn = root.querySelector('[data-behavior-target="template-resume-step"]');
    expect(resumeBtn).toBeTruthy();
    expect(resumeBtn.textContent).toContain('Mosquée prière');

    resumeBtn.click();
    await flushAsync();

    expect(state.activeTimer.activity).toBe('Mosquée prière');
    expect(state.activeTemplateRun.stepState).toBe('running');
  });

  it('logs a template retroactively as consecutive entries via the manual batch logger modal', async () => {
    const template = {
      id: 'tpl-mosque',
      name: 'Mosquée',
      steps: [
        { id: 's1', activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 15 },
        { id: 's2', activity: 'Mosquée prière', categoryId: 'autre', targetMins: 20 },
        { id: 's3', activity: 'Mosquée doha', categoryId: 'etude', targetMins: 15 },
      ],
      useCount: 0,
      updatedAt: 1000,
    };

    const { root, state } = mountUI({ activityTemplates: [template] });

    root.querySelector('[data-behavior-target="template-log-manual"]').click();
    const modal = root.querySelector('.template-manual-log-modal');
    expect(modal).toBeTruthy();

    const dateInput = modal.querySelector('[data-template-log-field="date"]');
    const startInput = modal.querySelector('[data-template-log-field="start"]');
    dateInput.value = '2026-11-22';
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    startInput.value = '08:00';
    startInput.dispatchEvent(new Event('input', { bubbles: true }));

    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();

    expect(state.entries).toHaveLength(3);
    const chronological = state.entries.slice().reverse();
    expect(chronological.map(e => `${e.start}-${e.end} ${e.activity}`)).toEqual([
      '08:00-08:15 Mosquée trajet',
      '08:15-08:35 Mosquée prière',
      '08:35-08:50 Mosquée doha',
    ]);
  });
});
