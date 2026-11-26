import { describe, it, expect, beforeEach } from 'vitest';
import {
  createHistoryManager,
  pickUndoableSnapshot,
  applyUndoableSnapshot,
} from '../src/core/history-manager.js';
import { createStateManager, ACTION_TYPES } from '../src/core/state-manager.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';
import { clearAllData } from '../src/core/storage.js';
import { createAppState } from '../src/app-state.js';
import { createUI } from '../src/ui.js';

describe('history-manager & state-manager undo/redo', () => {
  it('pushes, deduplicates, undoes, and redoes snapshots cleanly', () => {
    const history = createHistoryManager({ maxHistory: 3 });
    const s0 = { entries: [], categories: [...DEFAULT_CATEGORIES], activities: [] };
    const s1 = { ...s0, entries: [{ id: 'e1', activity: 'Lecture', mins: 20 }] };
    const s2 = { ...s1, entries: [{ id: 'e1', activity: 'Lecture', mins: 20 }, { id: 'e2', activity: 'Sport', mins: 30 }] };

    expect(history.canUndo()).toBe(false);
    expect(history.push(s0, 'Ajout Lecture')).toBe(true);
    // Identical consecutive state is deduplicated
    expect(history.push(s0, 'Doublon')).toBe(false);
    expect(history.push(s1, 'Ajout Sport')).toBe(true);
    expect(history.canUndo()).toBe(true);
    expect(history.getUndoLabel()).toBe('Ajout Sport');

    const undone1 = history.undo(s2);
    expect(undone1.label).toBe('Ajout Sport');
    expect(undone1.snapshot.entries).toHaveLength(1);
    expect(history.canRedo()).toBe(true);
    expect(history.getRedoLabel()).toBe('Ajout Sport');

    const redone1 = history.redo(undone1.snapshot);
    expect(redone1.snapshot.entries).toHaveLength(2);

    // Pushing a new change after undo clears redo stack
    const undoneAgain = history.undo(redone1.snapshot);
    expect(history.canRedo()).toBe(true);
    history.push(undoneAgain.snapshot, 'Nouvelle action');
    expect(history.canRedo()).toBe(false);
  });

  it('supports undo/redo in createStateManager across dispatches and ACTION_TYPES.UNDO/REDO', () => {
    const store = createStateManager({
      initialState: {
        entries: [],
        activities: [],
        categories: [...DEFAULT_CATEGORIES],
      },
    });

    store.dispatch({
      type: ACTION_TYPES.ADD_ACTIVITY,
      payload: { id: 'a1', label: 'Prière', categoryId: 'autre', startContent: 'Doua début' },
    });
    expect(store.getState().activities).toHaveLength(1);
    expect(store.canUndo()).toBe(true);

    store.dispatch({
      type: ACTION_TYPES.UPSERT_ENTRY,
      payload: { id: 'e1', activity: 'Prière', categoryId: 'autre', date: '2026-11-26', start: '06:00', end: '06:15', mins: 15 },
    });
    expect(store.getState().entries).toHaveLength(1);

    const undo1 = store.undo();
    expect(undo1).toBeTruthy();
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().activities).toHaveLength(1);
    expect(store.canRedo()).toBe(true);

    store.dispatch({ type: ACTION_TYPES.UNDO });
    expect(store.getState().activities).toHaveLength(0);

    store.dispatch({ type: ACTION_TYPES.REDO });
    expect(store.getState().activities).toHaveLength(1);
    expect(store.getState().activities[0].startContent).toBe('Doua début');

    const snapshot = pickUndoableSnapshot(store.getState());
    const merged = applyUndoableSnapshot({ entries: [], customFlag: true }, snapshot);
    expect(merged.customFlag).toBe(true);
    expect(merged.activities).toHaveLength(1);
  });
});

describe('UI undo & redo buttons and keyboard shortcuts', () => {
  beforeEach(async () => {
    await clearAllData();
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '';
  });

  it('undoes and redoes manual entry creation via header buttons and Ctrl+Z / Ctrl+Y', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = await createAppState();
    const ui = createUI({
      root,
      ...app,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    const undoBtn = () => root.querySelector('[data-behavior-target="history-undo"]');
    const redoBtn = () => root.querySelector('[data-behavior-target="history-redo"]');

    expect(undoBtn().disabled).toBe(true);
    expect(redoBtn().disabled).toBe(true);

    // Switch to manual entry and submit a session
    root.querySelector('[data-behavior-target="entry-mode-manual"]').click();
    const form = root.querySelector('[data-behavior-form="entry-form"]');
    form.querySelector('[data-behavior-field="activity"]').value = 'Lecture Doha';
    form.querySelector('[data-behavior-field="start"]').value = '09:00';
    form.querySelector('[data-behavior-field="end"]').value = '09:30';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 30));

    expect(app.state.entries).toHaveLength(1);
    expect(undoBtn().disabled).toBe(false);
    expect(redoBtn().disabled).toBe(true);

    // Undo via header button
    undoBtn().click();
    await new Promise(r => setTimeout(r, 30));
    expect(app.state.entries).toHaveLength(0);
    expect(redoBtn().disabled).toBe(false);

    // Redo via header button
    redoBtn().click();
    await new Promise(r => setTimeout(r, 30));
    expect(app.state.entries).toHaveLength(1);
    expect(app.state.entries[0].activity).toBe('Lecture Doha');

    // Ctrl+Z when focused inside an input must NOT trigger global undo
    const searchInput = root.querySelector('[data-behavior-target="activity-chrono-search"]');
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    expect(app.state.entries).toHaveLength(1);

    // Global Ctrl+Z triggers undo
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    expect(app.state.entries).toHaveLength(0);

    // Global Ctrl+Y triggers redo
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    expect(app.state.entries).toHaveLength(1);

    ui.destroy();
    root.remove();
  });
});
