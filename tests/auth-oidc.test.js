import { describe, it, expect } from 'vitest';
import {
  OIDC_ENDPOINTS,
  OIDC_SCOPES,
  parseJwtPayload,
  normalizeOidcUser,
  isSessionValid,
  buildOidcAuthUrl,
  parseOidcCallbackParams,
  generatePkcePair,
} from '../src/core/auth/oidc.js';

function encodeBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('OIDC pure helpers', () => {
  it('decodes UTF-8 JWT payload claims cleanly and rejects malformed tokens', () => {
    const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = encodeBase64Url(JSON.stringify({ sub: '109', name: 'Élodie Martin', email: 'elodie@example.com' }));
    const token = `${header}.${payload}.sig`;

    expect(parseJwtPayload(token)).toEqual({
      sub: '109',
      name: 'Élodie Martin',
      email: 'elodie@example.com',
    });
    expect(parseJwtPayload('invalid')).toBeNull();
    expect(parseJwtPayload(null)).toBeNull();
    expect(parseJwtPayload('a.!!!.c')).toBeNull();
  });

  it('normalizes Google OIDC claims and ignores records without subject id', () => {
    expect(normalizeOidcUser(null)).toBeNull();
    expect(normalizeOidcUser({ email: 'no-id@example.com' })).toBeNull();

    expect(normalizeOidcUser({
      sub: 'google-sub-42',
      email: 'camille@example.com',
      email_verified: true,
      name: 'Camille Dupont',
      given_name: 'Camille',
      family_name: 'Dupont',
      picture: 'https://lh3.googleusercontent.com/avatar.png',
    })).toEqual({
      id: 'google-sub-42',
      email: 'camille@example.com',
      emailVerified: true,
      name: 'Camille Dupont',
      givenName: 'Camille',
      familyName: 'Dupont',
      picture: 'https://lh3.googleusercontent.com/avatar.png',
      provider: 'google_oidc',
    });
  });

  it('validates OIDC profile session expiration', () => {
    const now = 1_700_000_000_000;
    expect(isSessionValid(null, now)).toBe(false);
    expect(isSessionValid({ user: { id: '' } }, now)).toBe(false);
    expect(isSessionValid({ user: { id: '1' }, expiresAt: now - 1000 }, now)).toBe(false);
    expect(isSessionValid({ user: { id: '1' }, expiresAt: now + 60_000 }, now)).toBe(true);
    expect(isSessionValid({ user: { id: '1' } }, now)).toBe(true);
  });

  it('builds a valid Google OAuth 2.0 / OIDC authorization URL with PKCE', () => {
    const url = new URL(buildOidcAuthUrl({
      clientId: 'client-123',
      redirectUri: 'https://app.example.com/TimeTracker/',
      state: 'st-1',
      nonce: 'nc-1',
      codeChallenge: 'ch-abc',
    }));

    expect(`${url.origin}${url.pathname}`).toBe(OIDC_ENDPOINTS.authorization);
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/TimeTracker/');
    expect(url.searchParams.get('scope')).toBe(OIDC_SCOPES);
    expect(url.searchParams.get('code_challenge')).toBe('ch-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('nonce')).toBe('nc-1');
  });

  it('parses callback parameters from query or fragment strings', () => {
    expect(parseOidcCallbackParams('?code=auth-code&state=s1')).toEqual({
      code: 'auth-code',
      state: 's1',
    });
    expect(parseOidcCallbackParams('#access_token=tok&expires_in=3600&error=access_denied')).toEqual({
      access_token: 'tok',
      expires_in: '3600',
      error: 'access_denied',
    });
  });

  it('generates PKCE S256 verifier and challenge when Web Crypto is available', async () => {
    const pair = await generatePkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).not.toBe(pair.verifier);
    expect(pair.method).toBe('S256');
  });
});
