import { describe, it, expect } from 'vitest';
import {
  detectSequencePatterns,
  detectRepetitions,
  detectAbandonment,
  applyPatternsToGraph,
  applyAbandonmentToGraph,
  applyRepetitionsToGraph,
  describeFeatureCandidate,
  computeBehaviorConfidence,
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

describe('computeBehaviorConfidence', () => {
  it('computes explainable confidence levels across occurrences, sessions, and users', () => {
    expect(computeBehaviorConfidence({ occurrences: 1, supportSessions: 1, supportUsers: 1 }).level).toBe('faible');
    expect(computeBehaviorConfidence({ occurrences: 3, supportSessions: 2, supportUsers: 1 }).level).toBe('moyenne');
    expect(computeBehaviorConfidence({ occurrences: 6, supportSessions: 4, supportUsers: 1 }).level).toBe('élevée');
  });
});

describe('detectSequencePatterns', () => {
  it('finds 2-action and 3-action workflows across multiple sessions for a single local user', () => {
    const events = [
      ...seq('local-u1', 's1', ['search', 'filter', 'export']),
      ...seq('local-u1', 's2', ['search', 'filter', 'export']),
    ];
    const patterns = detectSequencePatterns(events, {
      sequenceLengths: [2, 3],
      minSupportUsers: 1,
      minSupportSessions: 2,
      minOccurrences: 2,
    });
    const trigram = patterns.find(p => p.sequence.join('>') === 'search>filter>export');
    const bigram = patterns.find(p => p.sequence.join('>') === 'search>filter');
    expect(trigram).toBeTruthy();
    expect(bigram).toBeTruthy();
    expect(trigram.supportUsers).toBe(1);
    expect(trigram.supportSessions).toBe(2);
    expect(trigram.occurrences).toBe(2);
    expect(trigram.confidence?.level).toBe('faible');

    const threeSessions = detectSequencePatterns([
      ...events,
      ...seq('local-u1', 's3', ['search', 'filter', 'export']),
    ], { sequenceLengths: [3], minSupportUsers: 1, minSupportSessions: 2, minOccurrences: 2 });
    expect(threeSessions[0].confidence?.level).toBe('moyenne');
  });

  it('excludes single-session or single-occurrence sequences when thresholds require >= 2 sessions', () => {
    const events = [
      ...seq('u1', 's1', ['search', 'filter', 'export']),
      ...seq('u1', 's1', ['search', 'filter', 'export'], 10_000), // 2 occurrences but only 1 session
    ];
    const patterns = detectSequencePatterns(events, {
      sequenceLengths: [3],
      minSupportUsers: 1,
      minSupportSessions: 2,
      minOccurrences: 2,
    });
    expect(patterns).toHaveLength(0);
  });

  it('excludes patterns below minSupportUsers', () => {
    const events = seq('u1', 's1', ['search', 'filter', 'export']);
    const patterns = detectSequencePatterns(events, { sequenceLengths: [3], minSupportUsers: 2, minSupportSessions: 1, minOccurrences: 1 });
    expect(patterns).toHaveLength(0);
  });

  it('does not mix actions from different sessions into one sequence', () => {
    const events = [...seq('u1', 's1', ['search']), ...seq('u2', 's2', ['export'])];
    const patterns = detectSequencePatterns(events, { sequenceLengths: [2], minSupportUsers: 1, minSupportSessions: 1, minOccurrences: 1 });
    expect(patterns.some(p => p.sequence.join('>') === 'search>export')).toBe(false);
  });

  it('ignores non-interaction event types by default', () => {
    const events = [
      createSemanticEvent({ type: 'error', action: 'js_error', sessionId: 's1', userId: 'u1', timestamp: 0 }),
      ...seq('u1', 's1', ['search', 'filter']),
      ...seq('u1', 's2', ['search', 'filter']),
    ];
    const patterns = detectSequencePatterns(events, { sequenceLengths: [2], minSupportUsers: 1, minSupportSessions: 2 });
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

  it('ignores excluded actions like form_focus and navigate', () => {
    const events = [0, 200, 400].map(ts => createSemanticEvent({
      action: 'form_focus', target: 'entry-form', sessionId: 's1', userId: 'u1', timestamp: ts,
    }));
    expect(detectRepetitions(events)).toHaveLength(0);
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
    expect(abandonments[0]).toMatchObject({ action: 'form_focus', target: 'entry-form', context: 'entry' });
  });

  it('does not double-count multiple field focuses within the same form episode', () => {
    const events = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', metadata: { field: 'activity' }, sessionId: 's1', userId: 'u1', timestamp: 0 }),
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', metadata: { field: 'start' }, sessionId: 's1', userId: 'u1', timestamp: 15_000 }),
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', metadata: { field: 'end' }, sessionId: 's1', userId: 'u1', timestamp: 30_000 }),
    ];
    const abandonments = detectAbandonment(events);
    expect(abandonments).toHaveLength(1);
    expect(abandonments[0].focusCount).toBe(3);
  });

  it('does not create false positive when user fills form slowly (> 60s) and then submits successfully', () => {
    const events = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', metadata: { field: 'activity' }, sessionId: 's1', userId: 'u1', timestamp: 0 }),
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', metadata: { field: 'start' }, sessionId: 's1', userId: 'u1', timestamp: 50_000 }),
      createSemanticEvent({ action: 'form_submit_success', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 95_000 }),
    ];
    expect(detectAbandonment(events)).toHaveLength(0);
  });

  it('does not equate a validation error alone (without navigation away) with abandonment', () => {
    const events = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 0 }),
      createSemanticEvent({ action: 'form_submit_error', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 10_000 }),
    ];
    expect(detectAbandonment(events)).toHaveLength(0);

    // If the user fixes and submits later, still zero abandonment
    const corrected = [
      ...events,
      createSemanticEvent({ action: 'form_submit_success', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 20_000 }),
    ];
    expect(detectAbandonment(corrected)).toHaveLength(0);
  });

  it('flags abandonment if target/context do not match or timeout is exceeded', () => {
    const mismatchedTarget = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 0 }),
      createSemanticEvent({ action: 'form_submit_success', target: 'other-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 2000 }),
    ];
    expect(detectAbandonment(mismatchedTarget)).toHaveLength(1);

    const timedOut = [
      createSemanticEvent({ action: 'form_focus', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 0 }),
      createSemanticEvent({ action: 'form_submit_success', target: 'entry-form', context: 'entry', sessionId: 's1', userId: 'u1', timestamp: 999_999 }),
    ];
    expect(detectAbandonment(timedOut, { timeoutMs: 1000 })).toHaveLength(1);
  });
});

