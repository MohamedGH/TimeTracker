import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setConsentStatus, clearConsentDecision } from '../../src/core/analytics/consent.js';
import {
  initBehaviorTracking, resetBehaviorTracking, getBehaviorTracking, runPatternDetection,
  getFeatureCandidates, getBehaviorDetectionMeta, createEventStore, createSemanticEvent, NODE_TYPES,
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

  it('mines stored history end-to-end including sequences, abandonments, and repetitions', async () => {
    setConsentStatus(true);
    const store = createEventStore();
    for (const [user, session] of [['u1', 's1'], ['u2', 's2'], ['u3', 's3']]) {
      for (const event of seqEvents(user, session, ['search', 'filter', 'export'])) {
        await store.append(event);
      }
    }
    // Add 2 rapid click clusters on the same target in separate sessions (2 clicks per cluster won't trigger 3-gram workflow)
    for (const [session, baseTs] of [['s4', 10_000], ['s5', 20_000]]) {
      for (let i = 0; i < 3; i += 1) {
        await store.append(createSemanticEvent({
          action: 'click',
          target: 'sync-btn',
          context: 'entry',
          sessionId: session,
          userId: 'u1',
          timestamp: baseTs + i * 350,
        }));
      }
    }

    const root = document.getElementById('app');
    initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });
    const result = await runPatternDetection({ sequenceLengths: [3], minSupportUsers: 1, minSupportSessions: 2 });

    expect(result.sequencePatterns.some(p => p.sequence.join('>') === 'search>filter>export')).toBe(true);
    expect(result.workflows.some(w => w.workflowNode.value === 'search_then_filter_then_export')).toBe(true);
    expect(result.workflows[0].description).toContain('3 utilisateurs');
    expect(result.repetitionClusters.length).toBe(2);
    expect(result.repetitions).toHaveLength(1);

    const meta = getBehaviorDetectionMeta();
    expect(meta.lastRunAt).toBeGreaterThan(0);
    expect(meta.eventCountAtRun).toBe(15);

    const workflowNode = result.graph.getNode(NODE_TYPES.WORKFLOW, 'search_then_filter_then_export');
    expect(workflowNode).toBeTruthy();
    expect(workflowNode.properties.supportUsers).toBe(3);
  });

  it('deduplicates concurrent runPatternDetection calls and refreshes stale hypotheses', async () => {
    setConsentStatus(true);
    const store = createEventStore();
    for (const session of ['s1', 's2']) {
      for (const event of seqEvents('u1', session, ['search', 'filter'])) {
        await store.append(event);
      }
    }

    const root = document.getElementById('app');
    initBehaviorTracking({ root, patternDetectionIntervalMs: 0 });

    const [p1, p2] = await Promise.all([
      runPatternDetection({ sequenceLengths: [2], minSupportSessions: 2 }),
      runPatternDetection({ sequenceLengths: [2], minSupportSessions: 2 }),
    ]);
    expect(p1).toBe(p2);
    expect(getFeatureCandidates().length).toBeGreaterThan(0);

    // Clear store and re-run: stale hypothesis nodes should be removed cleanly
    await store.clear();
    await runPatternDetection({ sequenceLengths: [2], minSupportSessions: 2 });
    expect(getFeatureCandidates()).toEqual([]);
  });
});

describe('getFeatureCandidates', () => {
  it('returns an empty list when tracking was never initialized', () => {
    expect(getFeatureCandidates()).toEqual([]);
  });

  it('returns explainable hypotheses ranked by confidence and support', async () => {
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
    await runPatternDetection({ sequenceLengths: [2], minSupportUsers: 2, minSupportSessions: 2 });

    const candidates = getFeatureCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.status).toBe('hypothesis');
      expect(c.rule).toBeTruthy();
      expect(c.periodLabel).toBeTruthy();
      expect(c.confidence?.label).toBeTruthy();
      expect(Number.isFinite(c.occurrences)).toBe(true);
    }
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1].confidence.score).toBeGreaterThanOrEqual(candidates[i].confidence.score);
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
    await runPatternDetection({ sequenceLengths: [2], minSupportUsers: 2, minSupportSessions: 2 });

    expect(getFeatureCandidates({ limit: 1 })).toHaveLength(1);
  });
});
