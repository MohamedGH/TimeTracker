/**
 * Pattern Detection — the layer between the Semantic Event Graph and the
 * (not-yet-built) AI Feature Discovery step. It only produces *hypotheses*:
 * WORKFLOW / INTENT / PROBLEM / FEATURE_CANDIDATE nodes with support
 * counts attached, never an auto-applied product decision.
 *
 * Everything here is a pure function over an array of semantic events (or
 * an existing graph): no DOM, no IndexedDB, fully unit-testable.
 */

import { NODE_TYPES, RELATIONSHIPS } from './event-graph.js';

const DEFAULT_SEQUENCE_LENGTHS = [2, 3];
const DEFAULT_MIN_SUPPORT_USERS = 2;
const REPETITION_WINDOW_MS = 4000;
const DEFAULT_MIN_REPETITIONS = 3;
const ABANDONMENT_TIMEOUT_MS = 60_000;

/**
 * Mines recurring ACTION sequences (n-grams) across sessions.
 * @returns {Array<{ sequence: string[], supportSessions: number, supportUsers: number, occurrences: number, avgGapMs: number|null }>}
 */
export function detectSequencePatterns(events, {
  sequenceLengths = DEFAULT_SEQUENCE_LENGTHS,
  minSupportUsers = DEFAULT_MIN_SUPPORT_USERS,
  eventTypeFilter = 'interaction',
} = {}) {
  const bySession = groupBySession(events, eventTypeFilter);
  const patterns = new Map(); // key: sequence.join('>') -> aggregate

  for (const sessionEvents of bySession.values()) {
    const userId = sessionEvents[0]?.userId;
    for (const length of sequenceLengths) {
      for (let i = 0; i + length <= sessionEvents.length; i += 1) {
        const window = sessionEvents.slice(i, i + length);
        const sequence = window.map(event => event.action);
        const key = sequence.join('>');
        const gaps = window.slice(1).map(event => event.timeSincePreviousAction).filter(gap => Number.isFinite(gap));

        if (!patterns.has(key)) {
          patterns.set(key, { sequence, sessionIds: new Set(), userIds: new Set(), occurrences: 0, gaps: [] });
        }
        const aggregate = patterns.get(key);
        aggregate.sessionIds.add(window[0].sessionId);
        if (userId) aggregate.userIds.add(userId);
        aggregate.occurrences += 1;
        aggregate.gaps.push(...gaps);
      }
    }
  }

  return [...patterns.values()]
    .map(aggregate => ({
      sequence: aggregate.sequence,
      supportSessions: aggregate.sessionIds.size,
      supportUsers: aggregate.userIds.size,
      occurrences: aggregate.occurrences,
      avgGapMs: aggregate.gaps.length ? Math.round(average(aggregate.gaps)) : null,
    }))
    .filter(pattern => pattern.supportUsers >= minSupportUsers)
    .sort((a, b) => b.supportUsers - a.supportUsers || b.occurrences - a.occurrences);
}

/**
 * Detects rapid, repeated (action, target) pairs by the same user — a
 * common signal of friction (e.g. "rage clicking" a button that doesn't
 * seem to respond) rather than of a deliberate workflow.
 */
export function detectRepetitions(events, {
  windowMs = REPETITION_WINDOW_MS,
  minRepetitions = DEFAULT_MIN_REPETITIONS,
  eventTypeFilter = 'interaction',
} = {}) {
  const bySession = groupBySession(events, eventTypeFilter);
  const clusters = [];

  for (const sessionEvents of bySession.values()) {
    let clusterStart = 0;
    for (let i = 1; i <= sessionEvents.length; i += 1) {
      const previous = sessionEvents[i - 1];
      const current = sessionEvents[i];
      const sameActionTarget = current
        && current.action === previous.action
        && current.target === previous.target
        && current.timestamp - previous.timestamp <= windowMs;

      if (!sameActionTarget) {
        const clusterLength = i - clusterStart;
        if (clusterLength >= minRepetitions) {
          const clusterEvents = sessionEvents.slice(clusterStart, i);
          clusters.push({
            action: clusterEvents[0].action,
            target: clusterEvents[0].target,
            context: clusterEvents[0].context,
            sessionId: clusterEvents[0].sessionId,
            userId: clusterEvents[0].userId,
            repetitions: clusterLength,
            spanMs: clusterEvents.at(-1).timestamp - clusterEvents[0].timestamp,
          });
        }
        clusterStart = i;
      }
    }
  }

  return clusters;
}

/**
 * Detects abandoned workflows: a `form_focus` (or any action passed via
 * `startActions`) with no matching completion action (`endActions`) in the
 * same session within `timeoutMs`, before the session's next context
 * switch or its last recorded event.
 */
export function detectAbandonment(events, {
  startActions = ['form_focus'],
  endActions = ['form_submit_success'],
  timeoutMs = ABANDONMENT_TIMEOUT_MS,
  eventTypeFilter = 'interaction',
} = {}) {
  const bySession = groupBySession(events, eventTypeFilter);
  const abandonments = [];

  for (const sessionEvents of bySession.values()) {
    for (let i = 0; i < sessionEvents.length; i += 1) {
      const startEvent = sessionEvents[i];
      if (!startActions.includes(startEvent.action)) continue;

      const completed = sessionEvents.slice(i + 1).some(event =>
        endActions.includes(event.action)
        && event.context === startEvent.context
        && event.timestamp - startEvent.timestamp <= timeoutMs,
      );
      if (completed) continue;

      abandonments.push({
        action: startEvent.action,
        target: startEvent.target,
        context: startEvent.context,
        object: startEvent.object,
        sessionId: startEvent.sessionId,
        userId: startEvent.userId,
        timestamp: startEvent.timestamp,
      });
    }
  }

  return abandonments;
}

