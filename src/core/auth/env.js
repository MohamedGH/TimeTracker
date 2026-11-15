/**
 * Resolves Google OAuth 2.0 / OIDC configuration across all supported runtimes
 * (Vite build/dev env, static unbundled env.js, GitHub Pages, AI Studio iframe).
 *
 * Uses static `import.meta.env.VITE_*` property access (no optional chaining on
 * `import.meta` and no bracket lookup) so Vite's dev transform and production
 * `define` replacement inject configured environment variables reliably.
 */

export function getGoogleClientId() {
  const fromVite = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_CLIENT_ID
      : null
  );
  if (fromVite) return fromVite;

  const fromVitePlain = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.GOOGLE_CLIENT_ID
      : null
  );
  if (fromVitePlain) return fromVitePlain;

  const fromRuntime = readRuntimeGlobal('GOOGLE_CLIENT_ID') || readRuntimeGlobal('VITE_GOOGLE_CLIENT_ID');
  if (fromRuntime) return fromRuntime;

  return null;
}

export function getGoogleRedirectUri(locationObj = typeof window !== 'undefined' ? window.location : null) {
  const fromVite = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_REDIRECT_URI
      : null
  );
  if (fromVite) return fromVite;

  const fromVitePlain = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.GOOGLE_REDIRECT_URI
      : null
  );
  if (fromVitePlain) return fromVitePlain;

  const fromRuntime = readRuntimeGlobal('GOOGLE_REDIRECT_URI') || readRuntimeGlobal('VITE_GOOGLE_REDIRECT_URI');
  if (fromRuntime) return fromRuntime;

  if (!locationObj?.origin) return null;
  const pathname = typeof locationObj.pathname === 'string' ? locationObj.pathname : '/';
  return `${locationObj.origin}${pathname}`;
}

function normalizeEnvString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRuntimeGlobal(key) {
  try {
    if (typeof window === 'undefined') return null;
    return normalizeEnvString(window.__TIME_TRACKER_ENV__?.[key]);
  } catch {
    return null;
  }
}
