import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBehaviorTracker } from '../../src/core/behavior/behavior-tracker.js';

function fakeEventStore() {
  const events = [];
  return { events, append: vi.fn(async event => { events.push(event); return event; }) };
}

function fakeGraph() {
  const received = [];
  return { received, addEvent: vi.fn(event => received.push(event)) };
}

beforeEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createBehaviorTracker: click delegation', () => {
  it('tracks a click only on elements explicitly marked with data-behavior-target', async () => {
    document.body.innerHTML = `
      <button data-behavior-target="export-button" data-behavior-object="time_entry">Export</button>
      <button>Untracked button</button>
    `;
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });
    tracker.attach(document.body);

    document.querySelectorAll('button')[0].click();
    document.querySelectorAll('button')[1].click();
    await flush();

    expect(eventStore.events).toHaveLength(1);
    expect(eventStore.events[0]).toMatchObject({ action: 'click', target: 'export-button', object: 'time_entry' });
    tracker.detach();
  });

  it('records context set via setContext/trackNavigation', async () => {
    document.body.innerHTML = `<button data-behavior-target="export-button">Export</button>`;
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });
    tracker.attach(document.body);

    await tracker.trackNavigation('dashboard');
    document.querySelector('button').click();
    await flush();

    const click = eventStore.events.find(e => e.action === 'click');
    expect(click.context).toBe('dashboard');
    tracker.detach();
  });
});

describe('createBehaviorTracker: form interaction', () => {
  it('tracks form_focus on a field within a marked form, never the field value', async () => {
    document.body.innerHTML = `
      <form data-behavior-form="entry-form">
        <input data-behavior-field="activity" value="Séance de sport privée" />
      </form>
    `;
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });
    tracker.attach(document.body);

    const input = document.querySelector('input');
    input.dispatchEvent(new Event('focusin', { bubbles: true }));
    await flush();

    expect(eventStore.events).toHaveLength(1);
    const [focusEvent] = eventStore.events;
    expect(focusEvent.action).toBe('form_focus');
    expect(focusEvent.target).toBe('entry-form');
    expect(focusEvent.metadata).toEqual({ field: 'activity' });
    expect(JSON.stringify(focusEvent)).not.toContain('Séance de sport privée');
    tracker.detach();
  });

  it('trackFormResult records success/error outcomes explicitly', async () => {
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });
    await tracker.trackFormResult('entry-form', 'success', { object: 'time_entry' });
    await tracker.trackFormResult('entry-form', 'error', { object: 'time_entry', code: 'invalid-entry' });
    await flush();

    expect(eventStore.events[0]).toMatchObject({ action: 'form_submit_success', target: 'entry-form', object: 'time_entry' });
    expect(eventStore.events[1]).toMatchObject({ action: 'form_submit_error', target: 'entry-form', metadata: { code: 'invalid-entry' } });
  });
});

describe('createBehaviorTracker: sequencing', () => {
  it('stamps previousAction and timeSincePreviousAction within a session', async () => {
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });

    await tracker.record({ action: 'search', timestamp: 1000 });
    await tracker.record({ action: 'filter', timestamp: 3400 });

    const [, second] = eventStore.events;
    expect(second.previousAction).toBe('search');
    expect(second.timeSincePreviousAction).toBe(2400);
  });
});

describe('createBehaviorTracker: hover/attention', () => {
  it('emits hover_attention only after a dwell threshold, not on brief hovers', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<button data-behavior-target="export-button">Export</button>`;
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });
    tracker.attach(document.body);

    const button = document.querySelector('button');
    button.dispatchEvent(new Event('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(300);
    button.dispatchEvent(new Event('mouseout', { bubbles: true }));
    vi.advanceTimersByTime(2000);
    expect(eventStore.events.filter(e => e.action === 'hover_attention')).toHaveLength(0);

    button.dispatchEvent(new Event('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(1300);
    await flush();
    expect(eventStore.events.filter(e => e.action === 'hover_attention')).toHaveLength(1);

    tracker.detach();
    vi.useRealTimers();
  });
});

describe('createBehaviorTracker: errors', () => {
  it('captures unhandled window errors without leaking the error message', async () => {
    document.body.innerHTML = '';
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });
    tracker.attach(document.body);

    window.dispatchEvent(Object.assign(new Event('error'), { error: new TypeError('User email is a@b.com') }));
    await flush();

    const errorEvent = eventStore.events.find(e => e.action === 'js_error');
    expect(errorEvent).toBeTruthy();
    expect(errorEvent.metadata.name).toBe('TypeError');
    expect(JSON.stringify(errorEvent)).not.toContain('a@b.com');
    tracker.detach();
  });
});

describe('createBehaviorTracker: graceful degradation', () => {
  it('never throws when the event store append fails', async () => {
    const eventStore = { append: vi.fn(async () => { throw new Error('IndexedDB unavailable'); }) };
    const tracker = createBehaviorTracker({ eventStore });
    await expect(tracker.trackClick('export-button')).resolves.not.toBeNull();
  });

  it('drops invalid actions silently instead of throwing', async () => {
    const eventStore = fakeEventStore();
    const tracker = createBehaviorTracker({ eventStore });
    const result = await tracker.record({ action: 'has spaces!' });
    expect(result).toBeNull();
    expect(eventStore.events).toHaveLength(0);
  });

  it('feeds the live graph when one is provided', async () => {
    const eventStore = fakeEventStore();
    const graph = fakeGraph();
    const tracker = createBehaviorTracker({ eventStore, graph });
    await tracker.trackClick('export-button');
    expect(graph.received).toHaveLength(1);
  });
});

function flush() {
  return Promise.resolve().then(() => Promise.resolve());
}
