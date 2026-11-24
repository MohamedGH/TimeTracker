import { describe, it, expect } from 'vitest';
import {
  DEV_REGISTER_SW_CLEANUP_SCRIPT,
  DEV_SW_UNREGISTER_SCRIPT,
  buildInlineRuntimeEnvObjectLiteral,
  buildRuntimeEnvScript,
  isEnvScriptRequest,
  isNonHtmlAssetRequest,
  resolveDevServiceWorkerCleanupKind,
  shouldRejectSpaFallbackForRequest,
  stripQueryAndHash,
} from '../src/core/dev-server-guards.js';

describe('Vite dev/preview request guards (prevent HTML fallback SyntaxError)', () => {
  it('strips query strings and hashes cleanly', () => {
    expect(stripQueryAndHash('/env.js?v=123#hash')).toBe('/env.js');
    expect(stripQueryAndHash('/assets/index-abc.js?import')).toBe('/assets/index-abc.js');
  });

  it('matches env.js at root and route subpaths but never intercepts /src/ ES modules', () => {
    expect(isEnvScriptRequest('/env.js')).toBe(true);
    expect(isEnvScriptRequest('/TimeTracker/env.js')).toBe(true);
    expect(isEnvScriptRequest('/nested/route/env.js?cache=1')).toBe(true);
    expect(isEnvScriptRequest('/src/core/analytics/env.js')).toBe(false);
    expect(isEnvScriptRequest('/src/core/auth/env.js')).toBe(false);
    expect(isEnvScriptRequest('/environment')).toBe(false);
  });

  it('identifies dev service worker cleanup scripts for sw.js, dev-sw.js, and registerSW.js', () => {
    expect(resolveDevServiceWorkerCleanupKind('/sw.js')).toBe('sw');
    expect(resolveDevServiceWorkerCleanupKind('/dev-sw.js?dev-sw')).toBe('sw');
    expect(resolveDevServiceWorkerCleanupKind('/sub/sw.js')).toBe('sw');
    expect(resolveDevServiceWorkerCleanupKind('/registerSW.js')).toBe('register-sw');
    expect(resolveDevServiceWorkerCleanupKind('/src/main.js')).toBeNull();
    expect(DEV_SW_UNREGISTER_SCRIPT).toContain('self.registration.unregister()');
    expect(DEV_REGISTER_SW_CLEANUP_SCRIPT).toContain('getRegistrations()');
  });

  it('distinguishes non-HTML assets from SPA HTML routes', () => {
    expect(isNonHtmlAssetRequest('/assets/index-old.js')).toBe(true);
    expect(isNonHtmlAssetRequest('/src/missing.js')).toBe(true);
    expect(isNonHtmlAssetRequest('/workbox-afac4cd2.js')).toBe(true);
    expect(isNonHtmlAssetRequest('/@vite-plugin-pwa/pwa-entry-point-loaded')).toBe(true);
    expect(isNonHtmlAssetRequest('/manifest.webmanifest')).toBe(true);
    expect(isNonHtmlAssetRequest('/styles/app.css')).toBe(true);

    expect(isNonHtmlAssetRequest('/')).toBe(false);
    expect(isNonHtmlAssetRequest('/index.html')).toBe(false);
    expect(isNonHtmlAssetRequest('/dashboard')).toBe(false);
    expect(isNonHtmlAssetRequest('/nested/route')).toBe(false);
  });

  it('rejects SPA HTML fallback only when an asset URL was rewritten to /index.html', () => {
    expect(shouldRejectSpaFallbackForRequest({ reqUrl: '/index.html', originalUrl: '/assets/old.js' })).toBe(true);
    expect(shouldRejectSpaFallbackForRequest({ reqUrl: '/index.html', originalUrl: '/workbox-123.js' })).toBe(true);
    expect(shouldRejectSpaFallbackForRequest({ reqUrl: '/index.html', originalUrl: '/dashboard' })).toBe(false);
    expect(shouldRejectSpaFallbackForRequest({ reqUrl: '/index.html', originalUrl: '/' })).toBe(false);
    expect(shouldRejectSpaFallbackForRequest({ reqUrl: '/index.html', originalUrl: '/index.html' })).toBe(false);
    expect(shouldRejectSpaFallbackForRequest({ reqUrl: '/assets/main.js', originalUrl: '/assets/main.js' })).toBe(false);
  });

  it('escapes < characters in generated runtime env scripts so inline HTML parsing cannot break', () => {
    const script = buildRuntimeEnvScript({ TEST: '</script><script>alert(1)' });
    expect(script).toContain('\\u003c/script>');
    expect(script.startsWith('window.__TIME_TRACKER_ENV__ = ')).toBe(true);

    const objLit = buildInlineRuntimeEnvObjectLiteral({ A: '<tag>' });
    expect(objLit).toBe('{"A":"\\u003ctag>"}');
  });
});
