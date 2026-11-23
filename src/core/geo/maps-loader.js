/**
 * Google Maps Platform JS API Loader & Case A Demo Quota Defense.
 * Lazy-loads `@googlemaps/js-api-loader` (`setOptions` + `importLibrary`) only when
 * the Dashboard map feature is mounted and a valid API key is present.
 */

export const GOOGLE_MAPS_USAGE_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';
export const DEFAULT_GOOGLE_MAPS_MAP_ID = 'DEMO_MAP_ID';
export const QUOTA_HELP_URL =
  'https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors';

let configuredSignature = null;
let quotaListenerInstalled = false;

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

/**
 * Resolves the dedicated Google Maps JavaScript API key (never falls back to OAuth Client ID).
 */
export function getGoogleMapsApiKey() {
  const fromVite = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      : null
  );
  if (fromVite) return fromVite;

  const fromVitePlain = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.GOOGLE_MAPS_API_KEY
      : null
  );
  if (fromVitePlain) return fromVitePlain;

  return (
    readRuntimeGlobal('GOOGLE_MAPS_API_KEY') ||
    readRuntimeGlobal('VITE_GOOGLE_MAPS_API_KEY') ||
    null
  );
}

/**
 * Resolves the Cloud Map ID (defaults to DEMO_MAP_ID required for AdvancedMarkerElement).
 */
export function getGoogleMapsMapId() {
  const fromVite = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_MAPS_MAP_ID
      : null
  );
  if (fromVite) return fromVite;

  const fromVitePlain = normalizeEnvString(
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.GOOGLE_MAPS_MAP_ID
      : null
  );
  if (fromVitePlain) return fromVitePlain;

  return (
    readRuntimeGlobal('GOOGLE_MAPS_MAP_ID') ||
    readRuntimeGlobal('VITE_GOOGLE_MAPS_MAP_ID') ||
    DEFAULT_GOOGLE_MAPS_MAP_ID
  );
}

/**
 * Registers early global auth/quota detection (`gm_authFailure` + `OverQuotaMapError`)
 * and emits `gmp-quota-exceeded` on `window`.
 */
export function installMapsQuotaListener(win = typeof window !== 'undefined' ? window : null) {
  if (!win || quotaListenerInstalled) return;
  quotaListenerInstalled = true;

  const dispatchQuota = () => {
    try {
      if (typeof CustomEvent !== 'undefined') {
        win.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    } catch {
      // Ignore synthetic dispatch failures in restricted test sandboxes.
    }
  };

  const prevAuthFailure = typeof win.gm_authFailure === 'function' ? win.gm_authFailure : null;
  win.gm_authFailure = () => {
    if (prevAuthFailure) {
      try {
        prevAuthFailure();
      } catch {
        // ignore
      }
    }
    dispatchQuota();
  };

  const origError = console.error;
  console.error = (...args) => {
    origError.apply(console, args);
    const msg = args.map(a => String(a)).join(' ');
    if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
      dispatchQuota();
    }
  };
}

/**
 * Lazily imports `@googlemaps/js-api-loader` and loads `core`, `maps`, and `marker`.
 * The Google Maps script is never downloaded until this function is explicitly called.
 */
export async function loadGoogleMapsLibraries({
  apiKey = getGoogleMapsApiKey(),
  language = 'fr',
  region = 'FR',
  setOptionsFn = null,
  importLibraryFn = null,
} = {}) {
  if (!apiKey) {
    throw new Error('Clé API Google Maps manquante (VITE_GOOGLE_MAPS_API_KEY).');
  }

  let resolvedSetOptions = setOptionsFn;
  let resolvedImportLibrary = importLibraryFn;

  if (!resolvedSetOptions || !resolvedImportLibrary) {
    const loaderMod = await import('@googlemaps/js-api-loader');
    resolvedSetOptions = resolvedSetOptions || loaderMod.setOptions;
    resolvedImportLibrary = resolvedImportLibrary || loaderMod.importLibrary;
  }

  const sig = `${apiKey}::${language}::${region}`;
  if (configuredSignature !== sig) {
    resolvedSetOptions({
      key: apiKey,
      v: 'weekly',
      language,
      region,
    });
    configuredSignature = sig;
  }

  const [coreLib, mapsLib, markerLib] = await Promise.all([
    resolvedImportLibrary('core'),
    resolvedImportLibrary('maps'),
    resolvedImportLibrary('marker'),
  ]);

  return {
    coreLib,
    mapsLib,
    markerLib,
  };
}

/**
 * Resets cached loader signature (primarily for unit tests).
 */
export function resetMapsLoaderForTests() {
  configuredSignature = null;
}
