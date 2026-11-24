/**
 * Pure functional request-routing guards for Vite dev and preview servers.
 * Prevents SPA HTML fallback from serving `<!doctype html>` to JS, CSS,
 * JSON, manifest, or Service Worker requests (which causes
 * `Uncaught SyntaxError: Unexpected token '<'` in browsers).
 */

const NON_HTML_ASSET_EXTENSION_RE = /\.(?:js|mjs|cjs|ts|mts|jsx|tsx|css|map|json|webmanifest|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|wasm)$/i;
const ASSET_PREFIX_RE = /^\/(?:assets|src|@vite|@fs|@id|node_modules)\//;

export const DEV_SW_UNREGISTER_SCRIPT = [
  "self.addEventListener('install', () => self.skipWaiting());",
  "self.addEventListener('activate', (event) => {",
  '  event.waitUntil((async () => {',
  '    try {',
  "      if (typeof caches !== 'undefined') {",
  '        const keys = await caches.keys();',
  '        await Promise.all(keys.map((key) => caches.delete(key)));',
  '      }',
  '    } catch {',
  '      // Ignore cache cleanup errors.',
  '    }',
  '    try {',
  '      await self.registration.unregister();',
  '    } catch {',
  '      // Ignore unregister errors.',
  '    }',
  '  })());',
  '});',
  '',
].join('\n');

export const DEV_REGISTER_SW_CLEANUP_SCRIPT = [
  "if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {",
  '  navigator.serviceWorker.getRegistrations()',
  '    .then((registrations) => Promise.all(registrations.map((reg) => reg.unregister())))',
  '    .catch(() => {});',
  '}',
  '',
].join('\n');

export function stripQueryAndHash(url = '') {
  return String(url || '').split('#')[0].split('?')[0];
}

export function isEnvScriptRequest(url = '') {
  const pathname = stripQueryAndHash(url);
  return pathname === '/env.js' || pathname.endsWith('/env.js');
}

export function resolveDevServiceWorkerCleanupKind(url = '') {
  const pathname = stripQueryAndHash(url);
  if (
    pathname === '/sw.js' ||
    pathname.endsWith('/sw.js') ||
    pathname === '/dev-sw.js' ||
    pathname.endsWith('/dev-sw.js')
  ) {
    return 'sw';
  }
  if (pathname === '/registerSW.js' || pathname.endsWith('/registerSW.js')) {
    return 'register-sw';
  }
  return null;
}

export function isNonHtmlAssetRequest(url = '') {
  const pathname = stripQueryAndHash(url);
  if (!pathname || pathname === '/' || pathname === '/index.html' || pathname.endsWith('.html')) {
    return false;
  }
  return NON_HTML_ASSET_EXTENSION_RE.test(pathname) || ASSET_PREFIX_RE.test(pathname);
}

export function shouldRejectSpaFallbackForRequest({ reqUrl = '', originalUrl = '' } = {}) {
  const currentPath = stripQueryAndHash(reqUrl);
  if (currentPath !== '/index.html') return false;
  const originalPath = stripQueryAndHash(originalUrl);
  if (!originalPath || originalPath === '/index.html') return false;
  return isNonHtmlAssetRequest(originalPath);
}

export function buildRuntimeEnvScript(env = {}) {
  const safeJson = JSON.stringify(env ?? {}).replace(/</g, '\\u003c');
  return `window.__TIME_TRACKER_ENV__ = ${safeJson};\n`;
}

export function buildInlineRuntimeEnvObjectLiteral(env = {}) {
  return JSON.stringify(env ?? {}).replace(/</g, '\\u003c');
}
