import { describe, it, expect } from 'vitest';
import {
  detectSequencePatterns, detectRepetitions, detectAbandonment,
  applyPatternsToGraph, applyAbandonmentToGraph, describeFeatureCandidate,
} from '../../src/core/behavior/pattern-detection.js';
import { createEventGraph, NODE_TYPES, RELATIONSHIPS } from '../../src/core/behavior/event-graph.js';
import { createSemanticEvent } from '../../src/core/behavior/semantic-event.js';

function seq(userId, sessionId, actions, startTs = 0, gapMs = 1000) {
  return actions.map((action, i) => createSemanticEvent({
    action,
    sessionId,
    userId,
    timestamp: startTs + i * gapMs,
    previousAction: i > 0 ? actions[i - 1] : null,
    timeSincePreviousAction: i > 0 ? gapMs : null,
  }));
}

describe('detectSequencePatterns', () => {
  it('finds the canonical Search -> Filter -> Export workflow across multiple users', () => {
    const events = [
      ...seq('u1', 's1', ['search', 'filter', 'export']),
      ...seq('u2', 's2', ['search', 'filter', 'export']),
      ...seq('u3', 's3', ['search', 'filter', 'export']),
    ];
    const patterns = detectSequencePatterns(events, { sequenceLengths: [3], minSupportUsers: 2 });
    const trigram = patterns.find(p => p.sequence.join('>') === 'search>filter>export');
    expect(trigram).toBeTruthy();
    expect(trigram.supportUsers).toBe(3);
    expect(trigram.supportSessions).toBe(3);
    expect(trigram.avgGapMs).toBe(1000);
  });

  it('excludes patterns below the minimum user support', () => {
    const events = seq('u1', 's1', ['search', 'filter', 'export']);
    const patterns = detectSequencePatterns(events, { sequenceLengths: [3], minSupportUsers: 2 });
    expect(patterns).toHaveLength(0);
  });

  it('does not mix actions from different sessions into one sequence', () => {
    const events = [...seq('u1', 's1', ['search']), ...seq('u2', 's2', ['export'])];
    const patterns = detectSequencePatterns(events, { sequenceLengths: [2], minSupportUsers: 1 });
    expect(patterns.some(p => p.sequence.join('>') === 'search>export')).toBe(false);
  });

  it('ignores non-interaction event types by default', () => {
    const events = [
      createSemanticEvent({ type: 'error', action: 'js_error', sessionId: 's1', userId: 'u1', timestamp: 0 }),
      ...seq('u1', 's1', ['search', 'filter']),
    ];
    const patterns = detectSequencePatterns(events, { sequenceLengths: [2], minSupportUsers: 1 });
    expect(patterns.every(p => !p.sequence.includes('js_error'))).toBe(true);
  });
});

describe('detectRepetitions', () => {
  it('flags rapid repeated clicks on the same target as a cluster', () => {
    const events = ['a', 'b', 'c'].map((_, i) => createSemanticEvent({
      action: 'click', target: 'submit-button', sessionId: 's1', userId: 'u1', timestamp: i * 500,
    }));
    const clusters = detectRepetitions(events, { minRepetitions: 3, windowMs: 1000 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ action: 'click', target: 'submit-button', repetitions: 3 });
  });

  it('does not flag clicks spaced further apart than the window', () => {
    const events = [0, 5000, 10000].map(ts => createSemanticEvent({
      action: 'click', target: 'submit-button', sessionId: 's1', userId: 'u1', timestamp: ts,
    }));
    const clusters = detectRepetitions(events, { minRepetitions: 3, windowMs: 1000 });
    expect(clusters).toHaveLength(0);
  });

  it('does not flag repeated clicks on different targets', () => {
    const events = ['a', 'b', 'c'].map((target, i) => createSemanticEvent({
      action: 'click', target, sessionId: 's1', userId: 'u1', timestamp: i * 200,
    }));
    const clusters = detectRepetitions(events, { minRepetitions: 2, windowMs: 1000 });
    expect(clusters).toHaveLength(0);
  });
});

