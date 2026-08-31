/**
 * Semantic Event Graph.
 *
 * Node types:   USER, SESSION, ACTION, TARGET, OBJECT, CONTEXT, WORKFLOW,
 *               INTENT, PROBLEM, FEATURE_CANDIDATE
 * Relationships: PERFORMS, TARGETS, FOLLOWS, PRECEDES, OCCURS_IN,
 *                OPERATES_ON, INDICATES, PART_OF, SUGGESTS
 *
 * The graph aggregates facts rather than storing one node per event: e.g.
 * there is a single ACTION node for "click", accumulating a weight each
 * time any user performs it, plus per-relationship weights (how often it
 * targets a given TARGET, occurs in a given CONTEXT, etc). This is what
 * lets pattern detection ask "how many distinct users did A→B→C" instead
 * of re-deriving it from the raw event log every time.
 *
 * Kept deliberately storage-agnostic: it operates on plain semantic events
 * already in memory (from the Event Store) and exposes a serializable
 * shape, so it can be persisted, sent to a future server-side pattern/AI
 * step, or rebuilt on demand without depending on IndexedDB itself.
 */

export const NODE_TYPES = Object.freeze({
  USER: 'USER',
  SESSION: 'SESSION',
  ACTION: 'ACTION',
  TARGET: 'TARGET',
  OBJECT: 'OBJECT',
  CONTEXT: 'CONTEXT',
  WORKFLOW: 'WORKFLOW',
  INTENT: 'INTENT',
  PROBLEM: 'PROBLEM',
  FEATURE_CANDIDATE: 'FEATURE_CANDIDATE',
});

export const RELATIONSHIPS = Object.freeze({
  PERFORMS: 'PERFORMS',
  TARGETS: 'TARGETS',
  FOLLOWS: 'FOLLOWS',
  PRECEDES: 'PRECEDES',
  OCCURS_IN: 'OCCURS_IN',
  OPERATES_ON: 'OPERATES_ON',
  INDICATES: 'INDICATES',
  PART_OF: 'PART_OF',
  SUGGESTS: 'SUGGESTS',
});

function nodeKey(type, id) { return `${type}:${id}`; }
function edgeKey(type, fromKey, toKey) { return `${type}|${fromKey}|${toKey}`; }

