/**
 * Analytics abstraction layer.
 *
 *   UI / Feature -> analytics.trackEvent() -> Analytics abstraction -> GA4 adapter
 *
 * This module is the only one UI code should import. It knows nothing about
 * GA4 specifically: it delegates to whatever adapter was configured, so the
 * adapter can be swapped later (e.g. for a self-hosted analytics backend)
 * without touching src/ui.js or any feature code.
 *
 * Safety guarantees:
 * - Never throws: a failure to init or send never breaks the app.
 * - No-ops entirely if consent was not granted, or if no GA4 Measurement ID
 *   is configured (see env.js) — the app works identically either way.
 * - Strips obviously sensitive/free-text keys defensively before any send,
 *   as a last line of defense on top of callers never passing them.
 */

import { getGa4MeasurementId } from './env.js';
import { isConsentGranted } from './consent.js';
import { createGa4Adapter } from './ga4-adapter.js';

// Parameter keys that must never be forwarded, even if a caller passes them
// by mistake: free-text / user-authored content is not analytics data.
const DENYLISTED_KEYS = new Set([
  'activity', 'activity_name', 'label', 'name', 'title',
  'email', 'password', 'token', 'note', 'notes', 'comment',
]);
const MAX_STRING_LENGTH = 100;

let adapter = null;
let initPromise = null;
let queuedEvents = [];

/**
 * Initializes analytics if (and only if) consent was granted and a
 * Measurement ID is configured. Safe to call multiple times; safe to call
 * even when analytics will never be enabled.
 * @param {{ adapterFactory?: (id: string) => Promise<any> }} [options]
 */
export function initAnalytics({ adapterFactory = createGa4Adapter } = {}) {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isConsentGranted()) return;

    const measurementId = getGa4MeasurementId();
    if (!measurementId) return;

    try {
      adapter = await adapterFactory(measurementId);
      const pending = queuedEvents;
      queuedEvents = [];
      for (const event of pending) adapter.trackEvent(event.name, event.parameters);
    } catch (error) {
      adapter = null;
      warn('Initialisation impossible, analytics désactivé.', error);
    }
  })();

  return initPromise;
}

/**
 * Sends a semantic event. Never throws. If analytics is not yet
 * initialized, events are queued (bounded) and flushed once init resolves;
 * if analytics ends up disabled (no consent / no Measurement ID), the queue
 * is simply dropped.
 * @param {string} name
 * @param {Record<string, unknown>} [parameters]
 */
export function trackEvent(name, parameters = {}) {
  if (!name || typeof name !== 'string') return;
  const safeParameters = sanitizeParameters(parameters);

  if (adapter) {
    try {
      adapter.trackEvent(name, safeParameters);
    } catch (error) {
      warn(`Envoi de l’événement "${name}" impossible.`, error);
    }
    return;
  }

  if (!initPromise) {
    // initAnalytics() was never called: analytics is effectively unused in
    // this context (e.g. tests, or a caller that opted out of init).
    return;
  }

  if (queuedEvents.length < 50) {
    queuedEvents.push({ name, parameters: safeParameters });
  }
}

export function trackPageView(pageTitle, parameters = {}) {
  trackEvent('page_view', { page_title: pageTitle, ...parameters });
}

/** Test/consent-revocation helper: fully resets module state. */
export function resetAnalytics() {
  adapter?.teardown?.();
  adapter = null;
  initPromise = null;
  queuedEvents = [];
}

function sanitizeParameters(parameters) {
  if (!parameters || typeof parameters !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (DENYLISTED_KEYS.has(key.toLowerCase())) continue;
    if (value === undefined || typeof value === 'function') continue;
    if (typeof value === 'string') {
      result[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[key] = value;
    }
    // Objects/arrays are intentionally dropped: GA4 event parameters should
    // be flat, and nested structures are more likely to carry unreviewed
    // user content.
  }
  return result;
}

function warn(message, error) {
  if (typeof console !== 'undefined') {
    console.warn(`[analytics] ${message}`, error);
  }
}
