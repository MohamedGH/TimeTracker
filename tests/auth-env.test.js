import { describe, it, expect, afterEach } from 'vitest';
import { getGoogleClientId, getGoogleRedirectUri } from '../src/core/auth/env.js';

describe('auth env resolution', () => {
  afterEach(() => {
    delete window.__TIME_TRACKER_ENV__;
  });

  it('returns null when GOOGLE_CLIENT_ID is not configured', () => {
    expect(getGoogleClientId()).toBeNull();
  });

  it('reads and trims GOOGLE_CLIENT_ID from runtime global', () => {
    window.__TIME_TRACKER_ENV__ = { GOOGLE_CLIENT_ID: '  123-abc.apps.googleusercontent.com  ' };
    expect(getGoogleClientId()).toBe('123-abc.apps.googleusercontent.com');
  });

  it('reads VITE_GOOGLE_CLIENT_ID from runtime global as fallback', () => {
    window.__TIME_TRACKER_ENV__ = { VITE_GOOGLE_CLIENT_ID: '  456-def.apps.googleusercontent.com  ' };
    expect(getGoogleClientId()).toBe('456-def.apps.googleusercontent.com');
  });

  it('ignores blank GOOGLE_CLIENT_ID values', () => {
    window.__TIME_TRACKER_ENV__ = { GOOGLE_CLIENT_ID: '   ' };
    expect(getGoogleClientId()).toBeNull();
  });

  it('reads GOOGLE_REDIRECT_URI from runtime global when specified', () => {
    window.__TIME_TRACKER_ENV__ = { GOOGLE_REDIRECT_URI: ' https://example.github.io/TimeTracker/ ' };
    expect(getGoogleRedirectUri({ origin: 'http://localhost:3000', pathname: '/' })).toBe(
      'https://example.github.io/TimeTracker/'
    );
  });

  it('falls back to location origin and pathname for cross-environment compatibility', () => {
    expect(getGoogleRedirectUri({ origin: 'https://user.github.io', pathname: '/TimeTracker/' })).toBe(
      'https://user.github.io/TimeTracker/'
    );
    expect(getGoogleRedirectUri({ origin: 'http://localhost:3000', pathname: '/' })).toBe(
      'http://localhost:3000/'
    );
  });
});
