/**
 * State Manager — Functional, reactive state container for TimeTracker.
 * Uses pure reducer logic for deterministic state updates and reactive subscriptions.
 */

import { DEFAULT_CATEGORIES } from './model.js';
import { createTimeEntry } from './time-entry.js';
import { createActiveTimer, elapsedMinutes } from './timer.js';
import { today } from './time.js';

export const ACTION_TYPES = Object.freeze({
  SET_TAB: 'SET_TAB',
  SET_PERIOD: 'SET_PERIOD',
  SET_SHORTCUT_CATEGORY_FILTER: 'SET_SHORTCUT_CATEGORY_FILTER',
  SET_MODAL: 'SET_MODAL',
  CLOSE_MODAL: 'CLOSE_MODAL',
  SET_EDITING_ENTRY: 'SET_EDITING_ENTRY',
  START_TIMER: 'START_TIMER',
  STOP_TIMER: 'STOP_TIMER',
  UPSERT_ENTRY: 'UPSERT_ENTRY',
  DELETE_ENTRY: 'DELETE_ENTRY',
  ADD_ACTIVITY: 'ADD_ACTIVITY',
  DELETE_ACTIVITY: 'DELETE_ACTIVITY',
  RECORD_ACTIVITY_USE: 'RECORD_ACTIVITY_USE',
  SET_CATEGORIES: 'SET_CATEGORIES',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_NOTICE: 'SET_NOTICE',
  CLEAR_NOTICE: 'CLEAR_NOTICE',
  RESTORE_DATA: 'RESTORE_DATA',
  CLEAR_ALL: 'CLEAR_ALL',
  SET_AUTH_USER: 'SET_AUTH_USER',
  CLEAR_AUTH_USER: 'CLEAR_AUTH_USER',
});

/**
 * Pure reducer function for all application state transitions.
 * Pure function: (state, action) -> nextState
 */
