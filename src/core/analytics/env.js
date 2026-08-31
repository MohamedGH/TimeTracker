/**
 * Resolves the GA4 Measurement ID from environment configuration.
 *
 * The Measurement ID must never be hardcoded in source. Two sources are
 * supported so this works both today (the app currently ships as plain ES
 * modules with no bundler, see docs/REFACTORING.md Phase 5) and after a
 * future Vite migration:
 *
 * 1. `import.meta.env.VITE_GA4_MEASUREMENT_ID` — used automatically once the
 *    app is built with Vite (or any bundler that statically replaces
 *    `import.meta.env`). Populated from a local `.env` file, see `.env.example`.
 * 2. `window.__TIME_TRACKER_ENV__.GA4_MEASUREMENT_ID` — used in the current
 *    unbundled deployment. It is populated at runtime by `env.js`, a file
 *    that is NOT committed to the repository (see `env.example.js`) and is
 *    generated/deployed alongside `index.html` per environment.
 *
 * If neither source provides a value, analytics stays disabled — the caller
 * is expected to degrade gracefully (see analytics.js).
 */
export function getGa4MeasurementId() {
  const fromBuild = readFromImportMetaEnv();
  if (fromBuild) return fromBuild;

  const fromRuntime = readFromRuntimeGlobal();
  if (fromRuntime) return fromRuntime;

  return null;
}

function readFromImportMetaEnv() {
  try {
    // Guarded behind try/catch: referencing `import.meta` is safe in ES
    // modules, but `import.meta.env` only exists once a bundler injects it.
    const env = import.meta?.env;
    const value = env?.VITE_GA4_MEASUREMENT_ID;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function readFromRuntimeGlobal() {
  try {
    if (typeof window === 'undefined') return null;
    const value = window.__TIME_TRACKER_ENV__?.GA4_MEASUREMENT_ID;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
