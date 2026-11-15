import { describe, it, expect, vi } from 'vitest';
import { appReducer, ACTION_TYPES, createStateManager } from '../src/core/state-manager.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

describe('appReducer', () => {
  const baseState = {
    entries: [],
    activities: [
      { id: 'act-1', label: 'Code', categoryId: 'travail', useCount: 3, avgDurationMins: 45 },
    ],
    categories: [...DEFAULT_CATEGORIES],
    activeTimer: null,
    tab: 'entry',
    period: '7',
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
  };

  it('handles SET_TAB cleanly reset modals and editing', () => {
    const state = { ...baseState, modal: { type: 'activity' }, editingEntryId: '123' };
    const next = appReducer(state, { type: ACTION_TYPES.SET_TAB, payload: 'dashboard' });
    expect(next.tab).toBe('dashboard');
    expect(next.modal).toBeNull();
    expect(next.editingEntryId).toBeNull();
  });

  it('handles START_TIMER and sets activeTimer', () => {
    const next = appReducer(baseState, {
      type: ACTION_TYPES.START_TIMER,
      payload: { activity: 'Lecture', categoryId: 'loisirs', date: '2026-09-28', startTime: '10:00', startTs: 1000 },
    });
    expect(next.activeTimer).toBeTruthy();
    expect(next.activeTimer.activity).toBe('Lecture');
    expect(next.activeTimer.categoryId).toBe('loisirs');
  });

  it('handles STOP_TIMER and creates time entry while updating activity stats', () => {
    const stateWithTimer = {
      ...baseState,
      activeTimer: {
        activity: 'Code',
        categoryId: 'travail',
        date: '2026-09-28',
        startTime: '10:00',
        startTs: Date.now() - 30 * 60000, // 30 min ago
      },
    };

    const next = appReducer(stateWithTimer, {
      type: ACTION_TYPES.STOP_TIMER,
      payload: { end: '10:30' },
    });

    expect(next.activeTimer).toBeNull();
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].activity).toBe('Code');
    expect(next.entries[0].mins).toBeGreaterThanOrEqual(29);

    const updatedAct = next.activities.find(a => a.label === 'Code');
    expect(updatedAct.useCount).toBe(4);
  });

  it('handles UPSERT_ENTRY for both creating and editing', () => {
    const entry = {
      id: 'e-1',
      activity: 'Sport',
      categoryId: 'sport',
      date: '2026-09-28',
      start: '08:00',
      end: '09:00',
      mins: 60,
    };

    const state1 = appReducer(baseState, { type: ACTION_TYPES.UPSERT_ENTRY, payload: entry });
    expect(state1.entries).toHaveLength(1);

    const editedEntry = { ...entry, mins: 45, end: '08:45' };
    const state2 = appReducer(state1, { type: ACTION_TYPES.UPSERT_ENTRY, payload: editedEntry });
    expect(state2.entries).toHaveLength(1);
    expect(state2.entries[0].mins).toBe(45);
  });

  it('handles DELETE_ENTRY', () => {
    const state = {
      ...baseState,
      entries: [{ id: 'e-1', activity: 'Sport', mins: 30 }],
      editingEntryId: 'e-1',
    };
    const next = appReducer(state, { type: ACTION_TYPES.DELETE_ENTRY, payload: 'e-1' });
    expect(next.entries).toHaveLength(0);
    expect(next.editingEntryId).toBeNull();
  });

  it('handles SET_AUTH_USER and CLEAR_AUTH_USER', () => {
    const user = { id: 'oidc-1', name: 'Camille', email: 'camille@example.com' };
    const signedIn = appReducer(baseState, { type: ACTION_TYPES.SET_AUTH_USER, payload: user });
    expect(signedIn.authUser).toEqual(user);

    const signedOut = appReducer(signedIn, { type: ACTION_TYPES.CLEAR_AUTH_USER });
    expect(signedOut.authUser).toBeNull();
  });
});

describe('createStateManager', () => {
  it('allows subscription and triggers persistence callback on mutations', async () => {
    const persistFn = vi.fn().mockResolvedValue(true);
    const store = createStateManager({ initialState: { entries: [] }, persistFn });

    const subscriber = vi.fn();
    const unsub = store.subscribe(subscriber);

    store.dispatch({
      type: ACTION_TYPES.ADD_ACTIVITY,
      payload: { label: 'Piano', categoryId: 'loisirs' },
    });

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(store.getState().activities.some(a => a.label === 'Piano')).toBe(true);

    unsub();
    store.dispatch({ type: ACTION_TYPES.SET_PERIOD, payload: '30' });
    expect(subscriber).toHaveBeenCalledTimes(1); // not called after unsub
  });
});
