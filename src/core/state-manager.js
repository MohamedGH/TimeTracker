/**
 * State Manager — Functional, reactive state container for TimeTracker.
 * Uses pure reducer logic for deterministic state updates and reactive subscriptions.
 */

import { DEFAULT_CATEGORIES } from './model.js';
import { createTimeEntry } from './time-entry.js';
import { createActiveTimer, createTimerState, elapsedMinutes } from './timer.js';
import { today } from './time.js';
import { createDefaultQuickTilesConfig } from './mobile/quick-tiles.js';
import { normalizeLocation, stripEntryGeoLocations } from './geo/geo-location.js';
import { mergeCategoriesState } from '../state/category-actions.js';
import { mergeActivitiesState, findSavedActivityMatch } from '../state/activity-actions.js';
import { splitTimeEntryState } from '../state/entry-actions.js';
import {
  startAsyncTimerInList,
  stopAsyncTimerInList,
  discardAsyncTimerInList,
  demoteActiveTimerToAsync,
  promoteAsyncTimerToActive,
  updateAsyncTimerTargetInList,
} from '../state/async-timer-actions.js';
import {
  createHistoryManager,
  applyUndoableSnapshot,
} from './history-manager.js';
import {
  saveActivityTemplate,
  deleteActivityTemplate,
  recordTemplateUse,
  startTemplateRun,
  advanceTemplateRun,
  pauseTemplateRunAfterManualStop,
  resumeReadyTemplateRun,
  skipReadyTemplateStep,
  skipUpcomingTemplateStep,
  reorderTemplateRunSteps,
  swapCurrentTemplateStep,
  reassignCategoryInTemplates,
  reassignActivityInTemplates,
  buildEntriesFromTemplate,
} from '../state/template-actions.js';
import {
  TRASH_ITEM_KINDS,
  createTrashRecord,
  pushTrashRecord,
  removeTrashRecord,
  restoreTrashRecord,
} from './trash-manager.js';
import {
  DEFAULT_UI_STATE,
  normalizeUiState,
  mergeUiState,
} from './ui-state.js';

