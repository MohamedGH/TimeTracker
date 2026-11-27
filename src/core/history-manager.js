/**
 * Undo / Redo History Manager — Pure functional snapshot stack for TimeTracker.
 */

const DEFAULT_MAX_HISTORY = 50;

function cloneValue(value) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fallback to JSON clone below
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Extracts a deep-cloned undoable snapshot from application state.
 * Transient UI fields (active tab, open modal, error/notice toasts, search text) are excluded
 * so Undo/Redo always operates on user data and dashboard/tile configurations.
 */
export function pickUndoableSnapshot(state = {}) {
  return {
    entries: cloneValue(Array.isArray(state.entries) ? state.entries : []),
    activities: cloneValue(Array.isArray(state.activities) ? state.activities : []),
    categories: cloneValue(Array.isArray(state.categories) ? state.categories : []),
    activityTemplates: cloneValue(Array.isArray(state.activityTemplates) ? state.activityTemplates : []),
    deletedItems: cloneValue(Array.isArray(state.deletedItems) ? state.deletedItems : []),
    activeTimer: state.activeTimer ? cloneValue(state.activeTimer) : null,
    activeAsyncTimers: cloneValue(Array.isArray(state.activeAsyncTimers) ? state.activeAsyncTimers : []),
    timerUpdatedAt: Number(state.timerUpdatedAt) || 0,
    activeTemplateRun: state.activeTemplateRun ? cloneValue(state.activeTemplateRun) : null,
    quickTilesConfig: state.quickTilesConfig ? cloneValue(state.quickTilesConfig) : null,
    geoTrackingEnabled: Boolean(state.geoTrackingEnabled),
    dashboardConfig: state.uiState?.dashboardConfig
      ? cloneValue(state.uiState.dashboardConfig)
      : undefined,
  };
}

/**
 * Applies a restored snapshot onto an existing state object (non-mutating).
 */
export function applyUndoableSnapshot(state = {}, snapshot = {}) {
  const nextUiState = snapshot.dashboardConfig !== undefined
    ? {
        ...(state.uiState || {}),
        dashboardConfig: cloneValue(snapshot.dashboardConfig),
      }
    : state.uiState;

  return {
    ...state,
    entries: cloneValue(snapshot.entries || []),
    activities: cloneValue(snapshot.activities || []),
    categories: cloneValue(snapshot.categories || []),
    activityTemplates: cloneValue(snapshot.activityTemplates || []),
    deletedItems: cloneValue(snapshot.deletedItems || []),
    activeTimer: snapshot.activeTimer ? cloneValue(snapshot.activeTimer) : null,
    activeAsyncTimers: cloneValue(Array.isArray(snapshot.activeAsyncTimers) ? snapshot.activeAsyncTimers : []),
    timerUpdatedAt: Math.max(Date.now(), (Number(snapshot.timerUpdatedAt) || 0) + 1),
    activeTemplateRun: snapshot.activeTemplateRun ? cloneValue(snapshot.activeTemplateRun) : null,
    ...(snapshot.quickTilesConfig ? { quickTilesConfig: cloneValue(snapshot.quickTilesConfig) } : {}),
    geoTrackingEnabled: Boolean(snapshot.geoTrackingEnabled),
    ...(nextUiState ? { uiState: nextUiState } : {}),
    editingEntryId: null,
    modal: null,
    error: null,
  };
}

function snapshotSignature(snapshot) {
  try {
    return JSON.stringify({
      entries: snapshot.entries,
      activities: snapshot.activities,
      categories: snapshot.categories,
      activityTemplates: snapshot.activityTemplates,
      deletedItems: snapshot.deletedItems,
      activeTimer: snapshot.activeTimer,
      activeAsyncTimers: snapshot.activeAsyncTimers,
      activeTemplateRun: snapshot.activeTemplateRun,
      quickTilesConfig: snapshot.quickTilesConfig,
      geoTrackingEnabled: snapshot.geoTrackingEnabled,
      dashboardConfig: snapshot.dashboardConfig,
    });
  } catch {
    return null;
  }
}

export function createHistoryManager({ maxHistory = DEFAULT_MAX_HISTORY } = {}) {
  const limit = Math.max(1, Number(maxHistory) || DEFAULT_MAX_HISTORY);
  let past = [];
  let future = [];

  function push(stateSnapshot, label = 'Modification') {
    if (!stateSnapshot || typeof stateSnapshot !== 'object') return false;
    const snapshot = pickUndoableSnapshot(stateSnapshot);
    const sig = snapshotSignature(snapshot);
    const top = past[past.length - 1];
    if (top && sig !== null && top.signature === sig) {
      return false;
    }

    past.push({
      snapshot,
      label: String(label || 'Modification').trim() || 'Modification',
      signature: sig,
    });
    if (past.length > limit) {
      past = past.slice(past.length - limit);
    }
    future = [];
    return true;
  }

  function undo(currentState) {
    if (!past.length) return null;
    const currentSnapshot = pickUndoableSnapshot(currentState);
    const currentSig = snapshotSignature(currentSnapshot);

    // Pop latest checkpoint; if identical to current state (e.g. a no-op mutation), skip until changed or empty
    let entry = past.pop();
    while (entry && currentSig !== null && entry.signature === currentSig && past.length > 0) {
      entry = past.pop();
    }
    if (!entry || (currentSig !== null && entry.signature === currentSig)) {
      return null;
    }

    future.push({
      snapshot: currentSnapshot,
      label: entry.label,
      signature: currentSig,
    });
    if (future.length > limit) {
      future = future.slice(future.length - limit);
    }

    return {
      snapshot: entry.snapshot,
      label: entry.label,
    };
  }

  function redo(currentState) {
    if (!future.length) return null;
    const entry = future.pop();
    const currentSnapshot = pickUndoableSnapshot(currentState);
    const currentSig = snapshotSignature(currentSnapshot);

    past.push({
      snapshot: currentSnapshot,
      label: entry.label,
      signature: currentSig,
    });
    if (past.length > limit) {
      past = past.slice(past.length - limit);
    }

    return {
      snapshot: entry.snapshot,
      label: entry.label,
    };
  }

  function clear() {
    past = [];
    future = [];
  }

  function getStatus() {
    const undoTop = past[past.length - 1] || null;
    const redoTop = future[future.length - 1] || null;
    return {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoCount: past.length,
      redoCount: future.length,
      undoLabel: undoTop?.label || null,
      redoLabel: redoTop?.label || null,
    };
  }

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    getUndoLabel: () => past[past.length - 1]?.label || null,
    getRedoLabel: () => future[future.length - 1]?.label || null,
    getStatus,
  };
}
