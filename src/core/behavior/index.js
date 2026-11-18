/**
 * Wiring helper: connects the Behavior Tracker to a DOM root, an Event
 * Store, and a live in-memory Semantic Event Graph, gated by the same
 * consent decision as GA4 (src/core/analytics/consent.js).
 * Everything collected stays strictly on-device in IndexedDB.
 */

import { isConsentGranted } from '../analytics/consent.js';
import { createBehaviorTracker } from './behavior-tracker.js';
import { createEventStore } from './event-store.js';
import { createEventGraph, NODE_TYPES } from './event-graph.js';
import {
  detectSequencePatterns,
  detectRepetitions,
  detectAbandonment,
  applyPatternsToGraph,
  applyAbandonmentToGraph,
  applyRepetitionsToGraph,
} from './pattern-detection.js';

const DEFAULT_PATTERN_DETECTION_INTERVAL_MS = 5 * 60 * 1000;

let instance = null;
let periodicTimer = null;
let activeDetectionPromise = null;
let lastDetectionMeta = {
  lastRunAt: 0,
  eventCountAtRun: -1,
};

/**
 * @param {{ root?: Element, patternDetectionIntervalMs?: number }} [options]
 */
export function initBehaviorTracking({ root, patternDetectionIntervalMs = DEFAULT_PATTERN_DETECTION_INTERVAL_MS } = {}) {
  if (instance) return instance;
  if (!isConsentGranted()) return null;

  const eventStore = createEventStore();
  const graph = createEventGraph();
  const tracker = createBehaviorTracker({ eventStore, graph });
  if (root) tracker.attach(root);

  const ready = eventStore.listAll()
    .then(events => { graph.addEvents(events); })
    .catch(() => { /* best-effort: live tracking still works without history */ });

  instance = { tracker, eventStore, graph, ready };

  if (patternDetectionIntervalMs > 0 && typeof setInterval !== 'undefined') {
    periodicTimer = setInterval(() => {
      if (activeDetectionPromise) return;
      runPatternDetection().catch(() => {});
    }, patternDetectionIntervalMs);
    periodicTimer?.unref?.();
  }

  return instance;
}

export function getBehaviorTracking() {
  return instance;
}

export function getBehaviorDetectionMeta() {
  return { ...lastDetectionMeta };
}

export function resetBehaviorTracking() {
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;
  activeDetectionPromise = null;
  lastDetectionMeta = { lastRunAt: 0, eventCountAtRun: -1 };
  instance?.tracker.detach();
  instance = null;
}

/**
 * Runs the full Pattern Detection pass over stored semantic events:
 * - action sequences (workflows)
 * - form abandonments
 * - rapid click repetitions (interface friction)
 * Deduplicates concurrent runs and refreshes hypothesis nodes cleanly.
 */
export async function runPatternDetection({
  minSupportUsers = 1,
  minSupportSessions = 2,
  minOccurrences = 2,
  minRepetitionClusters = 2,
  minRepetitionSessions = 1,
  sequenceLengths = [2, 3],
  abandonmentTimeoutMs = 180_000,
} = {}) {
  if (!instance) return null;
  if (activeDetectionPromise) return activeDetectionPromise;

  activeDetectionPromise = (async () => {
    await instance.ready;
    const events = await instance.eventStore.listAll();

    // Refresh hypothesis nodes cleanly so resolved/stale patterns do not linger
    instance.graph.removeNodesByTypes([
      NODE_TYPES.WORKFLOW,
      NODE_TYPES.INTENT,
      NODE_TYPES.PROBLEM,
      NODE_TYPES.FEATURE_CANDIDATE,
    ]);

    const sequencePatterns = detectSequencePatterns(events, {
      minSupportUsers,
      minSupportSessions,
      minOccurrences,
      sequenceLengths,
    });
    const abandonments = detectAbandonment(events, { timeoutMs: abandonmentTimeoutMs });
    const repetitionClusters = detectRepetitions(events);

    const workflows = applyPatternsToGraph(instance.graph, sequencePatterns, {
      minSupportUsers,
      minSupportSessions,
      minOccurrences,
    });
    const problems = applyAbandonmentToGraph(instance.graph, abandonments, {
      minOccurrences,
      minSupportSessions,
      minSupportUsers,
    });
    const repetitions = applyRepetitionsToGraph(instance.graph, repetitionClusters, {
      minOccurrences: minRepetitionClusters,
      minSupportSessions: minRepetitionSessions,
      minSupportUsers,
    });

    lastDetectionMeta = {
      lastRunAt: Date.now(),
      eventCountAtRun: events.length,
    };

    return {
      sequencePatterns,
      abandonments,
      repetitionClusters,
      workflows,
      problems,
      repetitions,
      graph: instance.graph,
    };
  })();

  try {
    return await activeDetectionPromise;
  } finally {
    activeDetectionPromise = null;
  }
}

/**
 * Ranked, explainable hypotheses produced so far (always status: 'hypothesis').
 */
export function getFeatureCandidates({ limit = 20 } = {}) {
  if (!instance) return [];
  return instance.graph.getNodesByType(NODE_TYPES.FEATURE_CANDIDATE)
    .map(node => ({
      id: node.value,
      kind: node.properties.kind ?? 'workflow',
      category: node.properties.category ?? 'Utilisation',
      rule: node.properties.rule ?? 'Séquence comportementale locale',
      description: node.properties.description,
      occurrences: node.properties.occurrences ?? node.properties.supportSessions ?? 0,
      supportSessions: node.properties.supportSessions ?? 0,
      supportUsers: node.properties.supportUsers ?? 0,
      confidence: node.properties.confidence ?? { score: 0.4, level: 'faible', label: 'Faible' },
      periodLabel: node.properties.periodLabel ?? 'Historique local',
      status: node.properties.status ?? 'hypothesis',
    }))
    .sort((a, b) => (
      (b.confidence?.score || 0) - (a.confidence?.score || 0)
      || b.supportUsers - a.supportUsers
      || b.supportSessions - a.supportSessions
      || b.occurrences - a.occurrences
    ))
    .slice(0, limit);
}

export { createBehaviorTracker } from './behavior-tracker.js';
export { createEventStore } from './event-store.js';
export { createEventGraph, buildEventGraph, NODE_TYPES, RELATIONSHIPS } from './event-graph.js';
export { createSemanticEvent, isSemanticEvent, EVENT_TYPES } from './semantic-event.js';
export {
  detectSequencePatterns,
  detectRepetitions,
  detectAbandonment,
  applyPatternsToGraph,
  applyAbandonmentToGraph,
  applyRepetitionsToGraph,
  describeFeatureCandidate,
  computeBehaviorConfidence,
} from './pattern-detection.js';