describe('detectAbandonment', () => {
  it('flags a form_focus with no matching form_submit_success in the same context', () => {
    const events = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 0 }),
    ];
    const abandonments = detectAbandonment(events);
    expect(abandonments).toHaveLength(1);
    expect(abandonments[0]).toMatchObject({ action: 'form_focus', context: 'entry' });
  });

  it('does not flag a form_focus followed by a matching success in time and context', () => {
    const events = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 0 }),
      createSemanticEvent({ action: 'form_submit_success', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 5000 }),
    ];
    expect(detectAbandonment(events)).toHaveLength(0);
  });

  it('flags it again if the success happens after the timeout', () => {
    const events = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 0 }),
      createSemanticEvent({ action: 'form_submit_success', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 999999 }),
    ];
    expect(detectAbandonment(events, { timeoutMs: 1000 })).toHaveLength(1);
  });
});

describe('applyPatternsToGraph', () => {
  it('creates WORKFLOW, INTENT and FEATURE_CANDIDATE nodes with SUGGESTS edges', () => {
    const graph = createEventGraph();
    const events = [
      ...seq('u1', 's1', ['search', 'filter', 'export']),
      ...seq('u2', 's2', ['search', 'filter', 'export']),
      ...seq('u3', 's3', ['search', 'filter', 'export']),
    ];
    graph.addEvents(events);
    const patterns = detectSequencePatterns(events, { sequenceLengths: [3], minSupportUsers: 2 });
    applyPatternsToGraph(graph, patterns, { minSupportUsers: 2 });

    const workflow = graph.getNode(NODE_TYPES.WORKFLOW, 'search_then_filter_then_export');
    expect(workflow).toBeTruthy();
    expect(workflow.properties.supportUsers).toBe(3);

    const feature = graph.getNode(NODE_TYPES.FEATURE_CANDIDATE, 'simplify_search_then_filter_then_export');
    expect(feature).toBeTruthy();
    expect(feature.properties.status).toBe('hypothesis');

    const suggestsFromWorkflow = graph.getEdgesFrom(workflow.id, RELATIONSHIPS.SUGGESTS);
    expect(suggestsFromWorkflow.map(e => e.to)).toContain(feature.id);

    const searchAction = graph.getNode(NODE_TYPES.ACTION, 'search');
    const partOf = graph.getEdgesFrom(searchAction.id, RELATIONSHIPS.PART_OF);
    expect(partOf.map(e => e.to)).toContain(workflow.id);
  });

  it('skips patterns below the graph-application threshold', () => {
    const graph = createEventGraph();
    const events = seq('u1', 's1', ['search', 'filter', 'export']);
    graph.addEvents(events);
    const patterns = [{ sequence: ['search', 'filter', 'export'], supportUsers: 1, supportSessions: 1, occurrences: 1, avgGapMs: 1000 }];
    applyPatternsToGraph(graph, patterns, { minSupportUsers: 2 });
    expect(graph.getNode(NODE_TYPES.WORKFLOW, 'search_then_filter_then_export')).toBeNull();
  });
});

describe('applyAbandonmentToGraph', () => {
  it('creates a PROBLEM node and a FEATURE_CANDIDATE hypothesis once enough users abandon', () => {
    const graph = createEventGraph();
    const abandonments = [
      { action: 'form_focus', context: 'entry', target: 'entry-form', userId: 'u1', sessionId: 's1', timestamp: 0 },
      { action: 'form_focus', context: 'entry', target: 'entry-form', userId: 'u2', sessionId: 's2', timestamp: 0 },
    ];
    applyAbandonmentToGraph(graph, abandonments, { minOccurrences: 2 });

    const problem = graph.getNode(NODE_TYPES.PROBLEM, 'abandonment_form_focus_entry');
    expect(problem).toBeTruthy();
    expect(problem.properties.supportUsers).toBe(2);

    const actionNode = graph.getNode(NODE_TYPES.ACTION, 'form_focus');
    expect(graph.getEdgesFrom(actionNode.id, RELATIONSHIPS.INDICATES).map(e => e.to)).toContain(problem.id);

    const feature = graph.getNode(NODE_TYPES.FEATURE_CANDIDATE, 'reduce_friction_abandonment_form_focus_entry');
    expect(feature).toBeTruthy();
  });
});

describe('describeFeatureCandidate', () => {
  it('renders the canonical "N users repeat this workflow" hypothesis text', () => {
    const description = describeFeatureCandidate({ sequence: ['search', 'filter', 'export'], supportUsers: 847 });
    expect(description).toContain('847');
    expect(description).toContain('search → filter → export');
  });
});