export const ACTION_TYPES = Object.freeze({
  SET_TAB: 'SET_TAB',
  SET_PERIOD: 'SET_PERIOD',
  SET_SHORTCUT_CATEGORY_FILTER: 'SET_SHORTCUT_CATEGORY_FILTER',
  SET_UI_STATE: 'SET_UI_STATE',
  SET_DEVICE_TYPE: 'SET_DEVICE_TYPE',
  SET_MODAL: 'SET_MODAL',
  CLOSE_MODAL: 'CLOSE_MODAL',
  SET_EDITING_ENTRY: 'SET_EDITING_ENTRY',
  START_TIMER: 'START_TIMER',
  STOP_TIMER: 'STOP_TIMER',
  START_ASYNC_TIMER: 'START_ASYNC_TIMER',
  STOP_ASYNC_TIMER: 'STOP_ASYNC_TIMER',
  DISCARD_ASYNC_TIMER: 'DISCARD_ASYNC_TIMER',
  DEMOTE_ACTIVE_TIMER_TO_ASYNC: 'DEMOTE_ACTIVE_TIMER_TO_ASYNC',
  PROMOTE_ASYNC_TIMER_TO_ACTIVE: 'PROMOTE_ASYNC_TIMER_TO_ACTIVE',
  UPDATE_ASYNC_TIMER_TARGET: 'UPDATE_ASYNC_TIMER_TARGET',
  SET_GEO_TRACKING: 'SET_GEO_TRACKING',
  SET_ACTIVE_TIMER_LOCATION: 'SET_ACTIVE_TIMER_LOCATION',
  PATCH_ENTRY_LOCATION: 'PATCH_ENTRY_LOCATION',
  CLEAR_ALL_GEO_LOCATIONS: 'CLEAR_ALL_GEO_LOCATIONS',
  SET_QUICK_TILES_CONFIG: 'SET_QUICK_TILES_CONFIG',
  RECONCILE_NATIVE_TIMER: 'RECONCILE_NATIVE_TIMER',
  UPSERT_ENTRY: 'UPSERT_ENTRY',
  SPLIT_ENTRY: 'SPLIT_ENTRY',
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
  SKIP_READY_TEMPLATE_STEP: 'SKIP_READY_TEMPLATE_STEP',
  SKIP_UPCOMING_TEMPLATE_STEP: 'SKIP_UPCOMING_TEMPLATE_STEP',
  REORDER_TEMPLATE_RUN_STEPS: 'REORDER_TEMPLATE_RUN_STEPS',
  SWAP_CURRENT_TEMPLATE_STEP: 'SWAP_CURRENT_TEMPLATE_STEP',
  STOP_TEMPLATE_RUN: 'STOP_TEMPLATE_RUN',
  LOG_TEMPLATE_ENTRIES: 'LOG_TEMPLATE_ENTRIES',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_NOTICE: 'SET_NOTICE',
  CLEAR_NOTICE: 'CLEAR_NOTICE',
  PUSH_TRASH_RECORD: 'PUSH_TRASH_RECORD',
  RESTORE_DELETED_ITEM: 'RESTORE_DELETED_ITEM',
  RESTORE_LAST_DELETED: 'RESTORE_LAST_DELETED',
  PURGE_TRASH_ITEM: 'PURGE_TRASH_ITEM',
  EMPTY_TRASH: 'EMPTY_TRASH',
  RESTORE_DATA: 'RESTORE_DATA',
  CLEAR_ALL: 'CLEAR_ALL',
  SET_AUTH_USER: 'SET_AUTH_USER',
  CLEAR_AUTH_USER: 'CLEAR_AUTH_USER',
  UNDO: 'UNDO',
  REDO: 'REDO',
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
        uiState: mergeUiState(state.uiState, { tab: action.payload }),
        modal: null,
        editingEntryId: null,
        error: null,
      };

    case ACTION_TYPES.SET_PERIOD:
      return {
        ...state,
        period: action.payload,
        uiState: mergeUiState(state.uiState, { period: action.payload }),
      };

    case ACTION_TYPES.SET_SHORTCUT_CATEGORY_FILTER: {
      const nextFilter = action.payload || 'all';
      return {
        ...state,
        shortcutCategoryFilter: nextFilter,
        uiState: mergeUiState(state.uiState, { shortcutCategoryFilter: nextFilter }),
      };
    }

    case ACTION_TYPES.SET_UI_STATE: {
      const nextUiState = mergeUiState(state.uiState, action.payload);
      return {
        ...state,
        tab: nextUiState.tab,
        period: nextUiState.period,
        customStart: nextUiState.customStart,
        customEnd: nextUiState.customEnd,
        shortcutCategoryFilter: nextUiState.shortcutCategoryFilter,
        uiState: nextUiState,
      };
    }

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
      const {
        activity,
        categoryId,
        date,
        startTime,
        startTs = Date.now(),
        updatedAt,
        startLocation = null,
        location = null,
        content,
        startContent,
        endContent,
      } = action.payload;
      const savedMatch = findSavedActivityMatch(state.activities, { label: activity, categoryId });
      const resolvedContent = typeof content === 'string'
        ? content
        : (savedMatch?.content || '');
      const resolvedStartContent = typeof startContent === 'string'
        ? startContent
        : (savedMatch?.startContent || '');
      const resolvedEndContent = typeof endContent === 'string'
        ? endContent
        : (savedMatch?.endContent || '');
      const timer = createActiveTimer({
        activity,
        categoryId,
        date: date || today(),
        startTime: startTime || formatCurrentClock(),
        startTs,
        startLocation: startLocation ?? location,
        content: resolvedContent,
        startContent: resolvedStartContent,
        endContent: resolvedEndContent,
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
        content: action.payload?.content ?? t.content ?? '',
        startContent: action.payload?.startContent ?? t.startContent ?? '',
        endContent: action.payload?.endContent ?? t.endContent ?? '',
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

    case ACTION_TYPES.START_ASYNC_TIMER: {
      const {
        id,
        activity,
        categoryId,
        date,
        startTime,
        startTs = Date.now(),
        targetMins = null,
        startLocation = null,
        location = null,
        content,
        startContent,
        endContent,
      } = action.payload || {};
      const savedMatch = findSavedActivityMatch(state.activities, { label: activity, categoryId });
      const resolvedContent = typeof content === 'string'
        ? content
        : (savedMatch?.content || '');
      const resolvedStartContent = typeof startContent === 'string'
        ? startContent
        : (savedMatch?.startContent || '');
      const resolvedEndContent = typeof endContent === 'string'
        ? endContent
        : (savedMatch?.endContent || '');
      const resolvedTargetMins = targetMins !== undefined && targetMins !== null
        ? targetMins
        : (savedMatch?.defaultTargetMins ?? null);

      const { timers } = startAsyncTimerInList(state.activeAsyncTimers || [], {
        id,
        activity,
        categoryId,
        date: date || today(),
        startTime: startTime || formatCurrentClock(),
        startTs,
        targetMins: resolvedTargetMins,
        startLocation: startLocation ?? location,
        content: resolvedContent,
        startContent: resolvedStartContent,
        endContent: resolvedEndContent,
      });

      return {
        ...state,
        activeAsyncTimers: timers,
        error: null,
      };
    }

    case ACTION_TYPES.STOP_ASYNC_TIMER: {
      const {
        timerId,
        nowTs = Date.now(),
        endTime = formatCurrentClock(),
        endDate = today(),
        entryId,
        endLocation = null,
      } = action.payload || {};
      const result = stopAsyncTimerInList(state.activeAsyncTimers || [], timerId, {
        nowTs,
        endTime,
        endDate,
        entryId,
        endLocation,
      });
      if (!result.stoppedTimer || !result.entry) return state;

      const nextActivities = updateActivityUsage(
        state.activities,
        result.entry.activity,
        result.entry.categoryId,
        result.durationMinutes
      );

      return {
        ...state,
        activeAsyncTimers: result.timers,
        entries: [result.entry, ...state.entries],
        activities: nextActivities,
        error: null,
      };
    }

    case ACTION_TYPES.DISCARD_ASYNC_TIMER: {
      const { timerId } = action.payload || {};
      const { timers, discardedTimer } = discardAsyncTimerInList(state.activeAsyncTimers || [], timerId);
      if (!discardedTimer) return state;
      return {
        ...state,
        activeAsyncTimers: timers,
        error: null,
      };
    }

    case ACTION_TYPES.DEMOTE_ACTIVE_TIMER_TO_ASYNC: {
      if (!state.activeTimer) return state;
      const { targetMins = null, id } = action.payload || {};
      const res = demoteActiveTimerToAsync(state.activeTimer, state.activeAsyncTimers || [], { targetMins, id });
      return {
        ...state,
        activeTimer: res.activeTimer,
        activeAsyncTimers: res.activeAsyncTimers,
        timerUpdatedAt: Date.now(),
        error: null,
      };
    }

    case ACTION_TYPES.PROMOTE_ASYNC_TIMER_TO_ACTIVE: {
      const { timerId } = action.payload || {};
      const res = promoteAsyncTimerToActive(state.activeTimer, state.activeAsyncTimers || [], timerId);
      if (!res.promotedTimer) return state;
      return {
        ...state,
        activeTimer: res.activeTimer,
        activeAsyncTimers: res.activeAsyncTimers,
        timerUpdatedAt: Date.now(),
        error: null,
      };
    }

    case ACTION_TYPES.UPDATE_ASYNC_TIMER_TARGET: {
      const { timerId, targetMins } = action.payload || {};
      const res = updateAsyncTimerTargetInList(state.activeAsyncTimers || [], timerId, targetMins);
      if (!res.updatedTimer) return state;
      return {
        ...state,
        activeAsyncTimers: res.timers,
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
      const nextActivities = Array.isArray(next.activities) ? next.activities : state.activities;
      let nextTimer = next.activeTimer !== undefined ? next.activeTimer : state.activeTimer;
      if (nextTimer) {
        const savedMatch = findSavedActivityMatch(nextActivities, {
          label: nextTimer.activity,
          categoryId: nextTimer.categoryId ?? nextTimer.cat ?? null,
        });
        if (savedMatch) {
          nextTimer = createTimerState({
            ...nextTimer,
            content: nextTimer.content || savedMatch.content || '',
            startContent: nextTimer.startContent || savedMatch.startContent || '',
            endContent: nextTimer.endContent || savedMatch.endContent || '',
          });
        }
      }
      return {
        ...state,
        entries: Array.isArray(next.entries) ? next.entries : state.entries,
        activities: nextActivities,
        activeTimer: nextTimer,
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

    case ACTION_TYPES.SPLIT_ENTRY: {
      const result = splitTimeEntryState(
        {
          entries: state.entries,
          activities: state.activities,
          activeTimer: state.activeTimer,
        },
        action.payload || {}
      );
      return {
        ...state,
        entries: result.entries,
        activities: result.activities,
        activeTimer: result.activeTimer,
        editingEntryId: state.editingEntryId === action.payload?.entryId ? null : state.editingEntryId,
        modal: null,
        error: null,
      };
    }

    case ACTION_TYPES.DELETE_ENTRY: {
      const target = state.entries.find(e => e.id === action.payload);
      const record = target ? createTrashRecord({ kind: TRASH_ITEM_KINDS.ENTRY, item: target }) : null;
      return {
        ...state,
        entries: state.entries.filter(e => e.id !== action.payload),
        deletedItems: record ? pushTrashRecord(state.deletedItems, record) : (state.deletedItems || []),
        editingEntryId: state.editingEntryId === action.payload ? null : state.editingEntryId,
      };
    }

    case ACTION_TYPES.ADD_ACTIVITY: {
      const {
        id = crypto.randomUUID(),
        label,
        categoryId = null,
        content = '',
        startContent = '',
        endContent = '',
      } = action.payload;
      const cleanContent = typeof content === 'string' ? content.trim() : '';
      const cleanStart = typeof startContent === 'string' ? startContent.trim() : '';
      const cleanEnd = typeof endContent === 'string' ? endContent.trim() : '';
      const newActivity = {
        id,
        label: String(label).trim(),
        categoryId,
        useCount: 1,
        lastUsedAt: new Date().toISOString(),
        avgDurationMins: null,
        ...(cleanContent ? { content: cleanContent } : {}),
        ...(cleanStart ? { startContent: cleanStart } : {}),
        ...(cleanEnd ? { endContent: cleanEnd } : {}),
      };
      return {
        ...state,
        activities: [...state.activities.filter(a => (a.label || a.activity) !== newActivity.label), newActivity],
      };
    }

    case ACTION_TYPES.DELETE_ACTIVITY: {
      const target = state.activities.find(a => a.id === action.payload);
      const record = target ? createTrashRecord({ kind: TRASH_ITEM_KINDS.ACTIVITY, item: target }) : null;
      return {
        ...state,
        activities: state.activities.filter(a => a.id !== action.payload),
        deletedItems: record ? pushTrashRecord(state.deletedItems, record) : (state.deletedItems || []),
      };
    }

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

    case ACTION_TYPES.DELETE_TEMPLATE: {
      const target = (state.activityTemplates || []).find(t => t.id === action.payload);
      const record = target ? createTrashRecord({ kind: TRASH_ITEM_KINDS.TEMPLATE, item: target }) : null;
      return {
        ...state,
        activityTemplates: deleteActivityTemplate(state.activityTemplates || [], action.payload),
        deletedItems: record ? pushTrashRecord(state.deletedItems, record) : (state.deletedItems || []),
      };
    }

    case ACTION_TYPES.START_TEMPLATE_RUN: {
      const { template, startIndex = 0, steps = null, date = today(), startTime = formatCurrentClock(), startTs = Date.now(), startLocation = null, location = null } = action.payload || {};
      const { run, firstStep } = startTemplateRun(template, { startedAt: new Date(startTs).toISOString(), startIndex, steps });
      const savedMatch = findSavedActivityMatch(state.activities, {
        label: firstStep.activity,
        categoryId: firstStep.categoryId,
      });
      const timer = createActiveTimer({
        activity: firstStep.activity,
        categoryId: firstStep.categoryId,
        date,
        startTime,
        startTs,
        startLocation: startLocation ?? location,
        content: savedMatch?.content || '',
        startContent: savedMatch?.startContent || '',
        endContent: savedMatch?.endContent || '',
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
          content: t.content || '',
          startContent: t.startContent || '',
          endContent: t.endContent || '',
        });
        nextEntries = [entry, ...state.entries];
        nextActivities = updateActivityUsage(state.activities, t.activity, t.categoryId, durationMinutes);
      }

      const transition = advanceTemplateRun(state.activeTemplateRun, { recordedStep: recordCurrent });
      const nextStepSaved = !transition.completed && transition.nextStep
        ? findSavedActivityMatch(nextActivities, {
            label: transition.nextStep.activity,
            categoryId: transition.nextStep.categoryId,
          })
        : null;
      const nextTimer = !transition.completed && transition.nextStep
        ? createActiveTimer({
            activity: transition.nextStep.activity,
            categoryId: transition.nextStep.categoryId,
            date,
            startTime,
            startTs: nowTs,
            startLocation: startLocation ?? location,
            content: nextStepSaved?.content || '',
            startContent: nextStepSaved?.startContent || '',
            endContent: nextStepSaved?.endContent || '',
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
      const savedMatch = findSavedActivityMatch(state.activities, {
        label: resumed.currentStep.activity,
        categoryId: resumed.currentStep.categoryId,
      });
      const timer = createActiveTimer({
        activity: resumed.currentStep.activity,
        categoryId: resumed.currentStep.categoryId,
        date,
        startTime,
        startTs,
        startLocation: startLocation ?? location,
        content: savedMatch?.content || '',
        startContent: savedMatch?.startContent || '',
        endContent: savedMatch?.endContent || '',
      });
      return {
        ...state,
        activeTimer: timer,
        timerUpdatedAt: startTs,
        activeTemplateRun: resumed.nextRun,
        error: null,
      };
    }

    case ACTION_TYPES.SKIP_READY_TEMPLATE_STEP: {
      if (!state.activeTemplateRun) return state;
      const skipped = skipReadyTemplateStep(state.activeTemplateRun);
      return {
        ...state,
        activeTemplateRun: skipped.completed ? null : skipped.nextRun,
        error: null,
      };
    }

    case ACTION_TYPES.SKIP_UPCOMING_TEMPLATE_STEP: {
      if (!state.activeTemplateRun) return state;
      const { stepIndex } = action.payload || {};
      const skipped = skipUpcomingTemplateStep(state.activeTemplateRun, stepIndex);
      return {
        ...state,
        activeTemplateRun: skipped.completed ? null : skipped.nextRun,
        error: null,
      };
    }

    case ACTION_TYPES.REORDER_TEMPLATE_RUN_STEPS: {
      if (!state.activeTemplateRun) return state;
      const { fromIndex, toIndex } = action.payload || {};
      const moved = reorderTemplateRunSteps(state.activeTemplateRun, fromIndex, toIndex);
      return moved?.nextRun
        ? {
            ...state,
            activeTemplateRun: moved.nextRun,
            error: null,
          }
        : state;
    }

    case ACTION_TYPES.SWAP_CURRENT_TEMPLATE_STEP: {
      if (!state.activeTemplateRun) return state;
      const { targetIndex, date = today(), startTime = formatCurrentClock(), startTs = Date.now(), startLocation = null, location = null } = action.payload || {};
      const swapped = swapCurrentTemplateStep(state.activeTemplateRun, targetIndex);
      if (!swapped?.swapped) return state;

      let nextTimer = state.activeTimer;
      let nextTimerUpdatedAt = state.timerUpdatedAt;
      if (state.activeTemplateRun.stepState === 'running' && swapped.nextCurrentStep) {
        const savedMatch = findSavedActivityMatch(state.activities, {
          label: swapped.nextCurrentStep.activity,
          categoryId: swapped.nextCurrentStep.categoryId,
        });
        nextTimer = createActiveTimer({
          activity: swapped.nextCurrentStep.activity,
          categoryId: swapped.nextCurrentStep.categoryId,
          date,
          startTime,
          startTs,
          startLocation: startLocation ?? location,
          content: savedMatch?.content || '',
          startContent: savedMatch?.startContent || '',
          endContent: savedMatch?.endContent || '',
        });
        nextTimerUpdatedAt = startTs;
      }

      return {
        ...state,
        activeTimer: nextTimer,
        timerUpdatedAt: nextTimerUpdatedAt,
        activeTemplateRun: swapped.nextRun,
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

    case ACTION_TYPES.PUSH_TRASH_RECORD:
      return {
        ...state,
        deletedItems: pushTrashRecord(state.deletedItems, action.payload),
      };

    case ACTION_TYPES.RESTORE_DELETED_ITEM: {
      const { nextState } = restoreTrashRecord(state, action.payload);
      return nextState;
    }

    case ACTION_TYPES.RESTORE_LAST_DELETED: {
      const { nextState } = restoreTrashRecord(state, null);
      return nextState;
    }

    case ACTION_TYPES.PURGE_TRASH_ITEM:
      return {
        ...state,
        deletedItems: removeTrashRecord(state.deletedItems, action.payload),
      };

    case ACTION_TYPES.EMPTY_TRASH:
      return {
        ...state,
        deletedItems: [],
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
        deletedItems: [],
        activeTemplateRun: null,
        activeTimer: null,
        activeAsyncTimers: [],
        geoTrackingEnabled: false,
        editingEntryId: null,
        modal: null,
        error: null,
        tab: 'entry',
        period: '7',
        customStart: null,
        customEnd: null,
        shortcutCategoryFilter: 'all',
        uiState: { ...DEFAULT_UI_STATE },
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

const UNDOABLE_ACTION_LABELS = Object.freeze({
  [ACTION_TYPES.START_TIMER]: 'Démarrage du chrono',
  [ACTION_TYPES.STOP_TIMER]: 'Arrêt du chrono',
  [ACTION_TYPES.START_ASYNC_TIMER]: 'Lancement activité parallèle',
  [ACTION_TYPES.STOP_ASYNC_TIMER]: 'Fin activité parallèle',
  [ACTION_TYPES.DISCARD_ASYNC_TIMER]: 'Annulation activité parallèle',
  [ACTION_TYPES.DEMOTE_ACTIVE_TIMER_TO_ASYNC]: 'Passage en parallèle',
  [ACTION_TYPES.PROMOTE_ASYNC_TIMER_TO_ACTIVE]: 'Passage au chrono principal',
  [ACTION_TYPES.UPDATE_ASYNC_TIMER_TARGET]: 'Durée cible parallèle',
  [ACTION_TYPES.UPSERT_ENTRY]: 'Enregistrement de session',
  [ACTION_TYPES.SPLIT_ENTRY]: 'Découpage de session',
  [ACTION_TYPES.DELETE_ENTRY]: 'Suppression de session',
  [ACTION_TYPES.ADD_ACTIVITY]: 'Ajout d’activité',
  [ACTION_TYPES.DELETE_ACTIVITY]: 'Suppression d’activité',
  [ACTION_TYPES.SET_CATEGORIES]: 'Modification des catégories',
  [ACTION_TYPES.MERGE_CATEGORIES]: 'Fusion de catégories',
  [ACTION_TYPES.MERGE_ACTIVITIES]: 'Fusion d’activités',
  [ACTION_TYPES.SAVE_TEMPLATE]: 'Enregistrement de gabarit',
  [ACTION_TYPES.DELETE_TEMPLATE]: 'Suppression de gabarit',
  [ACTION_TYPES.START_TEMPLATE_RUN]: 'Lancement de gabarit',
  [ACTION_TYPES.ADVANCE_TEMPLATE_RUN]: 'Étape de gabarit',
  [ACTION_TYPES.PAUSE_TEMPLATE_RUN]: 'Pause de gabarit',
  [ACTION_TYPES.RESUME_TEMPLATE_RUN]: 'Reprise de gabarit',
  [ACTION_TYPES.SKIP_READY_TEMPLATE_STEP]: 'Étape de gabarit passée',
  [ACTION_TYPES.SKIP_UPCOMING_TEMPLATE_STEP]: 'Étape de gabarit passée',
  [ACTION_TYPES.REORDER_TEMPLATE_RUN_STEPS]: 'Réorganisation de gabarit',
  [ACTION_TYPES.SWAP_CURRENT_TEMPLATE_STEP]: 'Permutation d’étape de gabarit',
  [ACTION_TYPES.STOP_TEMPLATE_RUN]: 'Arrêt de gabarit',
  [ACTION_TYPES.LOG_TEMPLATE_ENTRIES]: 'Journalisation de gabarit',
  [ACTION_TYPES.SET_QUICK_TILES_CONFIG]: 'Configuration des tuiles rapides',
  [ACTION_TYPES.SET_GEO_TRACKING]: 'Réglage GPS',
  [ACTION_TYPES.PATCH_ENTRY_LOCATION]: 'Position GPS de session',
  [ACTION_TYPES.CLEAR_ALL_GEO_LOCATIONS]: 'Suppression des positions GPS',
  [ACTION_TYPES.RESTORE_DELETED_ITEM]: 'Restauration depuis la corbeille',
  [ACTION_TYPES.RESTORE_LAST_DELETED]: 'Restauration depuis la corbeille',
  [ACTION_TYPES.PURGE_TRASH_ITEM]: 'Suppression définitive',
  [ACTION_TYPES.EMPTY_TRASH]: 'Vidage de la corbeille',
  [ACTION_TYPES.RESTORE_DATA]: 'Import de données',
});

function isUndoableAction(action) {
  if (!action?.type) return false;
  if (UNDOABLE_ACTION_LABELS[action.type]) return true;
  if (action.type === ACTION_TYPES.SET_UI_STATE && action.payload?.dashboardConfig !== undefined) {
    return true;
  }
  return false;
}

/**
 * Creates the reactive StateManager instance.
 */
export function createStateManager({ initialState, persistFn, onError, maxHistory = 50 } = {}) {
  let currentState = {
    entries: [],
    activities: [],
    categories: [...DEFAULT_CATEGORIES],
    activityTemplates: [],
    deletedItems: [],
    activeTemplateRun: null,
    activeTimer: null,
    activeAsyncTimers: [],
    timerUpdatedAt: 0,
    geoTrackingEnabled: false,
    quickTilesConfig: createDefaultQuickTilesConfig(),
    tab: 'entry',
    period: '7',
    shortcutCategoryFilter: 'all',
    deviceType: 'mobile',
    customStart: null,
    customEnd: null,
    uiState: { ...DEFAULT_UI_STATE },
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    authUser: null,
    ...initialState,
  };
  currentState.uiState = normalizeUiState({
    ...currentState.uiState,
    tab: currentState.tab,
    period: currentState.period,
    customStart: currentState.customStart,
    customEnd: currentState.customEnd,
    shortcutCategoryFilter: currentState.shortcutCategoryFilter,
  });

  const listeners = new Set();
  const historyManager = createHistoryManager({ maxHistory });

  function notify() {
    listeners.forEach(fn => fn(currentState));
  }

  async function persistIfChanged(prevState, nextState) {
    if (
      prevState.entries !== nextState.entries ||
      prevState.activities !== nextState.activities ||
      prevState.categories !== nextState.categories ||
      prevState.activityTemplates !== nextState.activityTemplates ||
      prevState.deletedItems !== nextState.deletedItems ||
      prevState.activeTemplateRun !== nextState.activeTemplateRun ||
      prevState.activeTimer !== nextState.activeTimer ||
      prevState.activeAsyncTimers !== nextState.activeAsyncTimers ||
      prevState.quickTilesConfig !== nextState.quickTilesConfig ||
      prevState.geoTrackingEnabled !== nextState.geoTrackingEnabled ||
      prevState.timerUpdatedAt !== nextState.timerUpdatedAt ||
      prevState.tab !== nextState.tab ||
      prevState.period !== nextState.period ||
      prevState.customStart !== nextState.customStart ||
      prevState.customEnd !== nextState.customEnd ||
      prevState.shortcutCategoryFilter !== nextState.shortcutCategoryFilter ||
      prevState.uiState !== nextState.uiState
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

  function recordUndoCheckpoint(label = 'Modification', stateOverride = null) {
    return historyManager.push(stateOverride || currentState, label);
  }

  function undo(stateOverride = null) {
    const prevState = stateOverride || currentState;
    const restored = historyManager.undo(prevState);
    if (!restored) return null;
    const nextState = applyUndoableSnapshot(prevState, restored.snapshot);
    currentState = nextState;
    notify();
    persistIfChanged(prevState, nextState);
    return { state: nextState, label: restored.label };
  }

  function redo(stateOverride = null) {
    const prevState = stateOverride || currentState;
    const restored = historyManager.redo(prevState);
    if (!restored) return null;
    const nextState = applyUndoableSnapshot(prevState, restored.snapshot);
    currentState = nextState;
    notify();
    persistIfChanged(prevState, nextState);
    return { state: nextState, label: restored.label };
  }

  function dispatch(action) {
    if (action?.type === ACTION_TYPES.UNDO) {
      return undo()?.state || currentState;
    }
    if (action?.type === ACTION_TYPES.REDO) {
      return redo()?.state || currentState;
    }
    if (action?.type === ACTION_TYPES.CLEAR_ALL) {
      historyManager.clear();
    }

    const prevState = currentState;
    const nextState = appReducer(currentState, action);
    if (nextState !== prevState && isUndoableAction(action)) {
      const label = action.meta?.undoLabel
        || UNDOABLE_ACTION_LABELS[action.type]
        || (action.type === ACTION_TYPES.SET_UI_STATE ? 'Tableau de bord' : 'Modification');
      historyManager.push(prevState, label);
    }

    currentState = nextState;
    notify();
    persistIfChanged(prevState, currentState);
    return currentState;
  }

  return {
    getState() {
      return currentState;
    },

    dispatch,
    recordUndoCheckpoint,
    undo,
    redo,
    canUndo: () => historyManager.canUndo(),
    canRedo: () => historyManager.canRedo(),
    getHistoryStatus: () => historyManager.getStatus(),
    clearHistory: () => historyManager.clear(),

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
      setUiState(patch) {
        return dispatch({ type: ACTION_TYPES.SET_UI_STATE, payload: patch });
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
      startAsyncTimer(payload) {
        return dispatch({ type: ACTION_TYPES.START_ASYNC_TIMER, payload });
      },
      stopAsyncTimer(payload) {
        return dispatch({ type: ACTION_TYPES.STOP_ASYNC_TIMER, payload });
      },
      discardAsyncTimer(timerId) {
        return dispatch({ type: ACTION_TYPES.DISCARD_ASYNC_TIMER, payload: { timerId } });
      },
      demoteActiveTimerToAsync(payload) {
        return dispatch({ type: ACTION_TYPES.DEMOTE_ACTIVE_TIMER_TO_ASYNC, payload });
      },
      promoteAsyncTimerToActive(timerId) {
        return dispatch({ type: ACTION_TYPES.PROMOTE_ASYNC_TIMER_TO_ACTIVE, payload: { timerId } });
      },
      updateAsyncTimerTarget(timerId, targetMins) {
        return dispatch({ type: ACTION_TYPES.UPDATE_ASYNC_TIMER_TARGET, payload: { timerId, targetMins } });
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
      splitEntry(payload) {
        return dispatch({ type: ACTION_TYPES.SPLIT_ENTRY, payload });
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
      skipReadyTemplateStep() {
        return dispatch({ type: ACTION_TYPES.SKIP_READY_TEMPLATE_STEP });
      },
      skipUpcomingTemplateStep(stepIndex) {
        return dispatch({ type: ACTION_TYPES.SKIP_UPCOMING_TEMPLATE_STEP, payload: { stepIndex } });
      },
      reorderTemplateRunSteps(fromIndex, toIndex) {
        return dispatch({ type: ACTION_TYPES.REORDER_TEMPLATE_RUN_STEPS, payload: { fromIndex, toIndex } });
      },
      swapCurrentTemplateStep(payload) {
        return dispatch({ type: ACTION_TYPES.SWAP_CURRENT_TEMPLATE_STEP, payload });
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
      pushTrashRecord(record) {
        return dispatch({ type: ACTION_TYPES.PUSH_TRASH_RECORD, payload: record });
      },
      restoreDeletedItem(trashId) {
        return dispatch({ type: ACTION_TYPES.RESTORE_DELETED_ITEM, payload: trashId });
      },
      restoreLastDeleted() {
        return dispatch({ type: ACTION_TYPES.RESTORE_LAST_DELETED });
      },
      purgeTrashItem(trashId) {
        return dispatch({ type: ACTION_TYPES.PURGE_TRASH_ITEM, payload: trashId });
      },
      emptyTrash() {
        return dispatch({ type: ACTION_TYPES.EMPTY_TRASH });
      },
      setAuthUser(user) {
        return dispatch({ type: ACTION_TYPES.SET_AUTH_USER, payload: user });
      },
      clearAuthUser() {
        return dispatch({ type: ACTION_TYPES.CLEAR_AUTH_USER });
      },
      undo() {
        return undo();
      },
      redo() {
        return redo();
      },
    },
  };
}
