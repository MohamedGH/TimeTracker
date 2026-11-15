import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRouteFromHash, createRouteManager, DEFAULT_ROUTE } from '../src/core/route-manager.js';

describe('route-manager', () => {
  describe('parseRouteFromHash', () => {
    it('parses known hashes', () => {
      expect(parseRouteFromHash('#entry')).toBe('entry');
      expect(parseRouteFromHash('#dashboard')).toBe('dashboard');
      expect(parseRouteFromHash('#categories')).toBe('categories');
    });

    it('falls back to default route for unknown or empty hashes', () => {
      expect(parseRouteFromHash('')).toBe(DEFAULT_ROUTE);
      expect(parseRouteFromHash('#unknown-path')).toBe(DEFAULT_ROUTE);
      expect(parseRouteFromHash(null)).toBe(DEFAULT_ROUTE);
    });
  });

  describe('createRouteManager', () => {
    beforeEach(() => {
      window.location.hash = '';
    });

    it('initializes to current hash or default', () => {
      window.location.hash = '#dashboard';
      const router = createRouteManager();
      expect(router.getCurrentRoute()).toBe('dashboard');
    });

    it('navigates to route and updates hash', () => {
      const listener = vi.fn();
      const router = createRouteManager({ onRouteChanged: listener });

      router.navigate('categories');
      expect(router.getCurrentRoute()).toBe('categories');
      expect(window.location.hash).toBe('#categories');
      expect(listener).toHaveBeenCalledWith('categories');
    });

    it('handles hashchange events when started', () => {
      const router = createRouteManager();
      const listener = vi.fn();
      router.subscribe(listener);

      router.start();
      window.location.hash = '#dashboard';
      window.dispatchEvent(new HashChangeEvent('hashchange'));

      expect(router.getCurrentRoute()).toBe('dashboard');
      expect(listener).toHaveBeenCalledWith('dashboard');

      router.destroy();
    });
  });
});
