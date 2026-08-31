/**
 * Wiring helper: connects the Behavior Tracker to a DOM root, an Event
 * Store, and a live in-memory Semantic Event Graph, gated by the same
 * consent decision as GA4 (src/core/analytics/consent.js) — one banner,
 * one decision, both remote analytics and local behavior tracking respect
 * it. Unlike GA4, behavior tracking needs no external id/key: everything
 * it collects stays on-device in IndexedDB.
 */

import { isConsentGranted } from '../analytics/consent.js';
import { createBehaviorTracker } from './behavior-tracker.js';
import { createEventStore } from './event-store.js';
import { createEventGraph, NODE_TYPES } from './event-graph.js';
import { detectSequencePatterns, detectAbandonment, applyPatternsToGraph, applyAbandonmentToGraph } from './pattern-detection.js';

const DEFAULT_PATTERN_DETECTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let instance = null;
let periodicTimer = null;
let detectionInFlight = false;

/**
 * @param {{ root?: Element, patternDetectionIntervalMs?: number }} [options]
 *   Set `patternDetectionIntervalMs: 0` to disable the periodic run (used by
 *   tests, and useful for anyone driving `runPatternDetection()` manually).
 */
export function initBehaviorTracking({ root, patternDetectionIntervalMs = DEFAULT_PATTERN_DETECTION_INTERVAL_MS } = {}) {
  if (instance) return instance;
  if (!isConsentGranted()) return null;

  const eventStore = createEventStore();
  const graph = createEventGraph();
  const tracker = createBehaviorTracker({ eventStore, graph });
  // Attach immediately so no interaction is missed while history loads.
  if (root) tracker.attach(root);

  // The graph starts empty and only grows from *new* events unless it's
  // backfilled: without this, pattern detection would only ever see
  // whatever happened since the last page load, never prior sessions.
  const ready = eventStore.listAll()
    .then(events => { graph.addEvents(events); })
    .catch(() => { /* best-effort: live tracking still works without history */ });

  instance = { tracker, eventStore, graph, ready };

  // "Construire progressivement" the graph means something has to keep
  // re-running Pattern Detection as more events accumulate, not just once
  // on demand. This does that in the background, cheaply: it's a no-op
  // (skipped) while a previous run is still in flight, and every run is
  // itself bounded by however many events are in the store.
  if (patternDetectionIntervalMs > 0 && typeof setInterval !== 'undefined') {
    periodicTimer = setInterval(() => {
      if (detectionInFlight) return;
      detectionInFlight = true;
      runPatternDetection().catch(() => {}).finally(() => { detectionInFlight = false; });
    }, patternDetectionIntervalMs);
    periodicTimer?.unref?.(); // Node/test environments: never block process exit on this.
  }

  return instance;
}

export function getBehaviorTracking() {
  return instance;
}

export function resetBehaviorTracking() {
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;
  detectionInFlight = false;
  instance?.tracker.detach();
  instance = null;
}

/**
 * Runs the full Pattern Detection pass over everything currently in the
 * Event Store, writes WORKFLOW/INTENT/PROBLEM/FEATURE_CANDIDATE hypotheses
 * into the live graph, and returns the raw findings. This is the concrete
 * bridge between "the graph exists" and "something actually looked for
 * patterns in it" — still no AI step, just data prepared for one.
 */
export async function runPatternDetection({ minSupportUsers = 2, sequenceLengths = [2, 3] } = {}) {
  if (!instance) return null;
  await instance.ready;

  const events = await instance.eventStore.listAll();
  const sequencePatterns = detectSequencePatterns(events, { minSupportUsers, sequenceLengths });
  const abandonments = detectAbandonment(events);

  const workflows = applyPatternsToGraph(instance.graph, sequencePatterns, { minSupportUsers });
  const problems = applyAbandonmentToGraph(instance.graph, abandonments, { minOccurrences: minSupportUsers });

  return { sequencePatterns, abandonments, workflows, problems, graph: instance.graph };
}

/**
 * Ranked, plain-object view of every FEATURE_CANDIDATE hypothesis produced
 * so far — the shape a future AI Feature Discovery step (or a human
 * reviewing a backlog) would actually consume. Never auto-applied: every
 * item carries `status: 'hypothesis'` from pattern-detection.js and stays
 * that way until a human changes it.
 */
export function getFeatureCandidates({ limit = 20 } = {}) {
  if (!instance) return [];
  return instance.graph.getNodesByType(NODE_TYPES.FEATURE_CANDIDATE)
    .map(node => ({
      id: node.value,
      description: node.properties.description,
      supportUsers: node.properties.supportUsers ?? 0,
      status: node.properties.status ?? 'hypothesis',
    }))
    .sort((a, b) => b.supportUsers - a.supportUsers)
    .slice(0, limit);
}

export { createBehaviorTracker } from './behavior-tracker.js';
export { createEventStore } from './event-store.js';
export { createEventGraph, buildEventGraph, NODE_TYPES, RELATIONSHIPS } from './event-graph.js';
export { createSemanticEvent, isSemanticEvent, EVENT_TYPES } from './semantic-event.js';
export {
  detectSequencePatterns, detectRepetitions, detectAbandonment,
  applyPatternsToGraph, applyAbandonmentToGraph, describeFeatureCandidate,
} from './pattern-detection.js';
