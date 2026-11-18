/**
 * Pattern Detection — Pure analysis layer over semantic events.
 * Produces cautious, explainable hypotheses (WORKFLOW / INTENT / PROBLEM / FEATURE_CANDIDATE)
 * with configurable thresholds for occurrences, distinct sessions, and users.
 */

import { NODE_TYPES, RELATIONSHIPS } from './event-graph.js';

const DEFAULT_SEQUENCE_LENGTHS = [2, 3];
const DEFAULT_MIN_SUPPORT_USERS = 1;
const DEFAULT_MIN_SUPPORT_SESSIONS = 2;
const DEFAULT_MIN_OCCURRENCES = 2;
const REPETITION_WINDOW_MS = 4000;
const DEFAULT_MIN_REPETITIONS = 3;
const DEFAULT_MIN_REPETITION_CLUSTERS = 2;
const ABANDONMENT_TIMEOUT_MS = 180_000;

export function computeBehaviorConfidence({
  occurrences = 0,
  supportSessions = 0,
  supportUsers = 1,
} = {}) {
  const occScore = Math.min(1, occurrences / 6) * 0.45;
  const sessScore = Math.min(1, supportSessions / 4) * 0.45;
  const userBonus = supportUsers > 1 ? Math.min(0.1, (supportUsers - 1) * 0.05) : 0;
  const score = Math.max(0, Math.min(1, occScore + sessScore + userBonus));

  let level = 'faible';
  let label = 'Faible';
  if (score >= 0.72 && supportSessions >= 3 && occurrences >= 4) {
    level = 'élevée';
    label = 'Élevée';
  } else if (score >= 0.45 && supportSessions >= 2 && occurrences >= 2) {
    level = 'moyenne';
    label = 'Moyenne';
  }

  return {
    score: Number(score.toFixed(2)),
    level,
    label,
  };
}

/**
 * Mines recurring ACTION sequences (2-grams & 3-grams) across sessions.
 * Filters by configurable user, session, and occurrence thresholds.
 */
