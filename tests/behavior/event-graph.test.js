import { describe, it, expect } from 'vitest';
import { createEventGraph, buildEventGraph, NODE_TYPES, RELATIONSHIPS } from '../../src/core/behavior/event-graph.js';
import { createSemanticEvent } from '../../src/core/behavior/semantic-event.js';

function event(overrides) {
  return createSemanticEvent({
    action: 'click', sessionId: 's1', userId: 'u1', timestamp: 1000,
    ...overrides,
  });
}

describe('event graph: node creation', () => {
  it('creates USER, SESSION and ACTION nodes for a single event', () => {
    const graph = createEventGraph();
    graph.addEvent(event({ target: 'export-button', context: 'dashboard', object: 'time_entry' }));

    expect(graph.getNode(NODE_TYPES.USER, 'u1')).toBeTruthy();
    expect(graph.getNode(NODE_TYPES.SESSION, 's1')).toBeTruthy();
    expect(graph.getNode(NODE_TYPES.ACTION, 'click')).toBeTruthy();
    expect(graph.getNode(NODE_TYPES.TARGET, 'export-button')).toBeTruthy();
    expect(graph.getNode(NODE_TYPES.CONTEXT, 'dashboard')).toBeTruthy();
    expect(graph.getNode(NODE_TYPES.OBJECT, 'time_entry')).toBeTruthy();
  });

  it('does not create TARGET/OBJECT/CONTEXT nodes when absent', () => {
    const graph = createEventGraph();
    graph.addEvent(event({}));
    expect(graph.getNodesByType(NODE_TYPES.TARGET)).toHaveLength(0);
    expect(graph.getNodesByType(NODE_TYPES.OBJECT)).toHaveLength(0);
    expect(graph.getNodesByType(NODE_TYPES.CONTEXT)).toHaveLength(0);
  });

  it('increments node weight on repeated occurrences', () => {
    const graph = createEventGraph();
    graph.addEvent(event({ timestamp: 1000 }));
    graph.addEvent(event({ timestamp: 2000 }));
    expect(graph.getNode(NODE_TYPES.ACTION, 'click').weight).toBe(2);
  });
});

describe('event graph: relationships', () => {
  it('wires PERFORMS, TARGETS, OPERATES_ON, OCCURS_IN, PART_OF', () => {
    const graph = createEventGraph();
    graph.addEvent(event({ target: 'export-button', context: 'dashboard', object: 'time_entry' }));

    const user = graph.getNode(NODE_TYPES.USER, 'u1');
    const session = graph.getNode(NODE_TYPES.SESSION, 's1');
    const action = graph.getNode(NODE_TYPES.ACTION, 'click');
    const target = graph.getNode(NODE_TYPES.TARGET, 'export-button');
    const object = graph.getNode(NODE_TYPES.OBJECT, 'time_entry');
    const context = graph.getNode(NODE_TYPES.CONTEXT, 'dashboard');

    expect(graph.getEdgesFrom(user.id, RELATIONSHIPS.PERFORMS).map(e => e.to)).toContain(action.id);
    expect(graph.getEdgesFrom(session.id, RELATIONSHIPS.PART_OF).map(e => e.to)).toContain(user.id);
    expect(graph.getEdgesFrom(action.id, RELATIONSHIPS.TARGETS).map(e => e.to)).toContain(target.id);
    expect(graph.getEdgesFrom(action.id, RELATIONSHIPS.OPERATES_ON).map(e => e.to)).toContain(object.id);
    expect(graph.getEdgesFrom(action.id, RELATIONSHIPS.OCCURS_IN).map(e => e.to)).toContain(context.id);
  });

  it('builds FOLLOWS/PRECEDES edges between consecutive actions in a session', () => {
    const graph = createEventGraph();
    graph.addEvent(event({ action: 'search', timestamp: 1000 }));
    graph.addEvent(event({ action: 'filter', timestamp: 3400, previousAction: 'search', timeSincePreviousAction: 2400 }));

    const search = graph.getNode(NODE_TYPES.ACTION, 'search');
    const filter = graph.getNode(NODE_TYPES.ACTION, 'filter');

    const follows = graph.getEdgesFrom(filter.id, RELATIONSHIPS.FOLLOWS);
    expect(follows).toHaveLength(1);
    expect(follows[0].to).toBe(search.id);
    expect(follows[0].meta.avgGapMs).toBe(2400);

    const precedes = graph.getEdgesFrom(search.id, RELATIONSHIPS.PRECEDES);
    expect(precedes).toHaveLength(1);
    expect(precedes[0].to).toBe(filter.id);
  });

  it('does not add a self-referencing FOLLOWS edge for repeated identical actions', () => {
    const graph = createEventGraph();
    graph.addEvent(event({ action: 'click', target: 'export-button', timestamp: 1000 }));
    graph.addEvent(event({ action: 'click', target: 'export-button', timestamp: 1200, previousAction: 'click', timeSincePreviousAction: 200 }));
    const click = graph.getNode(NODE_TYPES.ACTION, 'click');
    expect(graph.getEdgesFrom(click.id, RELATIONSHIPS.FOLLOWS)).toHaveLength(0);
  });

  it('averages the gap across repeated FOLLOWS observations', () => {
    const graph = createEventGraph();
    graph.addEvent(event({ action: 'search', sessionId: 's1', timestamp: 0 }));
    graph.addEvent(event({ action: 'filter', sessionId: 's1', timestamp: 1000, previousAction: 'search', timeSincePreviousAction: 1000 }));
    graph.addEvent(event({ action: 'search', sessionId: 's2', userId: 'u2', timestamp: 0 }));
    graph.addEvent(event({ action: 'filter', sessionId: 's2', userId: 'u2', timestamp: 3000, previousAction: 'search', timeSincePreviousAction: 3000 }));

    const filter = graph.getNode(NODE_TYPES.ACTION, 'filter');
    const search = graph.getNode(NODE_TYPES.ACTION, 'search');
    const edge = graph.getEdgesFrom(filter.id, RELATIONSHIPS.FOLLOWS).find(e => e.to === search.id);
    expect(edge.weight).toBe(2);
    expect(edge.meta.avgGapMs).toBe(2000);
    expect(edge.meta.minGapMs).toBe(1000);
    expect(edge.meta.maxGapMs).toBe(3000);
  });
});

describe('buildEventGraph / toJSON', () => {
  it('builds a graph from an unordered event list (sorted internally by timestamp)', () => {
    const graph = buildEventGraph([
      event({ action: 'export', timestamp: 5000, previousAction: 'filter', timeSincePreviousAction: 1000 }),
      event({ action: 'filter', timestamp: 4000, previousAction: 'search', timeSincePreviousAction: 800 }),
      event({ action: 'search', timestamp: 3200 }),
    ]);
    expect(graph.nodeCount).toBeGreaterThan(0);
    const json = graph.toJSON();
    expect(json.nodes.length).toBe(graph.nodeCount);
    expect(json.edges.length).toBe(graph.edgeCount);
  });
});
