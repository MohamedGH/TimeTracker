import { describe, it, expect } from 'vitest';
import {
  ANALYTICS_EVENTS,
  pageViewPayload,
  timerStartedPayload,
  timerStoppedPayload,
  timeEntryCreatedPayload,
  timeEntryUpdatedPayload,
  geoTrackingToggledPayload,
  savedActivityCreatedPayload,
  categoryCreatedPayload,
  categoryMovedPayload,
  categoryDeletedPayload,
  dashboardPeriodChangedPayload,
  dataExportedPayload,
  dataImportedPayload,
  itemRestoredPayload,
} from '../src/core/analytics/events.js';

describe('events catalog', () => {
  it('exposes a stable, deduplicated set of event names', () => {
    const names = Object.values(ANALYTICS_EVENTS);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('page_view');
    expect(names).toContain('timer_started');
    expect(names).toContain('time_entry_created');
    expect(names).toContain('item_restored');
  });
});

describe('pageViewPayload', () => {
  it('accepts known tabs and dedicated widget pages', () => {
    expect(pageViewPayload('entry')).toEqual({ page_title: 'entry' });
    expect(pageViewPayload('dashboard')).toEqual({ page_title: 'dashboard' });
    expect(pageViewPayload('categories')).toEqual({ page_title: 'categories' });
    expect(pageViewPayload('pages')).toEqual({ page_title: 'pages' });
    expect(pageViewPayload('templates')).toEqual({ page_title: 'templates' });
    expect(pageViewPayload('tiles')).toEqual({ page_title: 'tiles' });
  });

  it('builds item_restored payload safely', () => {
    expect(itemRestoredPayload({ kind: 'entry' })).toEqual({ kind: 'entry' });
    expect(itemRestoredPayload({ kind: 'other' })).toEqual({ kind: 'unknown' });
  });

  it('falls back to "unknown" for unexpected values', () => {
    expect(pageViewPayload('nope')).toEqual({ page_title: 'unknown' });
    expect(pageViewPayload(undefined)).toEqual({ page_title: 'unknown' });
  });
});

describe('timer payloads', () => {
  it('builds timer_started payload', () => {
    expect(timerStartedPayload({ hasCategory: true })).toEqual({ has_category: true, has_location: false });
    expect(timerStartedPayload({ hasCategory: false, hasLocation: true })).toEqual({ has_category: false, has_location: true });
  });

  it('builds timer_stopped payload with a safe, non-negative integer duration', () => {
    expect(timerStoppedPayload({ durationMinutes: 42.6, hasCategory: true, hasLocation: true }))
      .toEqual({ duration_minutes: 43, has_category: true, has_location: true });
    expect(timerStoppedPayload({ durationMinutes: -5, hasCategory: false }))
      .toEqual({ duration_minutes: 0, has_category: false, has_location: false });
    expect(timerStoppedPayload({ durationMinutes: NaN, hasCategory: false }))
      .toEqual({ duration_minutes: 0, has_category: false, has_location: false });
  });
});

describe('time entry payloads', () => {
  it('builds time_entry_created payload including via_timer and has_location flags', () => {
    expect(timeEntryCreatedPayload({ durationMinutes: 30, hasCategory: true, viaTimer: true, hasLocation: true }))
      .toEqual({ duration_minutes: 30, has_category: true, via_timer: true, has_location: true });
    expect(timeEntryCreatedPayload({ durationMinutes: 15, hasCategory: false }))
      .toEqual({ duration_minutes: 15, has_category: false, via_timer: false, has_location: false });
  });

  it('builds time_entry_updated payload', () => {
    expect(timeEntryUpdatedPayload({ durationMinutes: 20, hasCategory: true }))
      .toEqual({ duration_minutes: 20, has_category: true, has_location: false });
  });

  it('builds geo_tracking_toggled payload', () => {
    expect(geoTrackingToggledPayload({ enabled: true })).toEqual({ enabled: true });
    expect(geoTrackingToggledPayload({ enabled: 0 })).toEqual({ enabled: false });
  });
});

describe('saved activity payloads', () => {
  it('builds saved_activity_created payload', () => {
    expect(savedActivityCreatedPayload({ hasCategory: true })).toEqual({ has_category: true });
  });
});

describe('category payloads', () => {
  it('builds category_created payload with clamped non-negative depth', () => {
    expect(categoryCreatedPayload({ depth: 2 })).toEqual({ depth: 2 });
    expect(categoryCreatedPayload({ depth: -1 })).toEqual({ depth: 0 });
  });

  it('builds category_moved payload', () => {
    expect(categoryMovedPayload({ depth: 3 })).toEqual({ depth: 3 });
  });

  it('builds category_deleted payload with cascade flag and descendant count', () => {
    expect(categoryDeletedPayload({ cascade: true, descendantCount: 4 }))
      .toEqual({ cascade: true, descendant_count: 4 });
    expect(categoryDeletedPayload({ cascade: false, descendantCount: undefined }))
      .toEqual({ cascade: false, descendant_count: 0 });
  });
});

describe('dashboard/data payloads', () => {
  it('builds dashboard_period_changed payload for known periods only', () => {
    expect(dashboardPeriodChangedPayload({ period: '30' })).toEqual({ period: '30' });
    expect(dashboardPeriodChangedPayload({ period: '999' })).toEqual({ period: 'unknown' });
  });

  it('builds data_exported and data_imported payloads', () => {
    expect(dataExportedPayload({ entryCount: 12, categoryCount: 5 }))
      .toEqual({ entry_count: 12, category_count: 5 });
    expect(dataImportedPayload({ entryCount: 0, categoryCount: 0 }))
      .toEqual({ entry_count: 0, category_count: 0 });
  });
});
