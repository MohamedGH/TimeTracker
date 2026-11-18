import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';
import { setConsentStatus, clearConsentDecision } from '../src/core/analytics/consent.js';
import {
  initBehaviorTracking,
  resetBehaviorTracking,
  createEventStore,
  createSemanticEvent,
} from '../src/core/behavior/index.js';

function createBaseState(overrides = {}) {
  return {
    entries: [],
    activities: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    activeTimer: null,
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

describe('Insights & viaTimer UI integration', () => {
  beforeEach(async () => {
    resetBehaviorTracking();
    clearConsentDecision();
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
    await createEventStore().clear();
  });

  afterEach(() => {
    resetBehaviorTracking();
    vi.restoreAllMocks();
  });

  it('records viaTimer=false for manual creation, viaTimer=true for timer stop, and preserves viaTimer on edit', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const state = createBaseState();
    const ui = createUI({
      root,
      state,
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => true, signOut: vi.fn() },
    });

    // 1. Switch to manual mode and create a manual entry
    root.querySelector('[data-behavior-target="entry-mode-manual"]').click();
    const form = root.querySelector('form.entry-form');
    const activityInput = form.querySelector('[data-behavior-field="activity"]');
    const dateInput = form.querySelector('[data-behavior-field="date"]');
    const startInput = form.querySelector('[data-behavior-field="start"]');
    const endInput = form.querySelector('[data-behavior-field="end"]');

    activityInput.value = 'Revue manuelle';
    dateInput.value = '2026-09-28';
    startInput.value = '09:00';
    endInput.value = '09:45';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(state.entries).toHaveLength(1);
    });
    expect(state.entries[0].viaTimer).toBe(false);

    // 2. Start & stop a timer -> viaTimer: true
    root.querySelector('[data-behavior-target="entry-mode-timer"]').click();
    const timerForm = root.querySelector('form.entry-form');
    timerForm.querySelector('[data-behavior-field="activity"]').value = 'Chrono direct';
    timerForm.querySelector('[data-behavior-target="timer-start"]').click();

    await vi.waitFor(() => {
      expect(root.querySelector('[data-behavior-target="timer-stop"]')).toBeTruthy();
    });

    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(state.entries).toHaveLength(2);
      expect(root.querySelectorAll('[data-behavior-target="entry-edit"]')).toHaveLength(2);
    });
    expect(state.entries[0].activity).toBe('Chrono direct');
    expect(state.entries[0].viaTimer).toBe(true);

    // 3. Edit the timer entry manually -> must preserve viaTimer: true
    const editButtons = root.querySelectorAll('[data-behavior-target="entry-edit"]');
    editButtons[0].click();

    await vi.waitFor(() => {
      expect(root.querySelector('form.entry-form [data-behavior-field="activity"]').value).toBe('Chrono direct');
    });
    const editForm = root.querySelector('form.entry-form');
    editForm.querySelector('[data-behavior-field="activity"]').value = 'Chrono direct renommé';
    editForm.querySelector('[data-behavior-field="start"]').value = '10:00';
    editForm.querySelector('[data-behavior-field="end"]').value = '10:30';
    editForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(state.entries[0].activity).toBe('Chrono direct renommé');
    });
    expect(state.entries[0].viaTimer).toBe(true);

    ui.destroy();
    root.remove();
  });

  it('displays separated business and behavioral sections with provenance and respects denied consent', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#dashboard';

    const state = createBaseState({
      tab: 'dashboard',
      entries: [
        { id: '1', activity: 'Codage', categoryId: 'work', date: '2026-09-28', start: '09:00', end: '10:00', mins: 60, viaTimer: true },
        { id: '2', activity: 'Codage', categoryId: 'work', date: '2026-09-27', start: '09:00', end: '10:00', mins: 60, viaTimer: true },
        { id: '3', activity: 'Codage', categoryId: 'work', date: '2026-09-26', start: '09:00', end: '10:00', mins: 60, viaTimer: true },
      ],
    });

    const ui = createUI({
      root,
      state,
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => true, signOut: vi.fn() },
    });

    const businessSection = root.querySelector('[data-insights-section="business"]');
    const behaviorSection = root.querySelector('[data-insights-section="behavior"]');
    expect(businessSection).toBeTruthy();
    expect(behaviorSection).toBeTruthy();
    expect(businessSection.textContent).toContain('Habitudes personnelles');
    expect(behaviorSection.textContent).toContain('Utilisation de TimeTracker');

    // Business observation shows provenance chips & start button
    expect(businessSection.querySelector('.suggestion-provenance')).toBeTruthy();
    expect(businessSection.querySelector('[data-behavior-target="suggestion-start-activity"]')).toBeTruthy();

    // Denied consent explicitly explains local behavioral tracking is off
    const disabledBox = behaviorSection.querySelector('[data-suggestion-status="consent_disabled"]');
    expect(disabledBox).toBeTruthy();

    ui.destroy();
    root.remove();
  });

  it('runs pattern detection cleanly, updates dashboard hypotheses without infinite loops, and avoids redundant runs on period switch', async () => {
    setConsentStatus(true);
    window.location.hash = '#dashboard';

    const store = createEventStore();
    for (const [session, baseTs] of [['s1', 1000], ['s2', 10_000]]) {
      await store.append(createSemanticEvent({ action: 'search', sessionId: session, userId: 'local-u', timestamp: baseTs }));
      await store.append(createSemanticEvent({ action: 'filter', sessionId: session, userId: 'local-u', timestamp: baseTs + 500, previousAction: 'search', timeSincePreviousAction: 500 }));
    }

    const root = document.createElement('div');
    document.body.appendChild(root);
    const behavior = initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    await behavior.ready;

    const listSpy = vi.spyOn(behavior.eventStore, 'listAll');

    const ui = createUI({
      root,
      state: createBaseState({ tab: 'dashboard' }),
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => true, signOut: vi.fn() },
    });

    await vi.waitFor(() => {
      const behaviorSection = root.querySelector('[data-insights-section="behavior"]');
      expect(behaviorSection.textContent).toContain('search → filter');
      expect(behaviorSection.querySelector('.suggestion-provenance')).toBeTruthy();
    });

    expect(listSpy).toHaveBeenCalledTimes(1);

    // Switching dashboard periods must NOT re-trigger pattern detection unnecessarily
    root.querySelector('[data-behavior-target="dashboard-period-30"]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(listSpy).toHaveBeenCalledTimes(1);

    ui.destroy();
    root.remove();
  });
});
