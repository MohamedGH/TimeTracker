/**
 * GA4-specific adapter. This is the ONLY module in the codebase allowed to
 * know about gtag.js / Google Analytics. Everything else talks to
 * src/core/analytics/analytics.js, which is GA4-agnostic and could be
 * pointed at a different adapter later without touching UI code.
 */

const GTAG_SCRIPT_TIMEOUT_MS = 8000;

/**
 * @param {string} measurementId
 * @returns {Promise<{ trackEvent: (name: string, parameters: object) => void, teardown: () => void }>}
 */
export async function createGa4Adapter(measurementId) {
  if (!measurementId || typeof measurementId !== 'string') {
    throw new Error('Identifiant de mesure GA4 manquant.');
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('L’adaptateur GA4 nécessite un environnement navigateur.');
  }

  await loadGtagScript(measurementId);

  return {
    trackEvent(name, parameters) {
      if (typeof window.gtag !== 'function') return;
      window.gtag('event', name, parameters ?? {});
    },
    teardown() {
      // gtag.js does not expose an official "unload" API; disabling further
      // sends is enough for our purposes (used in tests / consent revocation).
      if (typeof window.gtag === 'function') {
        window.gtag = () => {};
      }
    },
  };
}

function loadGtagScript(measurementId) {
  return new Promise((resolve, reject) => {
    if (typeof window.gtag === 'function') {
      resolve();
      return;
    }

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args) {
      window.dataLayer.push(args);
    };
    window.gtag('js', new Date());
    window.gtag('config', measurementId, {
      anonymize_ip: true,
      // The abstraction layer sends its own page_view events on tab
      // changes (there is no URL router in this app), so the automatic
      // GA4 page_view on script load is disabled to avoid duplicates.
      send_page_view: false,
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;

    const timeout = setTimeout(() => {
      reject(new Error('Chargement du script GA4 : délai dépassé.'));
    }, GTAG_SCRIPT_TIMEOUT_MS);

    script.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Chargement du script GA4 impossible.'));
    };

    document.head.appendChild(script);
  });
}
