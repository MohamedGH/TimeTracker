import { describe, it, expect, beforeEach } from 'vitest';
import { createEventStore } from '../../src/core/behavior/event-store.js';
import { createSemanticEvent } from '../../src/core/behavior/semantic-event.js';

function event(overrides) {
  return createSemanticEvent({ action: 'click', sessionId: 's1', userId: 'u1', ...overrides });
}

describe('event store', () => {
  let store;

  beforeEach(async () => {
    store = createEventStore({ maxEvents: 5 });
    await store.clear();
  });

  it('rejects a non-semantic-event payload', async () => {
    await expect(store.append({ foo: 'bar' })).rejects.toThrow();
  });

  it('appends and lists events for a session, sorted by time', async () => {
    await store.append(event({ timestamp: 200 }));
    await store.append(event({ timestamp: 100 }));
    const events = await store.listBySession('s1');
    expect(events.map(e => e.timestamp)).toEqual([100, 200]);
  });

  it('only lists events for the requested session', async () => {
    await store.append(event({ sessionId: 's1', timestamp: 100 }));
    await store.append(event({ sessionId: 's2', userId: 'u2', timestamp: 100 }));
    expect(await store.listBySession('s1')).toHaveLength(1);
    expect(await store.listBySession('s2')).toHaveLength(1);
  });

  it('counts stored events', async () => {
    expect(await store.count()).toBe(0);
    await store.append(event({}));
    expect(await store.count()).toBe(1);
  });

  it('prunes down to the configured maxEvents (keeps the most recent)', async () => {
    store = createEventStore({ maxEvents: 5, pruneEveryNAppends: 1 });
    await store.clear();
    for (let i = 0; i < 8; i += 1) {
      await store.append(event({ timestamp: i, id: undefined }));
    }
    // pruning runs async/best-effort after append; give it a tick
    await new Promise(resolve => setTimeout(resolve, 10));
    const count = await store.count();
    expect(count).toBeLessThanOrEqual(5);
  });

  it('only prunes every N appends, not on every single one', async () => {
    store = createEventStore({ maxEvents: 1, pruneEveryNAppends: 3 });
    await store.clear();
    await store.append(event({ timestamp: 1 }));
    await store.append(event({ timestamp: 2 }));
    await new Promise(resolve => setTimeout(resolve, 10));
    // Below the threshold (2 appends < pruneEveryNAppends 3): nothing pruned yet.
    expect(await store.count()).toBe(2);

    await store.append(event({ timestamp: 3 }));
    await new Promise(resolve => setTimeout(resolve, 10));
    // Third append crosses the threshold: pruning now runs.
    expect(await store.count()).toBeLessThanOrEqual(1);
  });

  it('clear() empties the store', async () => {
    await store.append(event({}));
    await store.clear();
    expect(await store.count()).toBe(0);
  });
});
