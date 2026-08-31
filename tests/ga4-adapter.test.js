import { describe, it, expect, beforeEach } from 'vitest';
import { createGa4Adapter } from '../src/core/analytics/ga4-adapter.js';

function triggerScriptLoad() {
  const script = document.head.querySelector('script[src*="googletagmanager.com"]');
  script?.dispatchEvent(new Event('load'));
  return script;
}

function triggerScriptError() {
  const script = document.head.querySelector('script[src*="googletagmanager.com"]');
  script?.dispatchEvent(new Event('error'));
  return script;
}

beforeEach(() => {
  document.head.innerHTML = '';
  delete window.gtag;
  delete window.dataLayer;
});

describe('createGa4Adapter', () => {
  it('rejects when no measurement id is provided', async () => {
    await expect(createGa4Adapter('')).rejects.toThrow(/manquant/);
  });

  it('injects the gtag.js script with the correct measurement id', async () => {
    const initPromise = createGa4Adapter('G-ABC123');
    const script = document.head.querySelector('script');
    expect(script?.src).toContain('googletagmanager.com/gtag/js?id=G-ABC123');
    triggerScriptLoad();
    await initPromise;
  });

  it('disables the automatic GA4 page_view (the abstraction sends its own)', async () => {
    const initPromise = createGa4Adapter('G-ABC123');
    triggerScriptLoad();
    await initPromise;
    const configCall = window.dataLayer.find(args => args[0] === 'config');
    expect(configCall[2]).toMatchObject({ send_page_view: false });
  });

  it('forwards trackEvent calls to gtag once loaded', async () => {
    const initPromise = createGa4Adapter('G-ABC123');
    triggerScriptLoad();
    const adapter = await initPromise;

    adapter.trackEvent('timer_started', { has_category: true });

    const eventCall = window.dataLayer.find(args => args[0] === 'event');
    expect(eventCall).toEqual(['event', 'timer_started', { has_category: true }]);
  });

  it('rejects if the script fails to load (network unavailable)', async () => {
    const initPromise = createGa4Adapter('G-ABC123');
    triggerScriptError();
    await expect(initPromise).rejects.toThrow(/impossible/);
  });

  it('teardown() prevents further sends without throwing', async () => {
    const initPromise = createGa4Adapter('G-ABC123');
    triggerScriptLoad();
    const adapter = await initPromise;
    adapter.teardown();
    expect(() => adapter.trackEvent('data_cleared', {})).not.toThrow();
  });
});
