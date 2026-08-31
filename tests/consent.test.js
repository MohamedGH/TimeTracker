import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConsentStatus,
  hasConsentDecision,
  isConsentGranted,
  setConsentStatus,
  clearConsentDecision,
} from '../src/core/analytics/consent.js';

describe('consent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('has no decision by default', () => {
    expect(getConsentStatus()).toBeNull();
    expect(hasConsentDecision()).toBe(false);
    expect(isConsentGranted()).toBe(false);
  });

  it('persists a granted decision', () => {
    setConsentStatus(true);
    expect(getConsentStatus()).toBe('granted');
    expect(hasConsentDecision()).toBe(true);
    expect(isConsentGranted()).toBe(true);
  });

  it('persists a denied decision', () => {
    setConsentStatus(false);
    expect(getConsentStatus()).toBe('denied');
    expect(hasConsentDecision()).toBe(true);
    expect(isConsentGranted()).toBe(false);
  });

  it('can be cleared back to "no decision"', () => {
    setConsentStatus(true);
    clearConsentDecision();
    expect(getConsentStatus()).toBeNull();
    expect(hasConsentDecision()).toBe(false);
  });
});
