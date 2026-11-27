import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeTargetMins,
  normalizeAsyncTimer,
  normalizeAsyncTimersList,
  startAsyncTimerInList,
  stopAsyncTimerInList,
  discardAsyncTimerInList,
  updateAsyncTimerTargetInList,
  markAsyncTimerAlertedInList,
  demoteActiveTimerToAsync,
  promoteAsyncTimerToActive,
  computeAsyncTimerProgress,
} from '../src/state/async-timer-actions.js';
import { createStateManager } from '../src/core/state-manager.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';
import { isTimeEntry } from '../src/core/time-entry.js';
import { buildExportPayload, parseImportPayload } from '../src/core/import-export.js';
import { clearAllData } from '../src/core/storage.js';
import { createAppState } from '../src/app-state.js';
import { createUI } from '../src/ui.js';

describe('async-timer-actions pure domain helpers', () => {
  it('starts multiple parallel timers, computes target progress, and updates target', () => {
    const t0 = 1_700_000_000_000;
    const { timers: list1, timer: cook } = startAsyncTimerInList([], {
      id: 'async-cook',
      activity: 'Faire à manger (réchauffer le plat)',
      categoryId: 'autre',
      startTs: t0,
      startTime: '12:00',
      date: '2026-11-27',
      targetMins: 15,
      content: 'Vérifier le four',
    });

    const { timers: list2, timer: laundry } = startAsyncTimerInList(list1, {
      id: 'async-laundry',
      activity: 'Machine à laver',
      categoryId: 'autre',
      startTs: t0 + 60_000,
      startTime: '12:01',
      date: '2026-11-27',
      targetMins: 45,
    });

    expect(list2).toHaveLength(2);
    expect(cook.isAsync).toBe(true);
    expect(cook.targetMins).toBe(15);
    expect(laundry.targetMins).toBe(45);

    const mid = computeAsyncTimerProgress(cook, t0 + 10 * 60_000);
    expect(mid.elapsedSecs).toBe(600);
    expect(mid.remainingSecs).toBe(300);
    expect(mid.isOverdue).toBe(false);
    expect(mid.progressRatio).toBeCloseTo(10 / 15, 2);

    const overdue = computeAsyncTimerProgress(cook, t0 + 17 * 60_000);
    expect(overdue.isOverdue).toBe(true);
    expect(overdue.remainingSecs).toBe(0);
    expect(overdue.overdueSecs).toBe(120);
    expect(overdue.progressRatio).toBe(1);

    const alerted = markAsyncTimerAlertedInList(list2, 'async-cook');
    expect(alerted.find(t => t.id === 'async-cook').alerted).toBe(true);

    const updated = updateAsyncTimerTargetInList(alerted, 'async-cook', 20);
    expect(updated.updatedTimer.targetMins).toBe(20);
    expect(updated.updatedTimer.alerted).toBeUndefined();
  });

  it('stops a parallel timer into an isAsync TimeEntry without touching other parallel timers', () => {
    const startTs = 1_700_000_000_000;
    const { timers } = startAsyncTimerInList([], {
      id: 'async-1',
      activity: 'Réchauffer le plat',
      categoryId: 'autre',
      startTs,
      startTime: '12:00',
      date: '2026-11-27',
      targetMins: 15,
      content: 'Remuer à mi-cuisson',
    });
    const { timers: both } = startAsyncTimerInList(timers, {
      id: 'async-2',
      activity: 'Lave-vaisselle',
      categoryId: 'autre',
      startTs: startTs + 120_000,
      startTime: '12:02',
      date: '2026-11-27',
    });

    const stopped = stopAsyncTimerInList(both, 'async-1', {
      nowTs: startTs + 15 * 60_000,
      endTime: '12:15',
      endDate: '2026-11-27',
      entryId: 'entry-async-1',
    });

    expect(stopped.timers).toHaveLength(1);
    expect(stopped.timers[0].id).toBe('async-2');
    expect(stopped.durationMinutes).toBe(15);
    expect(isTimeEntry(stopped.entry)).toBe(true);
    expect(stopped.entry.isAsync).toBe(true);
    expect(stopped.entry.viaTimer).toBe(true);
    expect(stopped.entry.content).toBe('Remuer à mi-cuisson');

    const discarded = discardAsyncTimerInList(stopped.timers, 'async-2');
    expect(discarded.discardedTimer.id).toBe('async-2');
    expect(discarded.timers).toHaveLength(0);
  });

  it('demotes foreground timer to parallel and promotes/swaps parallel timer back to foreground', () => {
    const fg = {
      activity: 'Code',
      categoryId: 'travail',
      cat: 'travail',
      startTs: 1_700_000_000_000,
      startTime: '14:00',
      date: '2026-11-27',
      content: 'Sprint backend',
    };

    const demoted = demoteActiveTimerToAsync(fg, [], { id: 'async-code', targetMins: 25 });
    expect(demoted.activeTimer).toBeNull();
    expect(demoted.activeAsyncTimers).toHaveLength(1);
    expect(demoted.movedTimer.activity).toBe('Code');
    expect(demoted.movedTimer.targetMins).toBe(25);

    const newFg = {
      activity: 'Appel',
      categoryId: 'travail',
      cat: 'travail',
      startTs: 1_700_000_120_000,
      startTime: '14:02',
      date: '2026-11-27',
    };

    const swapped = promoteAsyncTimerToActive(newFg, demoted.activeAsyncTimers, 'async-code');
    expect(swapped.activeTimer.activity).toBe('Code');
    expect(swapped.activeTimer.content).toBe('Sprint backend');
    expect(swapped.activeAsyncTimers).toHaveLength(1);
    expect(swapped.activeAsyncTimers[0].activity).toBe('Appel');
  });

  it('normalizes target minutes and invalid async timers safely', () => {
    expect(normalizeTargetMins('')).toBeNull();
    expect(normalizeTargetMins(-5)).toBeNull();
    expect(normalizeTargetMins('15.4')).toBe(15);
    expect(normalizeAsyncTimer(null)).toBeNull();
    expect(normalizeAsyncTimer({ activity: 'Test', startTs: -1 })).toBeNull();
    expect(normalizeAsyncTimersList([{ id: 'a', activity: 'Cook', categoryId: 'autre', startTs: 1000 }, { id: 'a', activity: 'Dup', categoryId: 'autre', startTs: 1000 }])).toHaveLength(1);
  });
});