export function detectSequencePatterns(events, {
  sequenceLengths = DEFAULT_SEQUENCE_LENGTHS,
  minSupportUsers = DEFAULT_MIN_SUPPORT_USERS,
  minSupportSessions = DEFAULT_MIN_SUPPORT_SESSIONS,
  minOccurrences = DEFAULT_MIN_OCCURRENCES,
  eventTypeFilter = 'interaction',
} = {}) {
  const bySession = groupBySession(events, eventTypeFilter);
  const patterns = new Map();

  for (const sessionEvents of bySession.values()) {
    const userId = sessionEvents[0]?.userId;
    for (const length of sequenceLengths) {
      for (let i = 0; i + length <= sessionEvents.length; i += 1) {
        const window = sessionEvents.slice(i, i + length);
        const sequence = window.map(event => event.action);
        const key = sequence.join('>');
        const gaps = window
          .slice(1)
          .map((event, idx) => {
            if (Number.isFinite(event.timeSincePreviousAction)) {
              return event.timeSincePreviousAction;
            }
            return Math.max(0, event.timestamp - window[idx].timestamp);
          })
          .filter(gap => Number.isFinite(gap));

        if (!patterns.has(key)) {
          patterns.set(key, {
            sequence,
            sessionIds: new Set(),
            userIds: new Set(),
            occurrences: 0,
            gaps: [],
          });
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
    .map((aggregate) => {
      const supportSessions = aggregate.sessionIds.size;
      const supportUsers = aggregate.userIds.size;
      return {
        sequence: aggregate.sequence,
        supportSessions,
        supportUsers,
        occurrences: aggregate.occurrences,
        avgGapMs: aggregate.gaps.length ? Math.round(average(aggregate.gaps)) : null,
        confidence: computeBehaviorConfidence({
          occurrences: aggregate.occurrences,
          supportSessions,
          supportUsers,
        }),
      };
    })
    .filter(pattern => (
      pattern.supportUsers >= minSupportUsers
      && pattern.supportSessions >= minSupportSessions
      && pattern.occurrences >= minOccurrences
    ))
    .sort((a, b) => (
      b.supportUsers - a.supportUsers
      || b.supportSessions - a.supportSessions
      || b.occurrences - a.occurrences
    ));
}

/**
 * Detects rapid, repeated (action, target) clusters within a short time window.
 * Excludes form_focus and navigate noise by default so normal form tabbing is not misread as rage clicking.
 */
export function detectRepetitions(events, {
  windowMs = REPETITION_WINDOW_MS,
  minRepetitions = DEFAULT_MIN_REPETITIONS,
  eventTypeFilter = 'interaction',
  excludeActions = ['form_focus', 'navigate'],
} = {}) {
  const bySession = groupBySession(events, eventTypeFilter);
  const clusters = [];

  for (const sessionEvents of bySession.values()) {
    const eligible = sessionEvents.filter(e => !excludeActions.includes(e.action) && Boolean(e.target));
    let clusterStart = 0;
    for (let i = 1; i <= eligible.length; i += 1) {
      const previous = eligible[i - 1];
      const current = eligible[i];
      const sameActionTarget = current
        && current.action === previous.action
        && current.target === previous.target
        && current.timestamp - previous.timestamp <= windowMs;

      if (!sameActionTarget) {
        const clusterLength = i - clusterStart;
        if (clusterLength >= minRepetitions) {
          const clusterEvents = eligible.slice(clusterStart, i);
          clusters.push({
            action: clusterEvents[0].action,
            target: clusterEvents[0].target,
            context: clusterEvents[0].context,
            sessionId: clusterEvents[0].sessionId,
            userId: clusterEvents[0].userId,
            repetitions: clusterLength,
            spanMs: clusterEvents.at(-1).timestamp - clusterEvents[0].timestamp,
            timestamp: clusterEvents[0].timestamp,
          });
        }
        clusterStart = i;
      }
    }
  }

  return clusters;
}

/**
 * Detects abandoned form episodes while guarding against:
 * - multiple focus events in the same form episode being counted twice,
 * - slow legitimate form filling (> 60s),
 * - standalone validation errors when the user corrects or remains on the form.
 */
export function detectAbandonment(events, {
  startActions = ['form_focus'],
  endActions = ['form_submit_success'],
  errorActions = ['form_submit_error'],
  timeoutMs = ABANDONMENT_TIMEOUT_MS,
  eventTypeFilter = 'interaction',
} = {}) {
  const bySession = groupBySession(events, eventTypeFilter);
  const abandonments = [];

  for (const sessionEvents of bySession.values()) {
    const activeEpisodes = new Map();

    const matchesEpisode = (ep, event) => {
      const sameContext = ep.context === event.context;
      const sameTarget = !ep.target || !event.target || ep.target === event.target;
      return sameContext && sameTarget;
    };

    const recordEpisode = (ep) => {
      abandonments.push({
        action: ep.action,
        target: ep.target,
        context: ep.context,
        object: ep.object,
        sessionId: ep.sessionId,
        userId: ep.userId,
        timestamp: ep.startTs,
        lastActivityTs: ep.lastActivityTs,
        focusCount: ep.focusCount,
        hadValidationError: ep.hadValidationError,
        interruptedByNavigation: ep.interruptedByNavigation,
      });
    };

    for (const event of sessionEvents) {
      if (startActions.includes(event.action)) {
        const epKey = `${event.target ?? 'form'}@@${event.context ?? 'unknown'}`;
        const existing = activeEpisodes.get(epKey);

        if (existing) {
          if (event.timestamp - existing.lastActivityTs <= timeoutMs) {
            existing.lastActivityTs = event.timestamp;
            existing.focusCount += 1;
            if (!existing.object && event.object) existing.object = event.object;
          } else {
            recordEpisode(existing);
            activeEpisodes.set(epKey, {
              action: event.action,
              target: event.target,
              context: event.context,
              object: event.object,
              sessionId: event.sessionId,
              userId: event.userId,
              startTs: event.timestamp,
              lastActivityTs: event.timestamp,
              focusCount: 1,
              hadValidationError: false,
              interruptedByNavigation: false,
            });
          }
        } else {
          activeEpisodes.set(epKey, {
            action: event.action,
            target: event.target,
            context: event.context,
            object: event.object,
            sessionId: event.sessionId,
            userId: event.userId,
            startTs: event.timestamp,
            lastActivityTs: event.timestamp,
            focusCount: 1,
            hadValidationError: false,
            interruptedByNavigation: false,
          });
        }
        continue;
      }

      if (errorActions.includes(event.action)) {
        for (const ep of activeEpisodes.values()) {
          if (matchesEpisode(ep, event)) {
            ep.lastActivityTs = event.timestamp;
            ep.hadValidationError = true;
          }
        }
        continue;
      }

      if (endActions.includes(event.action)) {
        for (const [epKey, ep] of activeEpisodes.entries()) {
          if (!matchesEpisode(ep, event)) continue;
          if (event.timestamp - ep.lastActivityTs <= timeoutMs) {
            activeEpisodes.delete(epKey);
          } else {
            recordEpisode(ep);
            activeEpisodes.delete(epKey);
          }
        }
        continue;
      }

      if (event.action === 'navigate') {
        for (const ep of activeEpisodes.values()) {
          if (ep.context !== event.context) {
            ep.interruptedByNavigation = true;
          }
        }
      }
    }

    const lastSessionEvent = sessionEvents.at(-1) || null;
    for (const ep of activeEpisodes.values()) {
      // Do not automatically equate a validation error with abandonment if the user
      // just hit a validation check without navigating away or abandoning.
      if (
        ep.hadValidationError
        && !ep.interruptedByNavigation
        && lastSessionEvent
        && errorActions.includes(lastSessionEvent.action)
      ) {
        continue;
      }
      recordEpisode(ep);
    }
  }

  return abandonments;
}

/**
 * Writes recurring workflow sequences into the graph as hypotheses.
 */
export function applyPatternsToGraph(graph, patterns, {
  minSupportUsers = DEFAULT_MIN_SUPPORT_USERS,
  minSupportSessions = DEFAULT_MIN_SUPPORT_SESSIONS,
  minOccurrences = DEFAULT_MIN_OCCURRENCES,
} = {}) {
  const created = [];
  for (const pattern of patterns) {
    if (
      pattern.supportUsers < minSupportUsers
      || pattern.supportSessions < minSupportSessions
      || pattern.occurrences < minOccurrences
      || pattern.sequence.length < 2
    ) {
      continue;
    }

    const workflowId = pattern.sequence.join('_then_');
    const confidence = pattern.confidence || computeBehaviorConfidence(pattern);
    const workflowNode = graph.upsertNode(NODE_TYPES.WORKFLOW, workflowId, {
      sequence: pattern.sequence,
      supportSessions: pattern.supportSessions,
      supportUsers: pattern.supportUsers,
      occurrences: pattern.occurrences,
      avgGapMs: pattern.avgGapMs,
      confidence,
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
      kind: 'workflow',
      category: 'Parcours récurrent',
      rule: `Séquence d’actions (${pattern.sequence.length} étapes, ≥ ${minSupportSessions} sessions)`,
      description,
      occurrences: pattern.occurrences,
      supportUsers: pattern.supportUsers,
      supportSessions: pattern.supportSessions,
      confidence,
      periodLabel: 'Historique local',
      status: 'hypothesis',
    });
    graph.upsertEdge(RELATIONSHIPS.SUGGESTS, workflowNode, featureNode);
    graph.upsertEdge(RELATIONSHIPS.SUGGESTS, intentNode, featureNode);

    created.push({ workflowNode, intentNode, featureNode, description });
  }
  return created;
}

/**
 * Writes detected abandonment clusters into the graph as PROBLEM / FEATURE_CANDIDATE hypotheses.
 */
export function applyAbandonmentToGraph(graph, abandonments, {
  minOccurrences = DEFAULT_MIN_OCCURRENCES,
  minSupportSessions = DEFAULT_MIN_SUPPORT_SESSIONS,
  minSupportUsers = DEFAULT_MIN_SUPPORT_USERS,
} = {}) {
  const byActionContext = new Map();
  for (const record of abandonments) {
    const key = `${record.action}@${record.context ?? 'unknown'}`;
    if (!byActionContext.has(key)) {
      byActionContext.set(key, {
        ...record,
        targets: new Set(),
        sessionIds: new Set(),
        userIds: new Set(),
        count: 0,
      });
    }
    const aggregate = byActionContext.get(key);
    aggregate.count += 1;
    if (record.target) aggregate.targets.add(record.target);
    if (record.sessionId) aggregate.sessionIds.add(record.sessionId);
    if (record.userId) aggregate.userIds.add(record.userId);
  }

  const created = [];
  for (const aggregate of byActionContext.values()) {
    if (
      aggregate.count < minOccurrences
      || aggregate.sessionIds.size < minSupportSessions
      || aggregate.userIds.size < minSupportUsers
    ) {
      continue;
    }

    const actionNode = graph.getNode(NODE_TYPES.ACTION, aggregate.action)
      ?? graph.upsertNode(NODE_TYPES.ACTION, aggregate.action, {});
    const problemId = `abandonment_${aggregate.action}_${aggregate.context ?? 'unknown'}`;
    const confidence = computeBehaviorConfidence({
      occurrences: aggregate.count,
      supportSessions: aggregate.sessionIds.size,
      supportUsers: aggregate.userIds.size,
    });

    const problemNode = graph.upsertNode(NODE_TYPES.PROBLEM, problemId, {
      action: aggregate.action,
      context: aggregate.context,
      targets: [...aggregate.targets],
      occurrences: aggregate.count,
      supportSessions: aggregate.sessionIds.size,
      supportUsers: aggregate.userIds.size,
      confidence,
    });
    graph.upsertEdge(RELATIONSHIPS.INDICATES, actionNode, problemNode);

    const targetLabel = aggregate.targets.size
      ? [...aggregate.targets].join(', ')
      : aggregate.action;
    const contextPart = aggregate.context ? ` dans « ${aggregate.context} »` : '';
    const featureCandidateId = `reduce_friction_${problemId}`;
    const description = `Cette interruption de saisie (« ${targetLabel} »${contextPart}) a été observée `
      + `${aggregate.count} fois sur ${aggregate.sessionIds.size} sessions. `
      + `Cela pourrait indiquer un point de friction à examiner.`;

    const featureNode = graph.upsertNode(NODE_TYPES.FEATURE_CANDIDATE, featureCandidateId, {
      kind: 'abandonment',
      category: 'Formulaire interrompu',
      rule: `Saisie interrompue sans validation (≥ ${minOccurrences} occurrences, ≥ ${minSupportSessions} sessions)`,
      description,
      occurrences: aggregate.count,
      supportSessions: aggregate.sessionIds.size,
      supportUsers: aggregate.userIds.size,
      confidence,
      periodLabel: 'Historique local',
      status: 'hypothesis',
    });
    graph.upsertEdge(RELATIONSHIPS.SUGGESTS, problemNode, featureNode);

    created.push({ problemNode, featureNode, description });
  }
  return created;
}

/**
 * Writes rapid click / interaction repetition clusters into the graph as cautious UI friction hypotheses.
 */
export function applyRepetitionsToGraph(graph, clusters, {
  minOccurrences = DEFAULT_MIN_REPETITION_CLUSTERS,
  minSupportSessions = 1,
  minSupportUsers = DEFAULT_MIN_SUPPORT_USERS,
} = {}) {
  const byTarget = new Map();
  for (const cluster of clusters) {
    const key = `${cluster.action}@${cluster.target ?? 'unknown'}@${cluster.context ?? 'unknown'}`;
    if (!byTarget.has(key)) {
      byTarget.set(key, {
        action: cluster.action,
        target: cluster.target,
        context: cluster.context,
        clusterCount: 0,
        totalRepetitions: 0,
        sessionIds: new Set(),
        userIds: new Set(),
      });
    }
    const agg = byTarget.get(key);
    agg.clusterCount += 1;
    agg.totalRepetitions += Number(cluster.repetitions) || 1;
    if (cluster.sessionId) agg.sessionIds.add(cluster.sessionId);
    if (cluster.userId) agg.userIds.add(cluster.userId);
  }

  const created = [];
  for (const agg of byTarget.values()) {
    if (
      agg.clusterCount < minOccurrences
      || agg.sessionIds.size < minSupportSessions
      || agg.userIds.size < minSupportUsers
    ) {
      continue;
    }

    const actionNode = graph.getNode(NODE_TYPES.ACTION, agg.action)
      ?? graph.upsertNode(NODE_TYPES.ACTION, agg.action, {});
    const safeTarget = agg.target ?? 'unknown';
    const safeContext = agg.context ?? 'unknown';
    const problemId = `repetition_${agg.action}_${safeTarget}_${safeContext}`;
    const confidence = computeBehaviorConfidence({
      occurrences: agg.clusterCount,
      supportSessions: agg.sessionIds.size,
      supportUsers: agg.userIds.size,
    });

    const problemNode = graph.upsertNode(NODE_TYPES.PROBLEM, problemId, {
      action: agg.action,
      target: agg.target,
      context: agg.context,
      clusterCount: agg.clusterCount,
      totalRepetitions: agg.totalRepetitions,
      supportSessions: agg.sessionIds.size,
      supportUsers: agg.userIds.size,
      confidence,
    });
    graph.upsertEdge(RELATIONSHIPS.INDICATES, actionNode, problemNode);

    const contextPart = agg.context ? ` (écran « ${agg.context} »)` : '';
    const featureCandidateId = `examine_repetition_${agg.action}_${safeTarget}_${safeContext}`;
    const description = `Des clics répétés rapidement sur « ${safeTarget} »${contextPart} ont été observés `
      + `${agg.clusterCount} fois (${agg.totalRepetitions} clics cumulés sur ${agg.sessionIds.size} session${agg.sessionIds.size > 1 ? 's' : ''}). `
      + `Cela pourrait indiquer un manque de retour visuel ou un point de friction de l’interface.`;

    const featureNode = graph.upsertNode(NODE_TYPES.FEATURE_CANDIDATE, featureCandidateId, {
      kind: 'repetition',
      category: 'Répétitions rapides',
      rule: `Rafale de clics (≥ ${DEFAULT_MIN_REPETITIONS} en ${REPETITION_WINDOW_MS / 1000}s, ≥ ${minOccurrences} épisodes)`,
      description,
      occurrences: agg.clusterCount,
      supportSessions: agg.sessionIds.size,
      supportUsers: agg.userIds.size,
      confidence,
      periodLabel: 'Historique local',
      status: 'hypothesis',
    });
    graph.upsertEdge(RELATIONSHIPS.SUGGESTS, problemNode, featureNode);

    created.push({ problemNode, featureNode, description });
  }
  return created;
}

/** Human-readable cautious hypothesis text for recurring action workflows. */
export function describeFeatureCandidate(pattern) {
  const steps = pattern.sequence.join(' → ');
  const occurrences = pattern.occurrences ?? pattern.supportSessions ?? 1;
  const sessions = pattern.supportSessions ?? 1;

  if (pattern.supportUsers <= 1) {
    return `Cette séquence a été observée ${occurrences} fois sur ${sessions} session${sessions > 1 ? 's' : ''} : ${steps}. `
      + `Une action rapide combinant ces étapes pourrait simplifier ce parcours.`;
  }
  return `${pattern.supportUsers} utilisateurs répètent ce workflow (${occurrences} fois sur ${sessions} sessions) : ${steps}. `
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