export function createEventGraph() {
  /** @type {Map<string, object>} */
  const nodes = new Map();
  /** @type {Map<string, object>} */
  const edges = new Map();
  // Per-session cursor, needed to build FOLLOWS/PRECEDES sequence edges
  // even when events are added out of causal order isn't expected, but we
  // still track explicitly rather than relying on event.previousAction
  // alone, since that field is set by the tracker (see behavior-tracker.js)
  // and may be absent for the very first event of a session.
  const lastActionBySession = new Map();
  const edgesByFrom = new Map();
  const edgesByTo = new Map();

  function indexEdge(edge) {
    if (!edgesByFrom.has(edge.from)) edgesByFrom.set(edge.from, []);
    edgesByFrom.get(edge.from).push(edge);
    if (!edgesByTo.has(edge.to)) edgesByTo.set(edge.to, []);
    edgesByTo.get(edge.to).push(edge);
  }

  function upsertNode(type, id, properties = {}) {
    if (!id) return null;
    const key = nodeKey(type, id);
    const existing = nodes.get(key);
    if (existing) {
      existing.weight += 1;
      existing.lastSeen = properties.timestamp ?? existing.lastSeen;
      Object.assign(existing.properties, properties);
      return existing;
    }
    const node = {
      id: key,
      type,
      value: id,
      weight: 1,
      firstSeen: properties.timestamp ?? Date.now(),
      lastSeen: properties.timestamp ?? Date.now(),
      properties: { ...properties },
    };
    nodes.set(key, node);
    return node;
  }

  function upsertEdge(type, fromNode, toNode, { weightIncrement = 1, meta } = {}) {
    if (!fromNode || !toNode) return null;
    const key = edgeKey(type, fromNode.id, toNode.id);
    const existing = edges.get(key);
    if (existing) {
      existing.weight += weightIncrement;
      if (meta) mergeEdgeMeta(existing, meta);
      return existing;
    }
    const edge = {
      id: key,
      type,
      from: fromNode.id,
      to: toNode.id,
      weight: weightIncrement,
      meta: meta ? { ...meta } : {},
    };
    if (meta?.gapMs !== undefined) {
      edge.meta.avgGapMs = meta.gapMs;
      edge.meta.minGapMs = meta.gapMs;
      edge.meta.maxGapMs = meta.gapMs;
      delete edge.meta.gapMs;
    }
    edges.set(key, edge);
    indexEdge(edge);
    return edge;
  }

  function mergeEdgeMeta(edge, meta) {
    if (meta.gapMs === undefined) return;
    const previousAvg = edge.meta.avgGapMs ?? meta.gapMs;
    const previousCount = edge.weight - 1;
    edge.meta.avgGapMs = Math.round((previousAvg * previousCount + meta.gapMs) / edge.weight);
    edge.meta.minGapMs = Math.min(edge.meta.minGapMs ?? meta.gapMs, meta.gapMs);
    edge.meta.maxGapMs = Math.max(edge.meta.maxGapMs ?? meta.gapMs, meta.gapMs);
  }

  /** Incrementally folds one semantic event into the graph. */
  function addEvent(event) {
    const userNode = upsertNode(NODE_TYPES.USER, event.userId, { timestamp: event.timestamp });
    const sessionNode = upsertNode(NODE_TYPES.SESSION, event.sessionId, { timestamp: event.timestamp });
    upsertEdge(RELATIONSHIPS.PART_OF, sessionNode, userNode);

    const actionNode = upsertNode(NODE_TYPES.ACTION, event.action, { timestamp: event.timestamp, eventType: event.type });
    upsertEdge(RELATIONSHIPS.PERFORMS, userNode, actionNode);

    if (event.target) {
      const targetNode = upsertNode(NODE_TYPES.TARGET, event.target, { timestamp: event.timestamp });
      upsertEdge(RELATIONSHIPS.TARGETS, actionNode, targetNode);
    }

    if (event.object) {
      const objectNode = upsertNode(NODE_TYPES.OBJECT, event.object, { timestamp: event.timestamp });
      upsertEdge(RELATIONSHIPS.OPERATES_ON, actionNode, objectNode);
    }

    if (event.context) {
      const contextNode = upsertNode(NODE_TYPES.CONTEXT, event.context, { timestamp: event.timestamp });
      upsertEdge(RELATIONSHIPS.OCCURS_IN, actionNode, contextNode);
    }

    const previousInSession = lastActionBySession.get(event.sessionId);
    const previousActionId = event.previousAction ?? previousInSession?.action ?? null;
    if (previousActionId && previousActionId !== event.action) {
      const previousNode = upsertNode(NODE_TYPES.ACTION, previousActionId, {});
      const gapMs = event.timeSincePreviousAction ?? (
        previousInSession ? event.timestamp - previousInSession.timestamp : undefined
      );
      upsertEdge(RELATIONSHIPS.FOLLOWS, actionNode, previousNode, { meta: gapMs !== undefined ? { gapMs } : undefined });
      upsertEdge(RELATIONSHIPS.PRECEDES, previousNode, actionNode, { meta: gapMs !== undefined ? { gapMs } : undefined });
    }
    lastActionBySession.set(event.sessionId, { action: event.action, timestamp: event.timestamp });

    return { userNode, sessionNode, actionNode };
  }

  function addEvents(events) {
    for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) addEvent(event);
  }

  function getNode(type, id) { return nodes.get(nodeKey(type, id)) ?? null; }
  function getNodesByType(type) { return [...nodes.values()].filter(node => node.type === type); }
  function getEdgesFrom(nodeId, type = null) {
    const candidates = edgesByFrom.get(nodeId) ?? [];
    return type ? candidates.filter(edge => edge.type === type) : [...candidates];
  }
  function getEdgesTo(nodeId, type = null) {
    const candidates = edgesByTo.get(nodeId) ?? [];
    return type ? candidates.filter(edge => edge.type === type) : [...candidates];
  }

  function toJSON() {
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  return {
    addEvent,
    addEvents,
    upsertNode,
    upsertEdge,
    getNode,
    getNodesByType,
    getEdgesFrom,
    getEdgesTo,
    toJSON,
    get nodeCount() { return nodes.size; },
    get edgeCount() { return edges.size; },
  };
}

/** Convenience: build a fresh graph from a flat list of semantic events. */
export function buildEventGraph(events) {
  const graph = createEventGraph();
  graph.addEvents(events);
  return graph;
}