describe('StateManager & Undo/Redo + Import/Export for async timers', () => {
  it('runs async timer lifecycle through StateManager with full Undo/Redo', () => {
    const sm = createStateManager({
      initialState: {
        entries: [],
        activities: [
          {
            id: 'act-cook',
            label: 'Faire à manger',
            categoryId: 'autre',
            useCount: 0,
            isAsync: true,
            defaultTargetMins: 15,
            content: 'Couvrir la casserole',
          },
        ],
        categories: [...DEFAULT_CATEGORIES],
        activeTimer: null,
        activeAsyncTimers: [],
      },
    });

    const t0 = 1_700_000_000_000;
    sm.actions.startAsyncTimer({
      id: 'async-cook-1',
      activity: 'Faire à manger',
      categoryId: 'autre',
      date: '2026-11-27',
      startTime: '12:00',
      startTs: t0,
    });

    expect(sm.getState().activeAsyncTimers).toHaveLength(1);
    expect(sm.getState().activeAsyncTimers[0].targetMins).toBe(15);
    expect(sm.getState().activeAsyncTimers[0].content).toBe('Couvrir la casserole');

    // Start foreground timer concurrently
    sm.actions.startTimer({
      activity: 'Lecture',
      categoryId: 'loisirs',
      date: '2026-11-27',
      startTime: '12:01',
      startTs: t0 + 60_000,
    });
    expect(sm.getState().activeTimer.activity).toBe('Lecture');
    expect(sm.getState().activeAsyncTimers).toHaveLength(1);

    // Finish async timer while foreground timer stays running
    sm.actions.stopAsyncTimer({
      timerId: 'async-cook-1',
      nowTs: t0 + 15 * 60_000,
      endTime: '12:15',
      endDate: '2026-11-27',
    });

    expect(sm.getState().activeAsyncTimers).toHaveLength(0);
    expect(sm.getState().activeTimer.activity).toBe('Lecture');
    expect(sm.getState().entries).toHaveLength(1);
    expect(sm.getState().entries[0].isAsync).toBe(true);
    expect(sm.getState().entries[0].mins).toBe(15);

    // Undo stopping the async timer
    sm.actions.undo();
    expect(sm.getState().entries).toHaveLength(0);
    expect(sm.getState().activeAsyncTimers).toHaveLength(1);
    expect(sm.getState().activeAsyncTimers[0].id).toBe('async-cook-1');

    // Redo stopping the async timer
    sm.actions.redo();
    expect(sm.getState().entries).toHaveLength(1);
    expect(sm.getState().activeAsyncTimers).toHaveLength(0);

    // Export & import preserves isAsync on entries and savedActivities
    const exported = buildExportPayload({
      entries: sm.getState().entries,
      savedActivities: sm.getState().activities,
      categories: sm.getState().categories,
    });
    const imported = parseImportPayload(JSON.stringify(exported));
    expect(imported.entries[0].isAsync).toBe(true);
    expect(imported.savedActivities[0].isAsync).toBe(true);
    expect(imported.savedActivities[0].defaultTargetMins).toBe(15);
  });
});

