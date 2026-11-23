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
  CATEGORY_MERGED: 'category_merged',
  CATEGORY_DELETED: 'category_deleted',
  SAVED_ACTIVITY_MERGED: 'saved_activity_merged',
  TEMPLATE_CREATED: 'template_created',
  TEMPLATE_UPDATED: 'template_updated',
  TEMPLATE_DELETED: 'template_deleted',
  TEMPLATE_STARTED: 'template_started',
  TEMPLATE_STEP_ADVANCED: 'template_step_advanced',
  TEMPLATE_COMPLETED: 'template_completed',
  TEMPLATE_LOGGED_MANUAL: 'template_logged_manual',
  ITEM_RESTORED: 'item_restored',
  DASHBOARD_PERIOD_CHANGED: 'dashboard_period_changed',
  GEO_TRACKING_TOGGLED: 'geo_tracking_toggled',
  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',
  DATA_CLEARED: 'data_cleared',
  AUTH_SIGNED_IN: 'auth_signed_in',
  AUTH_SIGNED_OUT: 'auth_signed_out',
  SYNC_DRIVE_COMPLETED: 'sync_drive_completed',
  SYNC_P2P_COMPLETED: 'sync_p2p_completed',
  PWA_INSTALLED: 'pwa_installed',
});

const VALID_TABS = new Set([
  'entry',
  'dashboard',
  'categories',
  'pages',
  'templates',
  'activities',
  'entries',
  'data',
  'sync',
  'account',
  'mobile',
  'tiles',
]);

export function pageViewPayload(tab) {
  return { page_title: VALID_TABS.has(tab) ? tab : 'unknown' };
}

export function itemRestoredPayload({ kind = 'unknown' } = {}) {
  const allowed = new Set(['entry', 'activity', 'template', 'category']);
  return { kind: allowed.has(kind) ? kind : 'unknown' };
}

export function timerStartedPayload({ hasCategory, hasLocation = false }) {
  return {
    has_category: Boolean(hasCategory),
    has_location: Boolean(hasLocation),
  };
}

export function timerStoppedPayload({ durationMinutes, hasCategory, hasLocation = false }) {
  return {
    duration_minutes: safeNonNegativeInt(durationMinutes),
    has_category: Boolean(hasCategory),
    has_location: Boolean(hasLocation),
  };
}

export function timeEntryCreatedPayload({ durationMinutes, hasCategory, viaTimer = false, hasLocation = false }) {
  return {
    duration_minutes: safeNonNegativeInt(durationMinutes),
    has_category: Boolean(hasCategory),
    via_timer: Boolean(viaTimer),
    has_location: Boolean(hasLocation),
  };
}

export function timeEntryUpdatedPayload({ durationMinutes, hasCategory, hasLocation = false }) {
  return {
    duration_minutes: safeNonNegativeInt(durationMinutes),
    has_category: Boolean(hasCategory),
    has_location: Boolean(hasLocation),
  };
}

export function geoTrackingToggledPayload({ enabled }) {
  return { enabled: Boolean(enabled) };
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

export function authEventPayload() {
  return { provider: 'google_oidc' };
}

export function syncEventPayload(mode = 'unknown') {
  const allowed = new Set(['drive_appdata', 'webrtc_p2p']);
  return { mode: allowed.has(mode) ? mode : 'unknown' };
}

export function templateEventPayload({ stepCount = 0, fromHistory = false } = {}) {
  return {
    step_count: safeNonNegativeInt(stepCount),
    from_history: Boolean(fromHistory),
  };
}

function safeNonNegativeInt(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
