import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleOidcAuth, resetGsiScriptCacheForTest } from '../src/core/auth/google-auth.js';
import { OIDC_ENDPOINTS, OIDC_SCOPES } from '../src/core/auth/oidc.js';

describe('createGoogleOidcAuth', () => {
  beforeEach(() => {
    resetGsiScriptCacheForTest();
  });

  it('reports configuration status based on getClientId', () => {
    const unconfigured = createGoogleOidcAuth({ getClientId: () => null });
    const configured = createGoogleOidcAuth({ getClientId: () => 'client-xyz' });

    expect(unconfigured.isConfigured()).toBe(false);
    expect(configured.isConfigured()).toBe(true);
  });

  it('rejects signIn with a clear message when client ID is missing', async () => {
    const auth = createGoogleOidcAuth({
      getClientId: () => null,
      loadScript: vi.fn(),
    });

    await expect(auth.signIn()).rejects.toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('propagates script loading errors cleanly when offline', async () => {
    const auth = createGoogleOidcAuth({
      getClientId: () => 'client-xyz',
      loadScript: vi.fn().mockRejectedValue(new Error('Hors ligne')),
    });

    await expect(auth.signIn()).rejects.toThrow('Hors ligne');
  });

  it('authenticates via GIS token client popup and fetches OIDC userinfo', async () => {
    const requestAccessToken = vi.fn();
    let capturedConfig = null;

    const fakeGoogleApi = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((cfg) => {
            capturedConfig = cfg;
            return {
              requestAccessToken: (opts) => {
                requestAccessToken(opts);
                cfg.callback({ access_token: 'access-tok-123', expires_in: 3600 });
              },
            };
          }),
        },
        id: { disableAutoSelect: vi.fn() },
      },
    };

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: 'sub-99',
        email: 'alex@example.com',
        email_verified: true,
        name: 'Alex Bernard',
        picture: 'https://example.com/p.jpg',
      }),
    });

    const auth = createGoogleOidcAuth({
      getClientId: () => 'client-xyz',
      loadScript: vi.fn().mockResolvedValue(fakeGoogleApi),
      fetchImpl,
      getGoogleApi: () => fakeGoogleApi,
      nowFn: () => 1_000_000,
    });

    const session = await auth.signIn();

    expect(capturedConfig.client_id).toBe('client-xyz');
    expect(capturedConfig.scope).toBe(OIDC_SCOPES);
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(fetchImpl).toHaveBeenCalledWith(OIDC_ENDPOINTS.userInfo, {
      method: 'GET',
      headers: { Authorization: 'Bearer access-tok-123' },
    });
    expect(session.user).toEqual({
      id: 'sub-99',
      email: 'alex@example.com',
      emailVerified: true,
      name: 'Alex Bernard',
      givenName: null,
      familyName: null,
      picture: 'https://example.com/p.jpg',
      provider: 'google_oidc',
    });
    expect(session.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(auth.getAccessToken()).toBe('access-tok-123');
  });

  it('handles popup cancellation cleanly', async () => {
    const fakeGoogleApi = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((cfg) => ({
            requestAccessToken: () => cfg.error_callback({ type: 'popup_closed' }),
          })),
        },
      },
    };

    const auth = createGoogleOidcAuth({
      getClientId: () => 'client-xyz',
      loadScript: vi.fn().mockResolvedValue(fakeGoogleApi),
      getGoogleApi: () => fakeGoogleApi,
    });

    await expect(auth.signIn()).rejects.toThrow(/fermée/i);
    expect(auth.getAccessToken()).toBeNull();
  });

  it('revokes token on signOut and stays resilient offline', async () => {
    const disableAutoSelect = vi.fn();
    const fakeGoogleApi = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((cfg) => ({
            requestAccessToken: () => cfg.callback({ access_token: 'tok-revoke', expires_in: 3600 }),
          })),
        },
        id: { disableAutoSelect },
      },
    };

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sub: 'sub-1', name: 'Test User' }),
      })
      .mockRejectedValueOnce(new Error('Network offline'));

    const auth = createGoogleOidcAuth({
      getClientId: () => 'client-xyz',
      loadScript: vi.fn().mockResolvedValue(fakeGoogleApi),
      fetchImpl,
      getGoogleApi: () => fakeGoogleApi,
      nowFn: () => 5000,
    });

    await auth.signIn();
    expect(auth.getAccessToken()).toBe('tok-revoke');

    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(auth.getAccessToken()).toBeNull();
    expect(fetchImpl).toHaveBeenLastCalledWith(
      `${OIDC_ENDPOINTS.revoke}?token=tok-revoke`,
      { method: 'POST' }
    );
    expect(disableAutoSelect).toHaveBeenCalledTimes(1);
  });

  it('tracks granted scopes and reuses cached token in ensureAccessToken', async () => {
    const initTokenClient = vi.fn((cfg) => ({
      requestAccessToken: () => cfg.callback({
        access_token: 'drive-tok-99',
        expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.appdata',
      }),
    }));

    const fakeGoogleApi = {
      accounts: {
        oauth2: { initTokenClient },
      },
    };

    const auth = createGoogleOidcAuth({
      getClientId: () => 'client-xyz',
      loadScript: vi.fn().mockResolvedValue(fakeGoogleApi),
      getGoogleApi: () => fakeGoogleApi,
      nowFn: () => 10_000,
    });

    const tok1 = await auth.ensureAccessToken({ scope: 'https://www.googleapis.com/auth/drive.appdata' });
    expect(tok1).toBe('drive-tok-99');
    expect(auth.hasScope('https://www.googleapis.com/auth/drive.appdata')).toBe(true);

    // Second call with already-granted scope reuses memory token without opening GIS again
    const tok2 = await auth.ensureAccessToken({ scope: 'https://www.googleapis.com/auth/drive.appdata' });
    expect(tok2).toBe('drive-tok-99');
    expect(initTokenClient).toHaveBeenCalledTimes(1);
  });
});
