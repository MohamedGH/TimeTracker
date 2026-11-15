/**
 * Direct Google OAuth 2.0 / OpenID Connect client without any specialized intermediary.
 * Works across AI Studio iframe, GitHub Pages, localhost, and offline-first PWA:
 * - Lazy-loads Google Identity Services (GIS) only when the user signs in.
 * - Uses GIS popup Token Client (initTokenClient) so popups open accounts.google.com directly.
 * - Fetches standard OIDC user profile from openidconnect.googleapis.com/v1/userinfo.
 * - Keeps OAuth access tokens strictly in memory (never written to web/IndexedDB storage).
 */

import { getGoogleClientId } from './env.js';
import { OIDC_ENDPOINTS, OIDC_SCOPES, normalizeOidcUser } from './oidc.js';

let gsiLoadPromise = null;

export function loadGsiScript({
  documentObj = typeof document !== 'undefined' ? document : null,
  src = OIDC_ENDPOINTS.gsiScript,
  getGoogleApi = () => (typeof window !== 'undefined' ? window.google : null),
} = {}) {
  const existingApi = getGoogleApi();
  if (existingApi?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve(existingApi);
  }
  if (!documentObj) {
    return Promise.reject(new Error('Document indisponible pour charger Google Identity Services.'));
  }
  if (gsiLoadPromise) return gsiLoadPromise;

  gsiLoadPromise = new Promise((resolve, reject) => {
    const existingScript = documentObj.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      if (getGoogleApi()?.accounts?.oauth2?.initTokenClient) {
        resolve(getGoogleApi());
        return;
      }
      existingScript.addEventListener('load', () => resolve(getGoogleApi()), { once: true });
      existingScript.addEventListener('error', () => {
        gsiLoadPromise = null;
        reject(new Error('Impossible de charger le service d’authentification Google (hors ligne ou bloqué).'));
      }, { once: true });
      return;
    }

    const script = documentObj.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = getGoogleApi();
      if (api?.accounts?.oauth2?.initTokenClient) {
        resolve(api);
      } else {
        gsiLoadPromise = null;
        reject(new Error('Google Identity Services chargé mais API OAuth 2.0 indisponible.'));
      }
    };
    script.onerror = () => {
      gsiLoadPromise = null;
      reject(new Error('Impossible de charger le service d’authentification Google (hors ligne ou bloqué).'));
    };
    (documentObj.head || documentObj.body || documentObj.documentElement).appendChild(script);
  });

  return gsiLoadPromise;
}

export function resetGsiScriptCacheForTest() {
  gsiLoadPromise = null;
}

