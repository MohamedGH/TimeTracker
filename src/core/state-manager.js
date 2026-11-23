/**
 * State Manager — Functional, reactive state container for TimeTracker.
 * Uses pure reducer logic for deterministic state updates and reactive subscriptions.
 */

import { DEFAULT_CATEGORIES } from './model.js';
import { createTimeEntry } from './time-entry.js';
import { createActiveTimer, elapsedMinutes } from './timer.js';
import { today } from './time.js';
import { createDefaultQuickTilesConfig } from './mobile/quick-tiles.js';
import { normalizeLocation, stripEntryGeoLocations } from './geo/geo-location.js';
import { mergeCategoriesState } from '../state/category-actions.js';
import { mergeActivitiesState } from '../state/activity-actions.js';
import {
  saveActivityTemplate,
  deleteActivityTemplate,
  recordTemplateUse,
  startTemplateRun,
  advanceTemplateRun,
  pauseTemplateRunAfterManualStop,
  resumeReadyTemplateRun,
  reassignCategoryInTemplates,
  reassignActivityInTemplates,
  buildEntriesFromTemplate,
} from '../state/template-actions.js';

export const ACTION_TYPES = Object.freeze({
  SET_TAB: 'SET_TAB',
  SET_PERIOD: 'SET_PERIOD',
  SET_SHORTCUT_CATEGORY_FILTER: 'SET_SHORTCUT_CATEGORY_FILTER',
  SET_DEVICE_TYPE: 'SET_DEVICE_TYPE',
  SET_MODAL: 'SET_MODAL',
  CLOSE_MODAL: 'CLOSE_MODAL',
  SET_EDITING_ENTRY: 'SET_EDITING_ENTRY',
  START_TIMER: 'START_TIMER',
  STOP_TIMER: 'STOP_TIMER',
  SET_GEO_TRACKING: 'SET_GEO_TRACKING',
  SET_ACTIVE_TIMER_LOCATION: 'SET_ACTIVE_TIMER_LOCATION',
  PATCH_ENTRY_LOCATION: 'PATCH_ENTRY_LOCATION',
  CLEAR_ALL_GEO_LOCATIONS: 'CLEAR_ALL_GEO_LOCATIONS',
  SET_QUICK_TILES_CONFIG: 'SET_QUICK_TILES_CONFIG',
  RECONCILE_NATIVE_TIMER: 'RECONCILE_NATIVE_TIMER',
  UPSERT_ENTRY: 'UPSERT_ENTRY',
  DELETE_ENTRY: 'DELETE_ENTRY',
  ADD_ACTIVITY: 'ADD_ACTIVITY',
  DELETE_ACTIVITY: 'DELETE_ACTIVITY',
  RECORD_ACTIVITY_USE: 'RECORD_ACTIVITY_USE',
  SET_CATEGORIES: 'SET_CATEGORIES',
  MERGE_CATEGORIES: 'MERGE_CATEGORIES',
  MERGE_ACTIVITIES: 'MERGE_ACTIVITIES',
  SAVE_TEMPLATE: 'SAVE_TEMPLATE',
  DELETE_TEMPLATE: 'DELETE_TEMPLATE',
  START_TEMPLATE_RUN: 'START_TEMPLATE_RUN',
  ADVANCE_TEMPLATE_RUN: 'ADVANCE_TEMPLATE_RUN',
  PAUSE_TEMPLATE_RUN: 'PAUSE_TEMPLATE_RUN',
  RESUME_TEMPLATE_RUN: 'RESUME_TEMPLATE_RUN',
  STOP_TEMPLATE_RUN: 'STOP_TEMPLATE_RUN',
  LOG_TEMPLATE_ENTRIES: 'LOG_TEMPLATE_ENTRIES',
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

    case ACTION_TYPES.SET_DEVICE_TYPE:
      return {
        ...state,
        deviceType: action.payload || 'desktop',
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
      const { activity, categoryId, date, startTime, startTs = Date.now(), updatedAt, startLocation = null, location = null } = action.payload;
      const timer = createActiveTimer({
        activity,
        categoryId,
        date: date || today(),
        startTime: startTime || formatCurrentClock(),
        startTs,
        startLocation: startLocation ?? location,
      });
      return {
        ...state,
        activeTimer: timer,
        timerUpdatedAt: Number.isFinite(Number(updatedAt)) ? Number(updatedAt) : startTs,
        error: null,
      };
    }

    case ACTION_TYPES.STOP_TIMER: {
      if (!state.activeTimer) return state;
      const t = state.activeTimer;
      const end = action.payload?.end || formatCurrentClock();
      const durationMinutes = elapsedMinutes(t);
      const entry = createTimeEntry({
        id: action.payload?.entryId || crypto.randomUUID(),
        activity: t.activity,
        categoryId: t.categoryId ?? t.cat ?? null,
        date: t.date,
        start: t.startTime,
        end,
        endDate: t.date === today() ? t.date : today(),
        mins: durationMinutes,
        viaTimer: true,
        startLocation: t.startLocation ?? t.location ?? null,
        endLocation: action.payload?.endLocation ?? action.payload?.location ?? null,
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
        timerUpdatedAt: Number.isFinite(Number(action.payload?.updatedAt))
          ? Number(action.payload.updatedAt)
          : Date.now(),
        entries: [entry, ...state.entries],
        activities: nextActivities,
        error: null,
      };
    }

    case ACTION_TYPES.SET_GEO_TRACKING:
      return {
        ...state,
        geoTrackingEnabled: Boolean(action.payload),
      };

    case ACTION_TYPES.SET_ACTIVE_TIMER_LOCATION: {
      if (!state.activeTimer) return state;
      const { startTs, startLocation, location } = action.payload || {};
      if (startTs !== undefined && state.activeTimer.startTs !== startTs) return state;
      const normalized = normalizeLocation(startLocation ?? location);
      if (!normalized) return state;
      return {
        ...state,
        activeTimer: {
          ...state.activeTimer,
          startLocation: normalized,
        },
      };
    }

    case ACTION_TYPES.PATCH_ENTRY_LOCATION: {
      const { entryId, startLocation, endLocation } = action.payload || {};
      if (!entryId) return state;
      let changed = false;
      const nextEntries = state.entries.map((entry) => {
        if (entry.id !== entryId) return entry;
        changed = true;
        const updated = { ...entry };
        if (startLocation !== undefined) {
          const normStart = normalizeLocation(startLocation);
          delete updated.location;
          if (normStart) updated.startLocation = normStart;
          else delete updated.startLocation;
        }
        if (endLocation !== undefined) {
          const normEnd = normalizeLocation(endLocation);
          if (normEnd) updated.endLocation = normEnd;
          else delete updated.endLocation;
        }
        return updated;
      });
      return changed ? { ...state, entries: nextEntries } : state;
    }

    case ACTION_TYPES.CLEAR_ALL_GEO_LOCATIONS: {
      const nextEntries = state.entries.map(stripEntryGeoLocations);
      const nextTimer = state.activeTimer
        ? (() => {
            const { startLocation: _s, location: _l, ...rest } = state.activeTimer;
            return rest;
          })()
        : null;
      return {
        ...state,
        entries: nextEntries,
        activeTimer: nextTimer,
      };
    }

    case ACTION_TYPES.SET_QUICK_TILES_CONFIG:
      return {
        ...state,
        quickTilesConfig: action.payload || createDefaultQuickTilesConfig(),
      };

    case ACTION_TYPES.RECONCILE_NATIVE_TIMER: {
      const next = action.payload || {};
      return {
        ...state,
        entries: Array.isArray(next.entries) ? next.entries : state.entries,
        activities: Array.isArray(next.activities) ? next.activities : state.activities,
        activeTimer: next.activeTimer !== undefined ? next.activeTimer : state.activeTimer,
        timerUpdatedAt: Number.isFinite(Number(next.timerUpdatedAt))
          ? Number(next.timerUpdatedAt)
          : state.timerUpdatedAt,
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

    case ACTION_TYPES.MERGE_CATEGORIES: {
      const merged = mergeCategoriesState(
        {
          categories: state.categories,
          entries: state.entries,
          activities: state.activities,
          activeTimer: state.activeTimer,
          quickTilesConfig: state.quickTilesConfig,
        },
        action.payload || {}
      );
      const nextTemplates = reassignCategoryInTemplates(
        state.activityTemplates,
        action.payload?.sourceId,
        action.payload?.targetId
      );
      return {
        ...state,
        categories: merged.categories,
        entries: merged.entries,
        activities: merged.activities,
        activityTemplates: nextTemplates,
        activeTimer: merged.activeTimer,
        quickTilesConfig: merged.quickTilesConfig ?? state.quickTilesConfig,
        timerUpdatedAt: merged.summary.affectsActiveTimer
          ? Math.max(Date.now(), (Number(state.timerUpdatedAt) || 0) + 1)
          : state.timerUpdatedAt,
        modal: null,
        error: null,
      };
    }

    case ACTION_TYPES.MERGE_ACTIVITIES: {
      const merged = mergeActivitiesState(
        {
          activities: state.activities,
          entries: state.entries,
          activeTimer: state.activeTimer,
          quickTilesConfig: state.quickTilesConfig,
          categories: state.categories,
        },
        action.payload || {}
      );
      const nextTemplates = reassignActivityInTemplates(
        state.activityTemplates,
        { label: merged.summary.sourceLabel, categoryId: merged.summary.sourceCategoryId },
        { label: merged.summary.targetLabel, categoryId: merged.summary.targetCategoryId }
      );
      return {
        ...state,
        activities: merged.activities,
        entries: merged.entries,
        activityTemplates: nextTemplates,
        activeTimer: merged.activeTimer,
        quickTilesConfig: merged.quickTilesConfig ?? state.quickTilesConfig,
        timerUpdatedAt: merged.summary.affectsActiveTimer
          ? Math.max(Date.now(), (Number(state.timerUpdatedAt) || 0) + 1)
          : state.timerUpdatedAt,
        modal: null,
        error: null,
      };
    }

    case ACTION_TYPES.SAVE_TEMPLATE: {
      const result = saveActivityTemplate(
        state.activityTemplates || [],
        action.payload || {},
        state.categories
      );
      return {
        ...state,
        activityTemplates: result.templates,
        modal: null,
        error: null,
      };
    }

    case ACTION_TYPES.DELETE_TEMPLATE:
      return {
        ...state,
        activityTemplates: deleteActivityTemplate(state.activityTemplates || [], action.payload),
      };

    case ACTION_TYPES.START_TEMPLATE_RUN: {
      const { template, date = today(), startTime = formatCurrentClock(), startTs = Date.now(), startLocation = null, location = null } = action.payload || {};
      const { run, firstStep } = startTemplateRun(template, { startedAt: new Date(startTs).toISOString() });
      const timer = createActiveTimer({
        activity: firstStep.activity,
        categoryId: firstStep.categoryId,
        date,
        startTime,
        startTs,
        startLocation: startLocation ?? location,
      });
      return {
        ...state,
        activeTimer: timer,
        timerUpdatedAt: startTs,
        activeTemplateRun: run,
        activityTemplates: recordTemplateUse(state.activityTemplates || [], template.id, startTs),
        error: null,
      };
    }

    case ACTION_TYPES.ADVANCE_TEMPLATE_RUN: {
      const { recordCurrent = true, end, startTime = formatCurrentClock(), date = today(), nowTs = Date.now(), startLocation = null, endLocation = null, location = null } = action.payload || {};
      let nextEntries = state.entries;
      let nextActivities = state.activities;

      if (recordCurrent && state.activeTimer) {
        const t = state.activeTimer;
        const durationMinutes = elapsedMinutes(t, nowTs);
        const entry = createTimeEntry({
          id: crypto.randomUUID(),
          activity: t.activity,
          categoryId: t.categoryId ?? t.cat ?? null,
          date: t.date,
          start: t.startTime,
          end: end || formatCurrentClock(),
          endDate: t.date === date ? t.date : date,
          mins: durationMinutes,
          viaTimer: true,
          startLocation: t.startLocation ?? t.location ?? null,
          endLocation,
        });
        nextEntries = [entry, ...state.entries];
        nextActivities = updateActivityUsage(state.activities, t.activity, t.categoryId, durationMinutes);
      }

      const transition = advanceTemplateRun(state.activeTemplateRun, { recordedStep: recordCurrent });
      const nextTimer = !transition.completed && transition.nextStep
        ? createActiveTimer({
            activity: transition.nextStep.activity,
            categoryId: transition.nextStep.categoryId,
            date,
            startTime,
            startTs: nowTs,
            startLocation: startLocation ?? location,
          })
        : null;

      return {
        ...state,
        entries: nextEntries,
        activities: nextActivities,
        activeTimer: nextTimer,
        timerUpdatedAt: nowTs,
        activeTemplateRun: transition.nextRun,
        error: null,
      };
    }

    case ACTION_TYPES.PAUSE_TEMPLATE_RUN: {
      if (!state.activeTemplateRun) return state;
      return {
        ...state,
        activeTemplateRun: pauseTemplateRunAfterManualStop(state.activeTemplateRun),
      };
    }

    case ACTION_TYPES.RESUME_TEMPLATE_RUN: {
      const resumed = resumeReadyTemplateRun(state.activeTemplateRun);
      if (!resumed) return state;
      const { date = today(), startTime = formatCurrentClock(), startTs = Date.now(), startLocation = null, location = null } = action.payload || {};
      const timer = createActiveTimer({
        activity: resumed.currentStep.activity,
        categoryId: resumed.currentStep.categoryId,
        date,
        startTime,
        startTs,
        startLocation: startLocation ?? location,
      });
      return {
        ...state,
        activeTimer: timer,
        timerUpdatedAt: startTs,
        activeTemplateRun: resumed.nextRun,
        error: null,
      };
    }

    case ACTION_TYPES.STOP_TEMPLATE_RUN:
      return {
        ...state,
        activeTemplateRun: null,
      };

    case ACTION_TYPES.LOG_TEMPLATE_ENTRIES: {
      const { template, date = today(), startTime = '08:00', fallbackMins = 15 } = action.payload || {};
      const built = buildEntriesFromTemplate(template, { date, startTime, fallbackMins });
      let nextActivities = state.activities;
      for (const entry of built) {
        nextActivities = updateActivityUsage(nextActivities, entry.activity, entry.categoryId, entry.mins);
      }
      return {
        ...state,
        entries: [...built.slice().reverse(), ...state.entries],
        activities: nextActivities,
        activityTemplates: recordTemplateUse(state.activityTemplates || [], template.id),
        modal: null,
        error: null,
      };
    }

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
      const { entries, activities, categories, activityTemplates } = action.payload;
      return {
        ...state,
        entries: Array.isArray(entries) ? entries : state.entries,
        activities: Array.isArray(activities) ? activities : state.activities,
        categories: Array.isArray(categories) ? categories : state.categories,
        activityTemplates: Array.isArray(activityTemplates) ? activityTemplates : state.activityTemplates,
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
        activityTemplates: [],
        activeTemplateRun: null,
        activeTimer: null,
        geoTrackingEnabled: false,
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
    activityTemplates: [],
    activeTemplateRun: null,
    activeTimer: null,
    timerUpdatedAt: 0,
    geoTrackingEnabled: false,
    quickTilesConfig: createDefaultQuickTilesConfig(),
    tab: 'entry',
    period: '7',
    shortcutCategoryFilter: 'all',
    deviceType: 'mobile',
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
      prevState.activityTemplates !== nextState.activityTemplates ||
      prevState.activeTemplateRun !== nextState.activeTemplateRun ||
      prevState.activeTimer !== nextState.activeTimer ||
      prevState.quickTilesConfig !== nextState.quickTilesConfig ||
      prevState.geoTrackingEnabled !== nextState.geoTrackingEnabled ||
      prevState.timerUpdatedAt !== nextState.timerUpdatedAt
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
      setDeviceType(deviceType) {
        return dispatch({ type: ACTION_TYPES.SET_DEVICE_TYPE, payload: deviceType });
      },
      startTimer(payload) {
        return dispatch({ type: ACTION_TYPES.START_TIMER, payload });
      },
      stopTimer(payload) {
        return dispatch({ type: ACTION_TYPES.STOP_TIMER, payload });
      },
      setGeoTracking(enabled) {
        return dispatch({ type: ACTION_TYPES.SET_GEO_TRACKING, payload: enabled });
      },
      setActiveTimerLocation(payload) {
        return dispatch({ type: ACTION_TYPES.SET_ACTIVE_TIMER_LOCATION, payload });
      },
      patchEntryLocation(payload) {
        return dispatch({ type: ACTION_TYPES.PATCH_ENTRY_LOCATION, payload });
      },
      clearAllGeoLocations() {
        return dispatch({ type: ACTION_TYPES.CLEAR_ALL_GEO_LOCATIONS });
      },
      setQuickTilesConfig(config) {
        return dispatch({ type: ACTION_TYPES.SET_QUICK_TILES_CONFIG, payload: config });
      },
      reconcileNativeTimer(reconciled) {
        return dispatch({ type: ACTION_TYPES.RECONCILE_NATIVE_TIMER, payload: reconciled });
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
      mergeCategories({ sourceId, targetId }) {
        return dispatch({ type: ACTION_TYPES.MERGE_CATEGORIES, payload: { sourceId, targetId } });
      },
      mergeActivities({ source, target }) {
        return dispatch({ type: ACTION_TYPES.MERGE_ACTIVITIES, payload: { source, target } });
      },
      saveTemplate(payload) {
        return dispatch({ type: ACTION_TYPES.SAVE_TEMPLATE, payload });
      },
      deleteTemplate(templateId) {
        return dispatch({ type: ACTION_TYPES.DELETE_TEMPLATE, payload: templateId });
      },
      startTemplateRun(payload) {
        return dispatch({ type: ACTION_TYPES.START_TEMPLATE_RUN, payload });
      },
      advanceTemplateRun(payload) {
        return dispatch({ type: ACTION_TYPES.ADVANCE_TEMPLATE_RUN, payload });
      },
      pauseTemplateRun() {
        return dispatch({ type: ACTION_TYPES.PAUSE_TEMPLATE_RUN });
      },
      resumeTemplateRun(payload) {
        return dispatch({ type: ACTION_TYPES.RESUME_TEMPLATE_RUN, payload });
      },
      stopTemplateRun() {
        return dispatch({ type: ACTION_TYPES.STOP_TEMPLATE_RUN });
      },
      logTemplateEntries(payload) {
        return dispatch({ type: ACTION_TYPES.LOG_TEMPLATE_ENTRIES, payload });
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
