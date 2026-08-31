import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setConsentStatus, clearConsentDecision } from '../../src/core/analytics/consent.js';
import {
  initBehaviorTracking, resetBehaviorTracking, getBehaviorTracking, runPatternDetection, getFeatureCandidates,
  createEventStore, createSemanticEvent, NODE_TYPES,
} from '../../src/core/behavior/index.js';

function seqEvents(userId, sessionId, actions, startTs = 0, gapMs = 1000) {
  return actions.map((action, i) => createSemanticEvent({
    action, sessionId, userId, timestamp: startTs + i * gapMs,
    previousAction: i > 0 ? actions[i - 1] : null,
    timeSincePreviousAction: i > 0 ? gapMs : null,
  }));
}

beforeEach(async () => {
  resetBehaviorTracking();
  clearConsentDecision();
  document.body.innerHTML = '<div id="app"></div>';
  await createEventStore().clear();
});

afterEach(() => {
  resetBehaviorTracking();
  vi.useRealTimers();
});

describe('initBehaviorTracking', () => {
  it('returns null without consent, and never attaches a tracker', () => {
    const root = document.getElementById('app');
    expect(initBehaviorTracking({ root, patternDetectionIntervalMs: 0 })).toBeNull();
    expect(getBehaviorTracking()).toBeNull();
  });

  it('returns an instance once consent is granted, and is idempotent', () => {
    setConsentStatus(true);
    const root = document.getElementById('app');
    const first = initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    const second = initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('hydrates the live graph from previously persisted events', async () => {
    setConsentStatus(true);
    const store = createEventStore();
    for (const event of seqEvents('u1', 's1', ['search', 'filter', 'export'])) {
      await store.append(event);
    }

    const root = document.getElementById('app');
    const instance = initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    await instance.ready;

    expect(instance.graph.getNode(NODE_TYPES.ACTION, 'search')).toBeTruthy();
    expect(instance.graph.getNode(NODE_TYPES.ACTION, 'export')).toBeTruthy();
    expect(instance.graph.getNode(NODE_TYPES.USER, 'u1')).toBeTruthy();
  });

  it('schedules periodic pattern detection that writes hypotheses without being called manually', async () => {
    setConsentStatus(true);
    const store = createEventStore();
    for (const [user, session] of [['u1', 's1'], ['u2', 's2']]) {
      for (const event of seqEvents(user, session, ['search', 'filter'])) {
        await store.append(event);
      }
    }

    // Real (short) interval rather than fake timers: fake-indexeddb relies
    // on real timer/microtask scheduling internally, so faking the clock
    // here would deadlock the IndexedDB-backed pattern-detection run.
    const root = document.getElementById('app');
    const instance = initBehaviorTracking({ root, patternDetectionIntervalMs: 20 });
    await instance.ready;

    expect(instance.graph.getNode(NODE_TYPES.WORKFLOW, 'search_then_filter')).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(instance.graph.getNode(NODE_TYPES.WORKFLOW, 'search_then_filter')).toBeTruthy();
  });
});

describe('runPatternDetection', () => {
  it('returns null when tracking was never initialized', async () => {
    expect(await runPatternDetection()).toBeNull();
  });

  it('mines stored history end-to-end and writes hypotheses into the live graph', async () => {
    setConsentStatus(true);
    const store = createEventStore();
    for (const [user, session] of [['u1', 's1'], ['u2', 's2'], ['u3', 's3']]) {
      for (const event of seqEvents(user, session, ['search', 'filter', 'export'])) {
        await store.append(event);
      }
    }

    const root = document.getElementById('app');
    initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    const result = await runPatternDetection({ sequenceLengths: [3], minSupportUsers: 2 });

    expect(result.sequencePatterns.some(p => p.sequence.join('>') === 'search>filter>export')).toBe(true);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].description).toContain('3 utilisateurs');

    const workflowNode = result.graph.getNode(NODE_TYPES.WORKFLOW, 'search_then_filter_then_export');
    expect(workflowNode).toBeTruthy();
    expect(workflowNode.properties.supportUsers).toBe(3);
  });
});

describe('getFeatureCandidates', () => {
  it('returns an empty list when tracking was never initialized', () => {
    expect(getFeatureCandidates()).toEqual([]);
  });

  it('returns hypotheses ranked by support, all marked as unreviewed', async () => {
    setConsentStatus(true);
    const store = createEventStore();
    for (const [user, session] of [['u1', 's1'], ['u2', 's2'], ['u3', 's3']]) {
      for (const event of seqEvents(user, session, ['search', 'filter', 'export'])) {
        await store.append(event);
      }
    }
    for (const [user, session] of [['u4', 's4'], ['u5', 's5']]) {
      for (const event of seqEvents(user, session, ['click', 'navigate'])) {
        await store.append(event);
      }
    }

    const root = document.getElementById('app');
    initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    await runPatternDetection({ sequenceLengths: [2], minSupportUsers: 2 });

    const candidates = getFeatureCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c => c.status === 'hypothesis')).toBe(true);
    // Ranked descending by support.
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1].supportUsers).toBeGreaterThanOrEqual(candidates[i].supportUsers);
    }
  });

  it('respects the limit option', async () => {
    setConsentStatus(true);
    const store = createEventStore();
    for (const [user, session] of [['u1', 's1'], ['u2', 's2']]) {
      for (const event of seqEvents(user, session, ['a', 'b'])) await store.append(event);
    }
    for (const [user, session] of [['u3', 's3'], ['u4', 's4']]) {
      for (const event of seqEvents(user, session, ['c', 'd'])) await store.append(event);
    }

    const root = document.getElementById('app');
    initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    await runPatternDetection({ sequenceLengths: [2], minSupportUsers: 2 });

    expect(getFeatureCandidates({ limit: 1 })).toHaveLength(1);
  });
});
