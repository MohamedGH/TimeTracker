import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTimeEntry } from '../src/core/time-entry.js';
import { createStateManager } from '../src/core/state-manager.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';
import {
  getDefaultSplitPoint,
  resolveEntryTimeBounds,
  splitTimeEntryState,
  validateEntrySplit,
} from '../src/state/entry-actions.js';
import { clearAllData } from '../src/core/storage.js';
import { createAppState } from '../src/app-state.js';
import { createUI } from '../src/ui.js';

describe('Recorded entry splitting (entry-actions + modal + UI)', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('splits a recorded entry at a new end time with a second label (sport 00:00-01:00 -> sport 00:00-00:30 + repos 00:30-01:00)', () => {
    const original = createTimeEntry({
      id: 'e-sport-1',
      activity: 'sport',
      categoryId: 'sante',
      date: '2026-11-26',
      start: '00:00',
      end: '01:00',
      mins: 60,
      startLocation: { latitude: 48.8566, longitude: 2.3522 },
      endLocation: { latitude: 48.86, longitude: 2.36 },
      content: 'Séance cardio',
    });

    const defaults = getDefaultSplitPoint(original);
    expect(defaults).toEqual({ splitDate: '2026-11-26', splitTime: '00:30' });

    const res = splitTimeEntryState(
      { entries: [original], activities: [], activeTimer: null },
      {
        entryId: original.id,
        splitDate: '2026-11-26',
        splitTime: '00:30',
        secondActivity: 'repos',
      }
    );

    expect(res.entries).toHaveLength(2);
    expect(res.firstEntry.id).toBe('e-sport-1');
    expect(res.firstEntry.activity).toBe('sport');
    expect(res.firstEntry.start).toBe('00:00');
    expect(res.firstEntry.end).toBe('00:30');
    expect(res.firstEntry.mins).toBe(30);
    expect(res.firstEntry.startLocation).toMatchObject({ latitude: 48.8566, longitude: 2.3522 });
    expect(res.firstEntry.endLocation).toBeUndefined();
    expect(res.firstEntry.content).toBe('Séance cardio');

    expect(res.secondEntry.activity).toBe('repos');
    expect(res.secondEntry.categoryId).toBe('sante');
    expect(res.secondEntry.date).toBe('2026-11-26');
    expect(res.secondEntry.start).toBe('00:30');
    expect(res.secondEntry.end).toBe('01:00');
    expect(res.secondEntry.mins).toBe(30);
    expect(res.secondEntry.startLocation).toBeUndefined();
    expect(res.secondEntry.endLocation).toMatchObject({ latitude: 48.86, longitude: 2.36 });
    expect(res.createdActivity).toBe(true);
    expect(res.activities.some(a => a.label === 'repos')).toBe(true);
  });

  it('allows changing the activity and category of both part 1 and part 2', () => {
    const original = createTimeEntry({
      id: 'e-1',
      activity: 'sport',
      categoryId: 'sante',
      date: '2026-11-26',
      start: '14:00',
      end: '15:30',
      mins: 90,
      content: 'Ancien contenu sport',
    });

    const res = splitTimeEntryState(
      {
        entries: [original],
        activities: [
          { id: 'a-etire', label: 'Étirements', categoryId: 'sante', content: 'Respiration lente' },
        ],
        activeTimer: null,
      },
      {
        entryId: original.id,
        splitDate: '2026-11-26',
        splitTime: '14:45',
        firstActivity: 'Course à pied',
        firstCategoryId: 'loisirs',
        secondActivity: 'Étirements',
        secondCategoryId: 'sante',
      }
    );

    expect(res.firstEntry.activity).toBe('Course à pied');
    expect(res.firstEntry.categoryId).toBe('loisirs');
    expect(res.firstEntry.mins).toBe(45);
    expect(res.firstEntry.content).toBeUndefined();

    expect(res.secondEntry.activity).toBe('Étirements');
    expect(res.secondEntry.categoryId).toBe('sante');
    expect(res.secondEntry.mins).toBe(45);
    expect(res.secondEntry.content).toBe('Respiration lente');

    expect(res.activities.some(a => a.label === 'Course à pied' && a.categoryId === 'loisirs')).toBe(true);
  });

  it('handles cross-midnight entries cleanly with default midpoint and explicit splitDate', () => {
    const crossMidnight = createTimeEntry({
      id: 'e-night',
      activity: 'Travail tardif',
      categoryId: 'travail',
      date: '2026-11-26',
      start: '23:00',
      end: '01:00',
      mins: 120,
    });

    const bounds = resolveEntryTimeBounds(crossMidnight);
    expect(bounds.valid).toBe(true);
    expect(bounds.endDate).toBe('2026-11-27');
    expect(bounds.totalMins).toBe(120);

    expect(getDefaultSplitPoint(crossMidnight)).toEqual({
      splitDate: '2026-11-27',
      splitTime: '00:00',
    });

    const res = splitTimeEntryState(
      { entries: [crossMidnight], activities: [], activeTimer: null },
      {
        entryId: crossMidnight.id,
        splitDate: '2026-11-27',
        splitTime: '00:15',
        secondActivity: 'Lecture',
        secondCategoryId: 'perso',
      }
    );

    expect(res.firstEntry.date).toBe('2026-11-26');
    expect(res.firstEntry.endDate).toBe('2026-11-27');
    expect(res.firstEntry.start).toBe('23:00');
    expect(res.firstEntry.end).toBe('00:15');
    expect(res.firstEntry.mins).toBe(75);

    expect(res.secondEntry.date).toBe('2026-11-27');
    expect(res.secondEntry.start).toBe('00:15');
    expect(res.secondEntry.end).toBe('01:00');
    expect(res.secondEntry.mins).toBe(45);
  });

  it('rejects invalid split timestamps, empty labels, and sessions shorter than 2 minutes', () => {
    const shortEntry = createTimeEntry({
      id: 'e-short',
      activity: 'Appel',
      date: '2026-11-26',
      start: '10:00',
      end: '10:01',
      mins: 1,
    });
    expect(validateEntrySplit(shortEntry, { splitTime: '10:00', secondActivity: 'Note' }).valid).toBe(false);

    const normal = createTimeEntry({
      id: 'e-norm',
      activity: 'Réunion',
      date: '2026-11-26',
      start: '10:00',
      end: '11:00',
      mins: 60,
    });

    expect(validateEntrySplit(normal, { splitDate: '2026-11-26', splitTime: '10:00', secondActivity: 'Pause' }).valid).toBe(false);
    expect(validateEntrySplit(normal, { splitDate: '2026-11-26', splitTime: '11:00', secondActivity: 'Pause' }).valid).toBe(false);
    expect(validateEntrySplit(normal, { splitDate: '2026-11-26', splitTime: '10:30', secondActivity: '   ' }).valid).toBe(false);
    expect(validateEntrySplit(normal, { splitDate: '2026-11-26', splitTime: '10:30', firstActivity: '', secondActivity: 'Pause' }).valid).toBe(false);
  });

  it('supports SPLIT_ENTRY in stateManager with full undo and redo', () => {
    const entry = createTimeEntry({
      id: 'e-sm',
      activity: 'sport',
      categoryId: 'sante',
      date: '2026-11-26',
      start: '00:00',
      end: '01:00',
      mins: 60,
    });
    const sm = createStateManager({
      initialState: {
        entries: [entry],
        activities: [],
        categories: DEFAULT_CATEGORIES,
      },
    });

    sm.actions.splitEntry({
      entryId: 'e-sm',
      splitDate: '2026-11-26',
      splitTime: '00:30',
      firstActivity: 'Échauffement',
      secondActivity: 'repos',
    });

    expect(sm.getState().entries).toHaveLength(2);
    expect(sm.getState().entries.map(e => `${e.activity}:${e.start}-${e.end}`)).toEqual([
      'repos:00:30-01:00',
      'Échauffement:00:00-00:30',
    ]);

    sm.actions.undo();
    expect(sm.getState().entries).toHaveLength(1);
    expect(sm.getState().entries[0].activity).toBe('sport');
    expect(sm.getState().entries[0].end).toBe('01:00');

    sm.actions.redo();
    expect(sm.getState().entries).toHaveLength(2);
    expect(sm.getState().entries[0].activity).toBe('repos');
    expect(sm.getState().entries[1].activity).toBe('Échauffement');
  });

  it('opens the split modal from Couper button, edits both parts, splits the entry in UI, and supports undo', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = await createAppState();
    app.state.tab = 'entries';
    app.state.entries = [
      createTimeEntry({
        id: 'e-ui-1',
        activity: 'sport',
        categoryId: app.state.categories[0]?.id || null,
        date: '2026-11-26',
        start: '00:00',
        end: '01:00',
        mins: 60,
      }),
    ];

    const ui = createUI({
      root,
      ...app,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    const splitBtn = root.querySelector('[data-behavior-target="entry-split"]');
    expect(splitBtn).toBeTruthy();
    expect(splitBtn.disabled).toBe(false);
    splitBtn.click();

    const modal = root.querySelector('.entry-split-modal');
    expect(modal).toBeTruthy();

    const dateInput = modal.querySelector('[data-behavior-field="entry-split-date"]');
    const timeInput = modal.querySelector('[data-behavior-field="entry-split-time"]');
    const firstInput = modal.querySelector('[data-behavior-field="entry-split-first-label"]');
    const secondInput = modal.querySelector('[data-behavior-field="entry-split-label"]');
    const secondCatSelect = modal.querySelector('[data-behavior-field="entry-split-category"]');

    expect(dateInput.value).toBe('2026-11-26');
    expect(timeInput.value).toBe('00:30');
    expect(firstInput.value).toBe('sport');

    // Change split time and both parts
    timeInput.value = '00:25';
    timeInput.dispatchEvent(new Event('input', { bubbles: true }));

    firstInput.value = 'Cardio';
    firstInput.dispatchEvent(new Event('input', { bubbles: true }));

    secondInput.value = 'repos';
    secondInput.dispatchEvent(new Event('input', { bubbles: true }));

    const altCat = app.state.categories[1]?.id || '';
    secondCatSelect.value = altCat;
    secondCatSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const previewText = modal.querySelector('[data-entry-split-preview="true"]').textContent;
    expect(previewText).toContain('1. Cardio');
    expect(previewText).toContain('00:00 → 00:25');
    expect(previewText).toContain('2. repos');
    expect(previewText).toContain('00:25 → 01:00');

    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(app.state.entries).toHaveLength(2);
      expect(root.querySelector('.entry-split-modal')).toBeNull();
    });

    const cardio = app.state.entries.find(e => e.activity === 'Cardio');
    const repos = app.state.entries.find(e => e.activity === 'repos');
    expect(cardio).toMatchObject({ start: '00:00', end: '00:25', mins: 25 });
    expect(repos).toMatchObject({ start: '00:25', end: '01:00', mins: 35, categoryId: altCat || null });
    expect(root.textContent).toContain('Cardio');
    expect(root.textContent).toContain('repos');

    // Verify undo restores the single original entry
    const undoBtn = root.querySelector('[data-behavior-target="history-undo"]');
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();

    await vi.waitFor(() => {
      expect(app.state.entries).toHaveLength(1);
      expect(app.state.entries[0].activity).toBe('sport');
      expect(app.state.entries[0].end).toBe('01:00');
    });

    ui.destroy();
    root.remove();
  });
});
