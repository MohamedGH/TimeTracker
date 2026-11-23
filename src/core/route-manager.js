/**
 * Route Manager — Lightweight hash-based router for mobile-first SPA.
 * Supports forward/back history in mobile browsers and synchronization with app state.
 */

export const PRIMARY_ROUTES = Object.freeze(['entry', 'dashboard', 'categories']);
export const WIDGET_ROUTES = Object.freeze([
  'templates',
  'activities',
  'entries',
  'data',
  'sync',
  'account',
  'mobile',
  'tiles',
]);
export const VALID_ROUTES = Object.freeze([
  ...PRIMARY_ROUTES,
  'pages',
  ...WIDGET_ROUTES,
]);
export const DEFAULT_ROUTE = 'entry';

/**
 * Extracts normalized route string from a location hash.
 * Pure function: string -> string
 */
export function parseRouteFromHash(hash = '') {
  const clean = String(hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_ROUTES.includes(clean) ? clean : DEFAULT_ROUTE;
}

/**
 * Creates the route manager instance.
 */
export function createRouteManager({ onRouteChanged, defaultRoute = DEFAULT_ROUTE } = {}) {
  let currentRoute = typeof window !== 'undefined'
    ? parseRouteFromHash(window.location.hash)
    : defaultRoute;

  const listeners = new Set();

  function notify(route) {
    if (typeof onRouteChanged === 'function') {
      onRouteChanged(route);
    }
    listeners.forEach(fn => fn(route));
  }

  function handleHashChange() {
    const nextRoute = parseRouteFromHash(window.location.hash);
    if (nextRoute !== currentRoute) {
      currentRoute = nextRoute;
      notify(currentRoute);
    }
  }

  return {
    getCurrentRoute() {
      return currentRoute;
    },

    navigate(route) {
      const normalized = VALID_ROUTES.includes(route) ? route : DEFAULT_ROUTE;
      if (typeof window !== 'undefined') {
        const targetHash = `#${normalized}`;
        if (window.location.hash !== targetHash) {
          window.location.hash = targetHash;
        }
      }
      if (currentRoute !== normalized) {
        currentRoute = normalized;
        notify(currentRoute);
      }
    },

    start() {
      if (typeof window !== 'undefined') {
        window.addEventListener('hashchange', handleHashChange);
        // Synchronize initial hash if not set
        if (!window.location.hash || !VALID_ROUTES.includes(parseRouteFromHash(window.location.hash))) {
          window.location.hash = `#${currentRoute}`;
        }
      }
      return currentRoute;
    },

    destroy() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('hashchange', handleHashChange);
      }
      listeners.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
