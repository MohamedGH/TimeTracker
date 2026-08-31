import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initAnalytics, trackEvent, trackPageView, resetAnalytics } from '../src/core/analytics/analytics.js';
import { setConsentStatus, clearConsentDecision } from '../src/core/analytics/consent.js';

function fakeAdapterFactory() {
  const sent = [];
  const factory = vi.fn(async () => ({
    trackEvent: (name, parameters) => sent.push({ name, parameters }),
    teardown: vi.fn(),
  }));
  return { factory, sent };
}

beforeEach(() => {
  localStorage.clear();
  resetAnalytics();
  // initAnalytics() also requires a configured Measurement ID (see env.js);
  // set one so tests can isolate the consent-gating behavior under test.
  window.__TIME_TRACKER_ENV__ = { GA4_MEASUREMENT_ID: 'G-TEST123' };
});

afterEach(() => {
  delete window.__TIME_TRACKER_ENV__;
});

describe('initAnalytics', () => {
  it('never initializes the adapter without a consent decision', async () => {
    const { factory } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    expect(factory).not.toHaveBeenCalled();
  });

  it('never initializes the adapter without a configured Measurement ID', async () => {
    delete window.__TIME_TRACKER_ENV__;
    setConsentStatus(true);
    const { factory } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    expect(factory).not.toHaveBeenCalled();
  });

  it('never initializes the adapter when consent was denied', async () => {
    setConsentStatus(false);
    const { factory } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    expect(factory).not.toHaveBeenCalled();
  });

  it('initializes the adapter once consent is granted', async () => {
    setConsentStatus(true);
    const { factory } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: calling it twice only initializes once', async () => {
    setConsentStatus(true);
    const { factory } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    await initAnalytics({ adapterFactory: factory });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully if the adapter factory throws (e.g. GA4 unreachable)', async () => {
    setConsentStatus(true);
    const factory = vi.fn(async () => { throw new Error('network down'); });
    await expect(initAnalytics({ adapterFactory: factory })).resolves.toBeUndefined();
    // trackEvent must still not throw afterwards.
    expect(() => trackEvent('time_entry_created', { duration_minutes: 5 })).not.toThrow();
  });
});

describe('trackEvent', () => {
  it('never throws when analytics was never initialized', () => {
    expect(() => trackEvent('timer_started', { has_category: true })).not.toThrow();
  });

  it('forwards sanitized events to the adapter once initialized', async () => {
    setConsentStatus(true);
    const { factory, sent } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });

    trackEvent('time_entry_created', { duration_minutes: 30, has_category: true });

    expect(sent).toEqual([
      { name: 'time_entry_created', parameters: { duration_minutes: 30, has_category: true } },
    ]);
  });

  it('queues events fired before init resolves and flushes them after', async () => {
    setConsentStatus(true);
    const { factory, sent } = fakeAdapterFactory();
    const initPromise = initAnalytics({ adapterFactory: factory });
    trackEvent('page_view', { page_title: 'entry' });
    expect(sent).toEqual([]); // not flushed yet
    await initPromise;
    expect(sent).toEqual([{ name: 'page_view', parameters: { page_title: 'entry' } }]);
  });

  it('strips free-text / sensitive parameter keys defensively', async () => {
    setConsentStatus(true);
    const { factory, sent } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });

    trackEvent('time_entry_created', {
      duration_minutes: 10,
      activity: 'Séance de sport privée', // must never be sent
      label: 'some label',
      email: 'person@example.com',
    });

    expect(sent).toEqual([
      { name: 'time_entry_created', parameters: { duration_minutes: 10 } },
    ]);
  });

  it('drops nested object/array parameter values', async () => {
    setConsentStatus(true);
    const { factory, sent } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });

    trackEvent('data_exported', { entry_count: 3, nested: { a: 1 }, list: [1, 2, 3] });

    expect(sent).toEqual([{ name: 'data_exported', parameters: { entry_count: 3 } }]);
  });

  it('ignores calls with no event name', async () => {
    setConsentStatus(true);
    const { factory, sent } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    trackEvent('');
    trackEvent(undefined);
    expect(sent).toEqual([]);
  });

  it('never throws even if the adapter itself throws while sending', async () => {
    setConsentStatus(true);
    const factory = vi.fn(async () => ({
      trackEvent: () => { throw new Error('gtag exploded'); },
    }));
    await initAnalytics({ adapterFactory: factory });
    expect(() => trackEvent('timer_started', { has_category: false })).not.toThrow();
  });
});

describe('trackPageView', () => {
  it('sends a page_view event with the given page title', async () => {
    setConsentStatus(true);
    const { factory, sent } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    trackPageView('dashboard');
    expect(sent).toEqual([{ name: 'page_view', parameters: { page_title: 'dashboard' } }]);
  });
});

describe('consent revocation resets analytics', () => {
  it('resetAnalytics() clears the adapter and any queued events', async () => {
    setConsentStatus(true);
    const { factory, sent } = fakeAdapterFactory();
    await initAnalytics({ adapterFactory: factory });
    trackEvent('data_cleared');
    resetAnalytics();
    clearConsentDecision();
    trackEvent('data_cleared'); // should be silently dropped, no adapter
    expect(sent).toEqual([{ name: 'data_cleared', parameters: {} }]);
  });
});
