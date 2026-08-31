/**
 * Behavior Tracker: the only module that listens to raw DOM events. It
 * never persists a raw interaction — every listener collapses what it saw
 * into a single semantic event (see semantic-event.js) before handing it
 * to the Event Store / Graph.
 *
 *   User interaction -> Behavior Tracker -> Semantic Event -> Event Store -> ...
 *
 * Deliberate exclusions (see docs/BEHAVIOR_TRACKING.md):
 * - No mousemove/scroll sampling: hover is captured via mouseenter/leave
 *   dwell time instead, which is native-cheap and needs no throttling.
 * - No drag-and-drop wiring: the app has no drag-and-drop feature today.
 *   `trackDragDrop()` exists as a ready-to-use API for when one exists.
 * - No generic "click anywhere" capture: only elements explicitly marked
 *   with `data-behavior-target` are tracked, so nothing is captured by
 *   accident from markup nobody reviewed for sensitivity.
 */

import { createSemanticEvent, EVENT_TYPES } from './semantic-event.js';
import { getUserId, getSessionId } from './ids.js';
import { toSafeIdentifier } from './sanitize.js';

const HOVER_DWELL_THRESHOLD_MS = 1200;

export function createBehaviorTracker({ eventStore, graph = null, onEvent = null } = {}) {
  if (!eventStore) throw new Error('Behavior tracker : eventStore requis.');

  let currentContext = null;
  let root = null;
  let hoverTimer = null;
  let hoverTarget = null;
  const lastActionBySession = new Map();
  const listeners = [];

  function sessionState() {
    const sessionId = getSessionId();
    return { sessionId, userId: getUserId() };
  }

  /** Core entry point: every public track* method funnels through here. */
  async function record({ type = EVENT_TYPES.INTERACTION, action, target = null, object = null, context = currentContext, metadata = {}, timestamp = Date.now() }) {
    const { sessionId, userId } = sessionState();
    const previous = lastActionBySession.get(sessionId) ?? null;

    let event;
    try {
      event = createSemanticEvent({
        type, action, target, object, context, timestamp,
        sessionId, userId,
        previousAction: previous?.action ?? null,
        timeSincePreviousAction: previous ? timestamp - previous.timestamp : null,
        metadata,
      });
    } catch {
      return null; // invalid action id etc: silently dropped, tracking must never throw
    }

    lastActionBySession.set(sessionId, { action: event.action, timestamp: event.timestamp });

    try {
      await eventStore.append(event);
    } catch {
      // Storage unavailable (private browsing, quota...): tracking degrades
      // silently, the app itself is never affected.
    }
    graph?.addEvent(event);
    onEvent?.(event);
    return event;
  }

  function setContext(context) {
    currentContext = toSafeIdentifier(context);
  }

  function trackNavigation(context) {
    setContext(context);
    return record({ action: 'navigate', context });
  }

  function trackClick(target, { object = null, metadata = {} } = {}) {
    return record({ action: 'click', target, object, metadata });
  }

  function trackFormFocus(formTarget, fieldRole) {
    return record({ action: 'form_focus', target: formTarget, metadata: { field: fieldRole } });
  }

  /** @param {'success'|'error'} outcome */
  function trackFormResult(formTarget, outcome, { object = null, code = null } = {}) {
    const action = outcome === 'success' ? 'form_submit_success' : 'form_submit_error';
    return record({ action, target: formTarget, object, metadata: code ? { code } : {} });
  }

  function trackSearch(target, { resultCount = null } = {}) {
    // Query text is never captured, only whether it produced results.
    return record({ action: 'search', target, metadata: resultCount === null ? {} : { has_results: resultCount > 0 } });
  }

  /** Not wired to any listener today: no drag-and-drop feature exists in the app yet (see module doc comment). */
  function trackDragDrop(target, { object = null } = {}) {
    return record({ type: EVENT_TYPES.INTERACTION, action: 'drag_drop', target, object });
  }

  function trackError(error, { context = currentContext } = {}) {
    return record({
      type: EVENT_TYPES.ERROR,
      action: 'js_error',
      context,
      metadata: { name: toSafeIdentifier(error?.name) ?? 'error' },
    });
  }

  function handleDelegatedClick(domEvent) {
    const el = domEvent.target.closest?.('[data-behavior-target]');
    if (!el) return;
    trackClick(el.dataset.behaviorTarget, { object: el.dataset.behaviorObject ?? null });
  }

  function handleDelegatedFocusIn(domEvent) {
    const field = domEvent.target.closest?.('[data-behavior-field]');
    const form = domEvent.target.closest?.('[data-behavior-form]');
    if (!field || !form) return;
    trackFormFocus(form.dataset.behaviorForm, field.dataset.behaviorField);
  }

  function attachHoverTracking(target, el) {
    const dwellStart = Date.now();
    hoverTarget = el;
    hoverTimer = setTimeout(() => {
      const dwellMs = Date.now() - dwellStart;
      record({ action: 'hover_attention', target, metadata: { dwell_bucket: bucketDwell(dwellMs) } });
      hoverTimer = null;
    }, HOVER_DWELL_THRESHOLD_MS);
  }

  function clearHover() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverTarget = null;
  }

  function handleMouseEnter(domEvent) {
    const el = domEvent.target.closest?.('[data-behavior-target]');
    if (!el) return;
    clearHover();
    attachHoverTracking(el.dataset.behaviorTarget, el);
  }

  function handleMouseLeave(domEvent) {
    const el = domEvent.target.closest?.('[data-behavior-target]');
    if (el && el === hoverTarget) clearHover();
  }

  function handleWindowError(domEvent) {
    trackError(domEvent.error ?? { name: 'Error' });
  }

  function handleUnhandledRejection(domEvent) {
    trackError(domEvent.reason ?? { name: 'UnhandledRejection' });
  }

  function attach(rootElement) {
    root = rootElement;
    if (!root || typeof window === 'undefined') return;

    // mouseenter/mouseleave don't bubble; capture phase + delegation via
    // closest() gives the same effect without per-element listeners.
    const bindings = [
      [root, 'click', handleDelegatedClick],
      [root, 'focusin', handleDelegatedFocusIn],
      [root, 'mouseover', handleMouseEnter],
      [root, 'mouseout', handleMouseLeave],
      [window, 'error', handleWindowError],
      [window, 'unhandledrejection', handleUnhandledRejection],
    ];
    for (const [target, eventName, handler] of bindings) {
      target.addEventListener(eventName, handler);
      listeners.push([target, eventName, handler]);
    }
  }

  function detach() {
    for (const [target, eventName, handler] of listeners) target.removeEventListener(eventName, handler);
    listeners.length = 0;
    clearHover();
    root = null;
  }

  return {
    attach,
    detach,
    setContext,
    trackNavigation,
    trackClick,
    trackFormFocus,
    trackFormResult,
    trackSearch,
    trackDragDrop,
    trackError,
    record,
  };
}

function bucketDwell(dwellMs) {
  if (dwellMs < 2000) return 'short';
  if (dwellMs < 5000) return 'medium';
  return 'long';
}