describe('UI integration: parallel/asynchronous activities alongside foreground chronometer', () => {
  beforeEach(async () => {
    await clearAllData();
    document.body.innerHTML = '';
  });

  it('launches a cooking parallel timer with target duration while starting and running another foreground timer', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = await createAppState();
    const ui = createUI({
      root,
      ...app,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    // 1. Launch parallel activity from the "Activités en parallèle" card
    const asyncForm = root.querySelector('[data-behavior-form="async-launch-form"]');
    expect(asyncForm).toBeTruthy();

    const asyncInput = asyncForm.querySelector('[data-behavior-target="async-launch-activity"]');
    asyncInput.value = 'Faire à manger (réchauffer le plat)';
    asyncInput.dispatchEvent(new Event('input', { bubbles: true }));

    const preset15 = [...asyncForm.querySelectorAll('[data-behavior-target="async-launch-preset"]')]
      .find(btn => btn.textContent.trim() === '15 min');
    expect(preset15).toBeTruthy();
    preset15.click();
    expect(asyncForm.querySelector('[data-behavior-target="async-launch-mins"]').value).toBe('15');

    asyncForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(app.state.activeAsyncTimers).toHaveLength(1);
      expect(app.state.activeAsyncTimers[0].activity).toBe('Faire à manger (réchauffer le plat)');
      expect(app.state.activeAsyncTimers[0].targetMins).toBe(15);
      expect(root.querySelector('[data-async-timers-list]')).toBeTruthy();
    });

    const asyncRow = root.querySelector(`[data-async-timer-id="${app.state.activeAsyncTimers[0].id}"]`);
    expect(asyncRow.textContent).toContain('Cible 15 min');
    expect(asyncRow.textContent).toContain('Reste');

    // Floating bar shows parallel activity when navigating to another tab while no foreground timer is active
    root.querySelector('#nav-dashboard').click();
    await vi.waitFor(() => {
      const bar = root.querySelector('.floating-timer-bar');
      expect(bar).toBeTruthy();
      expect(bar.textContent).toContain('En parallèle ·');
      expect(bar.textContent).toContain('Faire à manger (réchauffer le plat)');
    });
    root.querySelector('#nav-entry').click();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-behavior-form="entry-form"]')).toBeTruthy();
    });

    // 2. While cooking runs in parallel, start a foreground chronometer for "Lecture"
    const entryForm = root.querySelector('[data-behavior-form="entry-form"]');
    const actInput = entryForm.querySelector('[data-behavior-field="activity"]');
    actInput.value = 'Lecture';
    actInput.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-behavior-target="timer-start"]').click();

    await vi.waitFor(() => {
      expect(app.state.activeTimer?.activity).toBe('Lecture');
      expect(app.state.activeAsyncTimers).toHaveLength(1);
      expect(root.querySelector('.timer-active')?.textContent).toContain('Lecture');
    });

    // Floating bar displays primary timer + "+1 en parallèle" on another tab
    root.querySelector('#nav-dashboard').click();
    await vi.waitFor(() => {
      const bar = root.querySelector('.floating-timer-bar');
      expect(bar).toBeTruthy();
      expect(bar.textContent).toContain('Lecture');
      expect(bar.textContent).toContain('+1 en parallèle');
    });
    root.querySelector('#nav-entry').click();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-behavior-target="async-timer-add-5"]')).toBeTruthy();
    });

    // 3. Extend target by +5 min on the parallel task
    root.querySelector('[data-behavior-target="async-timer-add-5"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeAsyncTimers[0].targetMins).toBe(20);
      expect(root.querySelector('[data-async-timers-list]')?.textContent).toContain('Cible 20 min');
    });

    // 4. Finish the parallel cooking timer while keeping "Lecture" running in foreground
    root.querySelector('[data-behavior-target="async-timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeAsyncTimers).toHaveLength(0);
      expect(app.state.activeTimer?.activity).toBe('Lecture');
      expect(app.state.entries.some(e => e.activity === 'Faire à manger (réchauffer le plat)' && e.isAsync === true)).toBe(true);
    });

    // 5. Demote foreground "Lecture" to parallel via ⇄ Mettre en parallèle
    root.querySelector('[data-behavior-target="timer-demote-async"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(app.state.activeAsyncTimers).toHaveLength(1);
      expect(app.state.activeAsyncTimers[0].activity).toBe('Lecture');
    });

    // 6. Launch another parallel activity directly from search ("⏳ Parallèle")
    const searchInput = root.querySelector('[data-behavior-target="activity-chrono-search"]');
    searchInput.value = 'Faire à manger';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    const searchAsyncBtn = root.querySelector('[data-behavior-target="search-launch-async"]');
    expect(searchAsyncBtn).toBeTruthy();
    searchAsyncBtn.click();

    await vi.waitFor(() => {
      expect(app.state.activeAsyncTimers).toHaveLength(2);
      expect(root.querySelectorAll('[data-async-timer-id]')).toHaveLength(2);
    });

    // 7. Promote "Lecture" back to foreground chronometer via ⇄ Principal
    const lectureId = app.state.activeAsyncTimers.find(t => t.activity === 'Lecture').id;
    const lectureRow = root.querySelector(`[data-async-timer-id="${lectureId}"]`);
    expect(lectureRow).toBeTruthy();
    lectureRow.querySelector('[data-behavior-target="async-timer-promote"]').click();

    await vi.waitFor(() => {
      expect(app.state.activeTimer?.activity).toBe('Lecture');
      expect(app.state.activeAsyncTimers).toHaveLength(1);
      expect(app.state.activeAsyncTimers[0].activity).toBe('Faire à manger (réchauffer le plat)');
      expect(root.querySelector('[data-behavior-target="timer-stop"]')).toBeTruthy();
      expect(root.querySelector('[data-behavior-target="async-timer-discard"]')).toBeTruthy();
    });

    // Cleanly stop/discard timers and check "· En parallèle" in entries tab
    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(root.querySelector('.timer-active')).toBeNull();
    });
    root.querySelector('[data-behavior-target="async-timer-discard"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeAsyncTimers).toHaveLength(0);
    });

    root.querySelector('#nav-entries').click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('En parallèle');
    });

    ui.destroy();
    root.remove();
  });
});
