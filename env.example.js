/**
 * Runtime environment configuration for the CURRENT unbundled deployment
 * (no build step — see docs/REFACTORING.md, Phase 5).
 *
 * Copy this file to `env.js` (gitignored, never commit real values) and
 * load it in time-tracker_1.html BEFORE src/main.js, e.g.:
 *   <script src="env.js"></script>
 *   <script type="module" src="src/main.js"></script>
 *
 * If env.js is absent, GA4 simply stays disabled — the app is unaffected.
 */
window.__TIME_TRACKER_ENV__ = {
  GA4_MEASUREMENT_ID: '', // e.g. "G-XXXXXXXXXX"
};
