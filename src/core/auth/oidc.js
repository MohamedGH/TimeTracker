/**
 * Pure functional OpenID Connect (OIDC) & OAuth 2.0 helpers.
 */

export const OIDC_ENDPOINTS = Object.freeze({
  gsiScript: 'https://accounts.google.com/gsi/client',
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  userInfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  revoke: 'https://oauth2.googleapis.com/revoke',
});

export const OIDC_SCOPES = 'openid email profile';

/**
 * Decodes a base64url-encoded string into UTF-8 text.
 */
export function decodeBase64Url(segment) {
  if (typeof segment !== 'string' || !segment) return null;
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLen);
    const binary = atob(padded);
    if (typeof TextDecoder !== 'undefined') {
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return binary;
  } catch {
    return null;
  }
}

/**
 * Parses the payload claims of an OIDC ID Token (JWT) without trusting its signature client-side.
 */
export function parseJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes Google OIDC UserInfo / ID Token claims into a clean app user object.
 */
export function normalizeOidcUser(claims) {
  if (!claims || typeof claims !== 'object') return null;
  const id = String(claims.sub || claims.id || '').trim();
  if (!id) return null;

  const email = typeof claims.email === 'string' && claims.email.trim()
    ? claims.email.trim()
    : null;
  const givenName = typeof claims.given_name === 'string' && claims.given_name.trim()
    ? claims.given_name.trim()
    : (typeof claims.givenName === 'string' && claims.givenName.trim() ? claims.givenName.trim() : null);
  const familyName = typeof claims.family_name === 'string' && claims.family_name.trim()
    ? claims.family_name.trim()
    : (typeof claims.familyName === 'string' && claims.familyName.trim() ? claims.familyName.trim() : null);
  const fallbackName = [givenName, familyName].filter(Boolean).join(' ') || email || 'Utilisateur Google';
  const name = typeof claims.name === 'string' && claims.name.trim()
    ? claims.name.trim()
    : fallbackName;
  const picture = typeof claims.picture === 'string' && claims.picture.trim()
    ? claims.picture.trim()
    : null;

  return {
    id,
    email,
    emailVerified: Boolean(claims.email_verified ?? claims.emailVerified),
    name,
    givenName,
    familyName,
    picture,
    provider: 'google_oidc',
  };
}

/**
 * Checks whether a persisted OIDC profile session is structurally valid and non-expired.
 */
export function isSessionValid(session, nowMs = Date.now()) {
  if (!session || typeof session !== 'object') return false;
  if (!session.user || !String(session.user.id || '').trim()) return false;
  if (session.expiresAt != null) {
    const expiresAt = Number(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  }
  return true;
}

/**
 * Builds a standard OAuth 2.0 / OIDC authorization URL (e.g. Authorization Code + PKCE).
 */
export function buildOidcAuthUrl({
  clientId,
  redirectUri,
  state,
  nonce,
  codeChallenge,
  scope = OIDC_SCOPES,
  responseType = 'code',
  prompt = 'select_account',
} = {}) {
  if (!clientId || !redirectUri) {
    throw new Error('clientId et redirectUri sont requis pour construire l’URL OIDC.');
  }

  const params = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: String(redirectUri),
    response_type: String(responseType),
    scope: String(scope),
    prompt: String(prompt),
  });

  if (state) params.set('state', String(state));
  if (nonce) params.set('nonce', String(nonce));
  if (codeChallenge) {
    params.set('code_challenge', String(codeChallenge));
    params.set('code_challenge_method', 'S256');
  }

  return `${OIDC_ENDPOINTS.authorization}?${params.toString()}`;
}

/**
 * Parses OAuth 2.0 / OIDC callback parameters from a query string or URL fragment.
 */
export function parseOidcCallbackParams(raw = '') {
  const clean = String(raw || '').replace(/^[?#]+/, '');
  if (!clean) return {};
  const params = new URLSearchParams(clean);
  const result = {};
  for (const key of ['code', 'access_token', 'id_token', 'token_type', 'expires_in', 'state', 'scope', 'error', 'error_description']) {
    const val = params.get(key);
    if (val !== null) result[key] = val;
  }
  return result;
}

/**
 * Generates an OAuth 2.0 PKCE verifier & S256 challenge using Web Crypto.
 */
export async function generatePkcePair({ cryptoImpl = globalThis.crypto } = {}) {
  if (!cryptoImpl?.getRandomValues || !cryptoImpl?.subtle) {
    throw new Error('Web Crypto API indisponible pour générer les paramètres PKCE.');
  }
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  const verifier = toBase64Url(bytes);
  const encoded = new TextEncoder().encode(verifier);
  const digest = await cryptoImpl.subtle.digest('SHA-256', encoded);
  const challenge = toBase64Url(new Uint8Array(digest));
  return { verifier, challenge, method: 'S256' };
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
