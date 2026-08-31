/**
 * Canonical catalog of analytics events for TimeTracker.
 *
 * Every event here corresponds to a feature that actually exists in the
 * application (see src/ui.js). Payload builders intentionally never accept
 * or forward free-text user content (activity names, category labels,
 * saved-activity labels): those are personal/user-authored data and must
 * never reach analytics. Only structural, non-identifying facts are sent
 * (durations, counts, booleans, opaque ids, depth).
 *
 * Full documentation of each event and its parameters lives in
 * docs/ANALYTICS.md.
 */

export const ANALYTICS_EVENTS = Object.freeze({
  PAGE_VIEW: 'page_view',
  TIMER_STARTED: 'timer_started',
  TIMER_STOPPED: 'timer_stopped',
  TIME_ENTRY_CREATED: 'time_entry_created',
  TIME_ENTRY_UPDATED: 'time_entry_updated',
  TIME_ENTRY_DELETED: 'time_entry_deleted',
  SAVED_ACTIVITY_CREATED: 'saved_activity_created',
  SAVED_ACTIVITY_DELETED: 'saved_activity_deleted',
  SAVED_ACTIVITY_STARTED: 'saved_activity_started',
  CATEGORY_CREATED: 'category_created',
  CATEGORY_RENAMED: 'category_renamed',
  CATEGORY_MOVED: 'category_moved',
  CATEGORY_DELETED: 'category_deleted',
  DASHBOARD_PERIOD_CHANGED: 'dashboard_period_changed',
  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',
  DATA_CLEARED: 'data_cleared',
});

const VALID_TABS = new Set(['entry', 'dashboard', 'categories']);

export function pageViewPayload(tab) {
  return { page_title: VALID_TABS.has(tab) ? tab : 'unknown' };
}

export function timerStartedPayload({ hasCategory }) {
  return { has_category: Boolean(hasCategory) };
}

export function timerStoppedPayload({ durationMinutes, hasCategory }) {
  return {
    duration_minutes: safeNonNegativeInt(durationMinutes),
    has_category: Boolean(hasCategory),
  };
}

export function timeEntryCreatedPayload({ durationMinutes, hasCategory, viaTimer = false }) {
  return {
    duration_minutes: safeNonNegativeInt(durationMinutes),
    has_category: Boolean(hasCategory),
    via_timer: Boolean(viaTimer),
  };
}

export function timeEntryUpdatedPayload({ durationMinutes, hasCategory }) {
  return {
    duration_minutes: safeNonNegativeInt(durationMinutes),
    has_category: Boolean(hasCategory),
  };
}

export function savedActivityCreatedPayload({ hasCategory }) {
  return { has_category: Boolean(hasCategory) };
}

export function categoryCreatedPayload({ depth }) {
  return { depth: safeNonNegativeInt(depth) };
}

export function categoryMovedPayload({ depth }) {
  return { depth: safeNonNegativeInt(depth) };
}

export function categoryDeletedPayload({ cascade, descendantCount }) {
  return {
    cascade: Boolean(cascade),
    descendant_count: safeNonNegativeInt(descendantCount),
  };
}

export function dashboardPeriodChangedPayload({ period }) {
  const allowed = new Set(['7', '14', '30', '90']);
  return { period: allowed.has(String(period)) ? String(period) : 'unknown' };
}

export function dataExportedPayload({ entryCount, categoryCount }) {
  return {
    entry_count: safeNonNegativeInt(entryCount),
    category_count: safeNonNegativeInt(categoryCount),
  };
}

export function dataImportedPayload({ entryCount, categoryCount }) {
  return {
    entry_count: safeNonNegativeInt(entryCount),
    category_count: safeNonNegativeInt(categoryCount),
  };
}

function safeNonNegativeInt(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