describe('applyPatternsToGraph, applyAbandonmentToGraph & applyRepetitionsToGraph', () => {
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
    expect(feature.properties.rule).toBeTruthy();

    const suggestsFromWorkflow = graph.getEdgesFrom(workflow.id, RELATIONSHIPS.SUGGESTS);
    expect(suggestsFromWorkflow.map(e => e.to)).toContain(feature.id);

    const searchAction = graph.getNode(NODE_TYPES.ACTION, 'search');
    const partOf = graph.getEdgesFrom(searchAction.id, RELATIONSHIPS.PART_OF);
    expect(partOf.map(e => e.to)).toContain(workflow.id);
  });

  it('skips patterns below graph thresholds (sessions or occurrences)', () => {
    const graph = createEventGraph();
    const events = seq('u1', 's1', ['search', 'filter', 'export']);
    graph.addEvents(events);
    const patterns = [{ sequence: ['search', 'filter', 'export'], supportUsers: 1, supportSessions: 1, occurrences: 1, avgGapMs: 1000 }];
    applyPatternsToGraph(graph, patterns, { minSupportUsers: 1, minSupportSessions: 2, minOccurrences: 2 });
    expect(graph.getNode(NODE_TYPES.WORKFLOW, 'search_then_filter_then_export')).toBeNull();
  });

  it('creates abandonment PROBLEM and cautious FEATURE_CANDIDATE for single user across multiple sessions', () => {
    const graph = createEventGraph();
    const abandonments = [
      { action: 'form_focus', context: 'entry', target: 'entry-form', userId: 'u1', sessionId: 's1', timestamp: 0 },
      { action: 'form_focus', context: 'entry', target: 'entry-form', userId: 'u1', sessionId: 's2', timestamp: 1000 },
    ];
    applyAbandonmentToGraph(graph, abandonments, { minOccurrences: 2, minSupportSessions: 2, minSupportUsers: 1 });

    const problem = graph.getNode(NODE_TYPES.PROBLEM, 'abandonment_form_focus_entry');
    expect(problem).toBeTruthy();
    expect(problem.properties.supportSessions).toBe(2);

    const feature = graph.getNode(NODE_TYPES.FEATURE_CANDIDATE, 'reduce_friction_abandonment_form_focus_entry');
    expect(feature).toBeTruthy();
    expect(feature.properties.description).toContain('point de friction');
  });

  it('creates UI friction PROBLEM and FEATURE_CANDIDATE from repetition clusters without claiming a definite bug', () => {
    const graph = createEventGraph();
    const clusters = [
      { action: 'click', target: 'sync-btn', context: 'entry', sessionId: 's1', userId: 'u1', repetitions: 4, spanMs: 900, timestamp: 100 },
      { action: 'click', target: 'sync-btn', context: 'entry', sessionId: 's2', userId: 'u1', repetitions: 3, spanMs: 700, timestamp: 200 },
    ];
    const created = applyRepetitionsToGraph(graph, clusters, { minOccurrences: 2, minSupportSessions: 1, minSupportUsers: 1 });
    expect(created).toHaveLength(1);

    const feature = graph.getNode(NODE_TYPES.FEATURE_CANDIDATE, 'examine_repetition_click_sync-btn_entry');
    expect(feature).toBeTruthy();
    expect(feature.properties.kind).toBe('repetition');
    expect(feature.properties.description).toContain('pourrait indiquer');
  });
});

describe('describeFeatureCandidate', () => {
  it('renders a cautious observation sentence for repeated workflows', () => {
    const singleUser = describeFeatureCandidate({ sequence: ['search', 'filter', 'export'], supportUsers: 1, supportSessions: 4, occurrences: 4 });
    expect(singleUser).toContain('4 fois');
    expect(singleUser).toContain('search → filter → export');

    const multiUser = describeFeatureCandidate({ sequence: ['search', 'filter', 'export'], supportUsers: 3, supportSessions: 5, occurrences: 5 });
    expect(multiUser).toContain('3 utilisateurs');
    expect(multiUser).toContain('search → filter → export');
  });
});
