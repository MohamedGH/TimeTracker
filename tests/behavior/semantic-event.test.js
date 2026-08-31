import { describe, it, expect } from 'vitest';
import { createSemanticEvent, isSemanticEvent, EVENT_TYPES } from '../../src/core/behavior/semantic-event.js';
import { sanitizeMetadata, isSafeIdentifier, toSafeIdentifier } from '../../src/core/behavior/sanitize.js';

describe('createSemanticEvent', () => {
  const base = { action: 'click', sessionId: 's1', userId: 'u1' };

  it('creates a well-shaped event with defaults', () => {
    const event = createSemanticEvent(base);
    expect(event.type).toBe(EVENT_TYPES.INTERACTION);
    expect(event.action).toBe('click');
    expect(event.sessionId).toBe('s1');
    expect(event.userId).toBe('u1');
    expect(event.target).toBeNull();
    expect(event.previousAction).toBeNull();
    expect(event.timeSincePreviousAction).toBeNull();
    expect(typeof event.id).toBe('string');
    expect(isSemanticEvent(event)).toBe(true);
  });

  it('requires a valid action', () => {
    expect(() => createSemanticEvent({ ...base, action: undefined })).toThrow();
    expect(() => createSemanticEvent({ ...base, action: 'has spaces!' })).toThrow();
  });

  it('requires a session and user id', () => {
    expect(() => createSemanticEvent({ action: 'click', sessionId: 's1' })).toThrow();
    expect(() => createSemanticEvent({ action: 'click', userId: 'u1' })).toThrow();
  });

  it('drops unsafe target/context/object identifiers rather than throwing', () => {
    const event = createSemanticEvent({ ...base, target: 'a value with spaces', context: 'dashboard', object: null });
    expect(event.target).toBeNull();
    expect(event.context).toBe('dashboard');
  });

  it('clamps a negative timeSincePreviousAction to null', () => {
    const event = createSemanticEvent({ ...base, timeSincePreviousAction: -50 });
    expect(event.timeSincePreviousAction).toBeNull();
  });

  it('sanitizes metadata through sanitizeMetadata', () => {
    const event = createSemanticEvent({ ...base, metadata: { field: 'activity', password: 'hunter2', dwell_bucket: 'short' } });
    expect(event.metadata).toEqual({ field: 'activity', dwell_bucket: 'short' });
  });
});

describe('isSafeIdentifier / toSafeIdentifier', () => {
  it('accepts identifier-shaped strings only', () => {
    expect(isSafeIdentifier('export-button')).toBe(true);
    expect(isSafeIdentifier('time_entry')).toBe(true);
    expect(isSafeIdentifier('has spaces')).toBe(false);
    expect(isSafeIdentifier('<script>')).toBe(false);
    expect(isSafeIdentifier('')).toBe(false);
  });

  it('toSafeIdentifier returns null for anything unsafe or empty', () => {
    expect(toSafeIdentifier('export-button')).toBe('export-button');
    expect(toSafeIdentifier('some free text with spaces')).toBeNull();
    expect(toSafeIdentifier(null)).toBeNull();
    expect(toSafeIdentifier(undefined)).toBeNull();
  });
});

describe('sanitizeMetadata', () => {
  it('drops denylisted keys regardless of value shape', () => {
    expect(sanitizeMetadata({ password: 'x', token: 'y', email: 'a@b.com', field: 'date' }))
      .toEqual({ field: 'date' });
  });

  it('drops free-text string values (not identifier-shaped)', () => {
    expect(sanitizeMetadata({ note: 'irrelevant since denylisted', comment_ok: 'this has a space in it' }))
      .toEqual({});
  });

  it('keeps booleans and finite numbers', () => {
    expect(sanitizeMetadata({ has_results: true, count: 3 })).toEqual({ has_results: true, count: 3 });
  });

  it('drops nested objects and arrays', () => {
    expect(sanitizeMetadata({ nested: { a: 1 }, list: [1, 2] })).toEqual({});
  });

  it('caps the number of metadata keys', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`key${i}`, i]));
    const result = sanitizeMetadata(many);
    expect(Object.keys(result).length).toBeLessThanOrEqual(12);
  });
});