export function createGoogleOidcAuth({
  getClientId = getGoogleClientId,
  loadScript = loadGsiScript,
  fetchImpl = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
  getGoogleApi = () => (typeof window !== 'undefined' ? window.google : null),
  nowFn = () => Date.now(),
} = {}) {
  // Access token and granted scopes are kept strictly in closure memory, never persisted to disk.
  let accessToken = null;
  let tokenExpiresAt = 0;
  let grantedScopes = new Set();

  function isConfigured() {
    return Boolean(getClientId());
  }

  function recordGrantedScopes(rawScope) {
    const parts = String(rawScope || '')
      .split(/\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    grantedScopes = new Set(parts);
  }

  function hasScope(requiredScope) {
    if (!getAccessToken()) return false;
    const needed = String(requiredScope || '')
      .split(/\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    return needed.every(s => grantedScopes.has(s));
  }

  function getAccessToken() {
    if (!accessToken) return null;
    if (tokenExpiresAt > 0 && nowFn() >= tokenExpiresAt) {
      accessToken = null;
      tokenExpiresAt = 0;
      grantedScopes = new Set();
      return null;
    }
    return accessToken;
  }

  async function fetchUserInfo(token = getAccessToken()) {
    if (!token) {
      throw new Error('Aucun jeton OAuth 2.0 actif en mémoire.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('API fetch indisponible pour récupérer le profil OIDC.');
    }

    const res = await fetchImpl(OIDC_ENDPOINTS.userInfo, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Impossible de récupérer le profil Google OIDC (HTTP ${res.status}).`);
    }

    const claims = await res.json();
    const user = normalizeOidcUser(claims);
    if (!user) {
      throw new Error('Profil OIDC Google incomplet (identifiant utilisateur manquant).');
    }
    return user;
  }

  function requestPopupAccessToken(googleApi, clientId, prompt, scope = OIDC_SCOPES) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const tokenClient = googleApi.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: (response) => {
          if (settled) return;
          settled = true;
          if (!response || response.error) {
            const detail = response?.error_description || response?.error || 'Authentification OAuth refusée.';
            reject(new Error(`Échec de la connexion Google : ${detail}`));
            return;
          }
          if (!response.access_token) {
            reject(new Error('Jeton d’accès OAuth 2.0 absent de la réponse Google.'));
            return;
          }
          resolve(response);
        },
        error_callback: (err) => {
          if (settled) return;
          settled = true;
          const type = err?.type || 'unknown';
          if (type === 'popup_closed') {
            reject(new Error('Fenêtre de connexion Google fermée avant la fin.'));
          } else if (type === 'popup_failed_to_open') {
            reject(new Error('La fenêtre contextuelle Google a été bloquée par le navigateur.'));
          } else {
            reject(new Error(`Erreur Google OAuth (${type}).`));
          }
        },
      });

      tokenClient.requestAccessToken(prompt ? { prompt } : {});
    });
  }

  async function ensureAccessToken({ scope = OIDC_SCOPES, prompt = '' } = {}) {
    const existing = getAccessToken();
    if (existing && hasScope(scope)) {
      return existing;
    }

    const clientId = getClientId();
    if (!clientId) {
      throw new Error('Configuration OAuth Google manquante : définissez GOOGLE_CLIENT_ID.');
    }

    const loadedApi = await loadScript();
    const googleApi = loadedApi || getGoogleApi();
    if (!googleApi?.accounts?.oauth2?.initTokenClient) {
      throw new Error('Google Identity Services OAuth 2.0 indisponible.');
    }

    const mergedScope = Array.from(new Set([
      ...String(OIDC_SCOPES).split(/\s+/),
      ...String(scope || '').split(/\s+/),
    ].filter(Boolean))).join(' ');

    const tokenResponse = await requestPopupAccessToken(googleApi, clientId, prompt, mergedScope);
    const expiresInSec = Number(tokenResponse.expires_in) || 3600;
    const nextExpiresAt = nowFn() + expiresInSec * 1000;

    accessToken = tokenResponse.access_token;
    tokenExpiresAt = nextExpiresAt;
    recordGrantedScopes(tokenResponse.scope || mergedScope);
    return accessToken;
  }

  async function signIn({ prompt = 'select_account', scope = OIDC_SCOPES } = {}) {
    const clientId = getClientId();
    if (!clientId) {
      throw new Error('Configuration OAuth Google manquante : définissez GOOGLE_CLIENT_ID.');
    }

    const loadedApi = await loadScript();
    const googleApi = loadedApi || getGoogleApi();
    if (!googleApi?.accounts?.oauth2?.initTokenClient) {
      throw new Error('Google Identity Services OAuth 2.0 indisponible.');
    }

    const tokenResponse = await requestPopupAccessToken(googleApi, clientId, prompt, scope);
    const expiresInSec = Number(tokenResponse.expires_in) || 3600;
    const nextExpiresAt = nowFn() + expiresInSec * 1000;

    accessToken = tokenResponse.access_token;
    tokenExpiresAt = nextExpiresAt;
    recordGrantedScopes(tokenResponse.scope || scope);

    try {
      const user = await fetchUserInfo(accessToken);
      return {
        user,
        expiresAt: nextExpiresAt,
        accessToken,
      };
    } catch (err) {
      accessToken = null;
      tokenExpiresAt = 0;
      grantedScopes = new Set();
      throw err;
    }
  }

  async function signOut() {
    const tokenToRevoke = accessToken;
    accessToken = null;
    tokenExpiresAt = 0;
    grantedScopes = new Set();

    if (tokenToRevoke && typeof fetchImpl === 'function') {
      try {
        await fetchImpl(`${OIDC_ENDPOINTS.revoke}?token=${encodeURIComponent(tokenToRevoke)}`, {
          method: 'POST',
        });
      } catch {
        // Offline or network failure during revocation should not prevent local sign-out.
      }
    }

    try {
      getGoogleApi()?.accounts?.id?.disableAutoSelect?.();
    } catch {
      // Safe no-op if GIS is not loaded.
    }
  }

  return {
    isConfigured,
    getAccessToken,
    hasScope,
    ensureAccessToken,
    fetchUserInfo,
    signIn,
    signOut,
  };
}