export function appReducer(state, action) {
  switch (action.type) {
    case ACTION_TYPES.SET_TAB:
      return {
        ...state,
        tab: action.payload,
        modal: null,
        editingEntryId: null,
        error: null,
      };

    case ACTION_TYPES.SET_PERIOD:
      return {
        ...state,
        period: action.payload,
      };

    case ACTION_TYPES.SET_SHORTCUT_CATEGORY_FILTER:
      return {
        ...state,
        shortcutCategoryFilter: action.payload || 'all',
      };

    case ACTION_TYPES.SET_MODAL:
      return {
        ...state,
        modal: action.payload,
        error: null,
      };

    case ACTION_TYPES.CLOSE_MODAL:
      return {
        ...state,
        modal: null,
        error: null,
      };

    case ACTION_TYPES.SET_EDITING_ENTRY:
      return {
        ...state,
        editingEntryId: action.payload,
      };

    case ACTION_TYPES.START_TIMER: {
      const { activity, categoryId, date, startTime, startTs = Date.now() } = action.payload;
      const timer = createActiveTimer({
        activity,
        categoryId,
        date: date || today(),
        startTime: startTime || formatCurrentClock(),
        startTs,
      });
      return {
        ...state,
        activeTimer: timer,
        error: null,
      };
    }

    case ACTION_TYPES.STOP_TIMER: {
      if (!state.activeTimer) return state;
      const t = state.activeTimer;
      const end = action.payload?.end || formatCurrentClock();
      const durationMinutes = elapsedMinutes(t);
      const entry = createTimeEntry({
        id: crypto.randomUUID(),
        activity: t.activity,
        categoryId: t.categoryId ?? t.cat ?? null,
        date: t.date,
        start: t.startTime,
        end,
        endDate: t.date === today() ? t.date : today(),
        mins: durationMinutes,
        viaTimer: true,
      });

      // Update or record the activity usage metadata
      const nextActivities = updateActivityUsage(
        state.activities,
        t.activity,
        t.categoryId,
        durationMinutes
      );

      return {
        ...state,
        activeTimer: null,
        entries: [entry, ...state.entries],
        activities: nextActivities,
        error: null,
      };
    }

    case ACTION_TYPES.UPSERT_ENTRY: {
      const entry = action.payload;
      const existingIdx = state.entries.findIndex(e => e.id === entry.id);
      const nextEntries = existingIdx >= 0
        ? state.entries.map((e, idx) => (idx === existingIdx ? entry : e))
        : [entry, ...state.entries];

      // Update or record activity usage
      const nextActivities = updateActivityUsage(
        state.activities,
        entry.activity,
        entry.categoryId,
        entry.mins
      );

      return {
        ...state,
        entries: nextEntries,
        activities: nextActivities,
        editingEntryId: null,
        error: null,
      };
    }

    case ACTION_TYPES.DELETE_ENTRY:
      return {
        ...state,
        entries: state.entries.filter(e => e.id !== action.payload),
        editingEntryId: state.editingEntryId === action.payload ? null : state.editingEntryId,
      };

    case ACTION_TYPES.ADD_ACTIVITY: {
      const { id = crypto.randomUUID(), label, categoryId = null } = action.payload;
      const newActivity = {
        id,
        label: String(label).trim(),
        categoryId,
        useCount: 1,
        lastUsedAt: new Date().toISOString(),
        avgDurationMins: null,
      };
      return {
        ...state,
        activities: [...state.activities.filter(a => (a.label || a.activity) !== newActivity.label), newActivity],
      };
    }

    case ACTION_TYPES.DELETE_ACTIVITY:
      return {
        ...state,
        activities: state.activities.filter(a => a.id !== action.payload),
      };

    case ACTION_TYPES.SET_CATEGORIES:
      return {
        ...state,
        categories: action.payload,
      };

    case ACTION_TYPES.SET_ERROR:
      return {
        ...state,
        error: action.payload,
      };

    case ACTION_TYPES.CLEAR_ERROR:
      return {
        ...state,
        error: null,
      };

    case ACTION_TYPES.SET_NOTICE:
      return {
        ...state,
        notice: action.payload,
      };

    case ACTION_TYPES.CLEAR_NOTICE:
      return {
        ...state,
        notice: null,
      };

    case ACTION_TYPES.RESTORE_DATA: {
      const { entries, activities, categories } = action.payload;
      return {
        ...state,
        entries: Array.isArray(entries) ? entries : state.entries,
        activities: Array.isArray(activities) ? activities : state.activities,
        categories: Array.isArray(categories) ? categories : state.categories,
        editingEntryId: null,
        modal: null,
        error: null,
      };
    }

    case ACTION_TYPES.CLEAR_ALL:
      return {
        ...state,
        entries: [],
        activities: [],
        categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
        activeTimer: null,
        editingEntryId: null,
        modal: null,
        error: null,
        tab: 'entry',
      };

    case ACTION_TYPES.SET_AUTH_USER:
      return {
        ...state,
        authUser: action.payload || null,
        error: null,
      };

    case ACTION_TYPES.CLEAR_AUTH_USER:
      return {
        ...state,
        authUser: null,
        error: null,
      };

    default:
      return state;
  }
}

/**
 * Helper to update activity usage metadata in pure functional style.
 */
function updateActivityUsage(activities = [], activityName, categoryId, durationMins) {
  const name = String(activityName || '').trim();
  if (!name) return activities;
  const key = name.toLowerCase();

  const existingIdx = activities.findIndex(
    a => String(a.label || a.activity || a.name || '').trim().toLowerCase() === key
  );

  const nowIso = new Date().toISOString();

  if (existingIdx >= 0) {
    return activities.map((a, idx) => {
      if (idx !== existingIdx) return a;
      const count = (Number(a.useCount) || 0) + 1;
      const prevAvg = Number(a.avgDurationMins) || durationMins;
      const newAvg = Number.isFinite(durationMins) && durationMins > 0
        ? Math.round((prevAvg * (count - 1) + durationMins) / count)
        : prevAvg;

      return {
        ...a,
        categoryId: categoryId || a.categoryId || null,
        useCount: count,
        lastUsedAt: nowIso,
        avgDurationMins: newAvg,
      };
    });
  }

  // Activity not yet saved in list: we keep the list as is (user saves explicitly or via auto-discovery)
  return activities;
}

function formatCurrentClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Creates the reactive StateManager instance.
 */
export function createStateManager({ initialState, persistFn, onError } = {}) {
  let currentState = {
    entries: [],
    activities: [],
    categories: [...DEFAULT_CATEGORIES],
    activeTimer: null,
    tab: 'entry',
    period: '7',
    shortcutCategoryFilter: 'all',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    authUser: null,
    ...initialState,
  };

  const listeners = new Set();

  function notify() {
    listeners.forEach(fn => fn(currentState));
  }

  async function persistIfChanged(prevState, nextState) {
    if (
      prevState.entries !== nextState.entries ||
      prevState.activities !== nextState.activities ||
      prevState.categories !== nextState.categories ||
      prevState.activeTimer !== nextState.activeTimer
    ) {
      if (typeof persistFn === 'function') {
        try {
          await persistFn(nextState);
        } catch (err) {
          if (typeof onError === 'function') {
            onError(err);
          }
        }
      }
    }
  }

  function dispatch(action) {
    const prevState = currentState;
    currentState = appReducer(currentState, action);
    notify();
    persistIfChanged(prevState, currentState);
    return currentState;
  }

  return {
    getState() {
      return currentState;
    },

    dispatch,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Convenient action dispatchers
    actions: {
      setTab(tab) {
        return dispatch({ type: ACTION_TYPES.SET_TAB, payload: tab });
      },
      setPeriod(period) {
        return dispatch({ type: ACTION_TYPES.SET_PERIOD, payload: period });
      },
      setShortcutCategoryFilter(filterKey) {
        return dispatch({ type: ACTION_TYPES.SET_SHORTCUT_CATEGORY_FILTER, payload: filterKey });
      },
      startTimer(payload) {
        return dispatch({ type: ACTION_TYPES.START_TIMER, payload });
      },
      stopTimer(payload) {
        return dispatch({ type: ACTION_TYPES.STOP_TIMER, payload });
      },
      upsertEntry(entry) {
        return dispatch({ type: ACTION_TYPES.UPSERT_ENTRY, payload: entry });
      },
      deleteEntry(id) {
        return dispatch({ type: ACTION_TYPES.DELETE_ENTRY, payload: id });
      },
      addActivity(activity) {
        return dispatch({ type: ACTION_TYPES.ADD_ACTIVITY, payload: activity });
      },
      deleteActivity(id) {
        return dispatch({ type: ACTION_TYPES.DELETE_ACTIVITY, payload: id });
      },
      setCategories(categories) {
        return dispatch({ type: ACTION_TYPES.SET_CATEGORIES, payload: categories });
      },
      setModal(modal) {
        return dispatch({ type: ACTION_TYPES.SET_MODAL, payload: modal });
      },
      closeModal() {
        return dispatch({ type: ACTION_TYPES.CLOSE_MODAL });
      },
      setError(error) {
        return dispatch({ type: ACTION_TYPES.SET_ERROR, payload: error });
      },
      clearError() {
        return dispatch({ type: ACTION_TYPES.CLEAR_ERROR });
      },
      setNotice(notice) {
        return dispatch({ type: ACTION_TYPES.SET_NOTICE, payload: notice });
      },
      clearNotice() {
        return dispatch({ type: ACTION_TYPES.CLEAR_NOTICE });
      },
      setAuthUser(user) {
        return dispatch({ type: ACTION_TYPES.SET_AUTH_USER, payload: user });
      },
      clearAuthUser() {
        return dispatch({ type: ACTION_TYPES.CLEAR_AUTH_USER });
      },
    },
  };
}