/**
 * Writes detected sequence patterns into the graph as WORKFLOW/INTENT
 * hypotheses, each pointing to a FEATURE_CANDIDATE with a human-readable
 * suggestion. Safe to call repeatedly as more data comes in.
 */
export function applyPatternsToGraph(graph, patterns, { minSupportUsers = DEFAULT_MIN_SUPPORT_USERS } = {}) {
  const created = [];
  for (const pattern of patterns) {
    if (pattern.supportUsers < minSupportUsers || pattern.sequence.length < 2) continue;

    const workflowId = pattern.sequence.join('_then_');
    const workflowNode = graph.upsertNode(NODE_TYPES.WORKFLOW, workflowId, {
      sequence: pattern.sequence,
      supportSessions: pattern.supportSessions,
      supportUsers: pattern.supportUsers,
      occurrences: pattern.occurrences,
      avgGapMs: pattern.avgGapMs,
    });

    for (const action of pattern.sequence) {
      const actionNode = graph.getNode(NODE_TYPES.ACTION, action) ?? graph.upsertNode(NODE_TYPES.ACTION, action, {});
      graph.upsertEdge(RELATIONSHIPS.PART_OF, actionNode, workflowNode);
    }

    const intentId = deriveIntentId(pattern.sequence);
    const intentNode = graph.upsertNode(NODE_TYPES.INTENT, intentId, { sequence: pattern.sequence });
    graph.upsertEdge(RELATIONSHIPS.INDICATES, workflowNode, intentNode);

    const featureCandidateId = `simplify_${workflowId}`;
    const description = describeFeatureCandidate(pattern);
    const featureNode = graph.upsertNode(NODE_TYPES.FEATURE_CANDIDATE, featureCandidateId, {
      description,
      supportUsers: pattern.supportUsers,
      supportSessions: pattern.supportSessions,
      status: 'hypothesis', // never auto-applied; a human reviews these
    });
    graph.upsertEdge(RELATIONSHIPS.SUGGESTS, workflowNode, featureNode);
    graph.upsertEdge(RELATIONSHIPS.SUGGESTS, intentNode, featureNode);

    created.push({ workflowNode, intentNode, featureNode, description });
  }
  return created;
}

/**
 * Writes detected abandonment clusters into the graph as a PROBLEM,
 * pointing to a FEATURE_CANDIDATE hypothesis.
 */
export function applyAbandonmentToGraph(graph, abandonments, { minOccurrences = DEFAULT_MIN_SUPPORT_USERS } = {}) {
  const byActionContext = new Map();
  for (const record of abandonments) {
    const key = `${record.action}@${record.context ?? 'unknown'}`;
    if (!byActionContext.has(key)) byActionContext.set(key, { ...record, userIds: new Set(), count: 0 });
    const aggregate = byActionContext.get(key);
    aggregate.count += 1;
    aggregate.userIds.add(record.userId);
  }

  const created = [];
  for (const aggregate of byActionContext.values()) {
    if (aggregate.userIds.size < minOccurrences) continue;

    const actionNode = graph.getNode(NODE_TYPES.ACTION, aggregate.action) ?? graph.upsertNode(NODE_TYPES.ACTION, aggregate.action, {});
    const problemId = `abandonment_${aggregate.action}_${aggregate.context ?? 'unknown'}`;
    const problemNode = graph.upsertNode(NODE_TYPES.PROBLEM, problemId, {
      action: aggregate.action,
      context: aggregate.context,
      occurrences: aggregate.count,
      supportUsers: aggregate.userIds.size,
    });
    graph.upsertEdge(RELATIONSHIPS.INDICATES, actionNode, problemNode);

    const featureCandidateId = `reduce_friction_${problemId}`;
    const description = `${aggregate.userIds.size} utilisateurs abandonnent après "${aggregate.action}"`
      + (aggregate.context ? ` dans "${aggregate.context}"` : '')
      + `. Cela peut indiquer un point de friction à examiner.`;
    const featureNode = graph.upsertNode(NODE_TYPES.FEATURE_CANDIDATE, featureCandidateId, {
      description,
      supportUsers: aggregate.userIds.size,
      status: 'hypothesis',
    });
    graph.upsertEdge(RELATIONSHIPS.SUGGESTS, problemNode, featureNode);

    created.push({ problemNode, featureNode, description });
  }
  return created;
}

/** Human-readable hypothesis text, e.g. the "Search → Filter → Export" example from the design brief. */
export function describeFeatureCandidate(pattern) {
  const steps = pattern.sequence.join(' → ');
  return `${pattern.supportUsers} utilisateurs répètent ce workflow : ${steps}. `
    + `Une fonctionnalité combinant ces étapes pourrait simplifier ce comportement.`;
}

function deriveIntentId(sequence) {
  return `intent_${sequence.join('_')}`;
}

function groupBySession(events, eventTypeFilter) {
  const bySession = new Map();
  const filtered = eventTypeFilter ? events.filter(event => event.type === eventTypeFilter) : events;
  for (const event of [...filtered].sort((a, b) => a.timestamp - b.timestamp)) {
    if (!bySession.has(event.sessionId)) bySession.set(event.sessionId, []);
    bySession.get(event.sessionId).push(event);
  }
  return bySession;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
