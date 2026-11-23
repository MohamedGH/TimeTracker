import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRouteFromHash,
  createRouteManager,
  DEFAULT_ROUTE,
  WIDGET_ROUTES,
} from '../src/core/route-manager.js';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';
import { DEVICE_TYPES, getNavigationProfile } from '../src/core/device-navigation.js';

describe('route-manager', () => {
  describe('parseRouteFromHash', () => {
    it('parses known primary, hub, and dedicated widget hashes', () => {
      expect(parseRouteFromHash('#entry')).toBe('entry');
      expect(parseRouteFromHash('#dashboard')).toBe('dashboard');
      expect(parseRouteFromHash('#categories')).toBe('categories');
      expect(parseRouteFromHash('#pages')).toBe('pages');
      for (const route of WIDGET_ROUTES) {
        expect(parseRouteFromHash(`#${route}`)).toBe(route);
      }
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

  describe('dedicated widget pages isolation & navigation', () => {
    beforeEach(() => {
      window.localStorage.setItem('time-analytics-consent', 'false');
      window.location.hash = '#entry';
    });

    function buildSampleState() {
      return {
        entries: [
          { id: 'e-1', activity: 'Dev', categoryId: 'travail', date: '2026-11-23', start: '09:00', end: '10:00', mins: 60 },
        ],
        activities: [
          { id: 'a-1', label: 'Dev', categoryId: 'travail', useCount: 1 },
        ],
        categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
        activityTemplates: [],
        activeTemplateRun: null,
        activeTimer: null,
        deletedItems: [],
        authUser: null,
        tab: 'entry',
        period: '7',
        customStart: null,
        customEnd: null,
        editingEntryId: null,
        modal: null,
        error: null,
        notice: null,
      };
    }

    const EXPECTED_PAGES = [
      { route: 'templates', heading: 'Gabarits d’activité' },
      { route: 'activities', heading: 'Activités enregistrées' },
      { route: 'entries', heading: 'Dernières entrées' },
      { route: 'data', heading: 'Gestion des données' },
      { route: 'sync', heading: 'Synchronisation multi-appareils' },
      { route: 'account', heading: 'Compte & Authentification' },
      { route: 'mobile', heading: 'Application mobile' },
      { route: 'tiles', heading: 'Tuiles Android & Écran verrouillé' },
    ];

    it('renders only Chrono & Saisie widgets on #entry and opens all 8 dedicated pages via mobile #nav-pages hub', () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const state = buildSampleState();

      const ui = createUI({
        root,
        state,
        persist: vi.fn().mockResolvedValue(undefined),
        authClient: { isConfigured: () => false, signOut: vi.fn() },
        deviceNavControllerFactory: () => ({
          getProfile: () => getNavigationProfile(DEVICE_TYPES.MOBILE),
          refresh: vi.fn(),
          destroy: vi.fn(),
        }),
      });

      // #entry has Chrono & Saisie widgets, NOT the 8 extracted widgets
      const cardTitlesOnEntry = Array.from(root.querySelectorAll('.card-title')).map(el => el.textContent);
      expect(cardTitlesOnEntry).toContain('Chronomètre');
      expect(cardTitlesOnEntry).toContain('Nouvelle session');
      for (const item of EXPECTED_PAGES) {
        expect(cardTitlesOnEntry).not.toContain(item.heading);
      }

      for (const item of EXPECTED_PAGES) {
        root.querySelector('#nav-pages').click();
        expect(state.tab).toBe('pages');
        const hubTile = root.querySelector(`[data-behavior-target="hub-open-${item.route}"]`);
        expect(hubTile).toBeTruthy();
        hubTile.click();

        expect(state.tab).toBe(item.route);
        expect(root.querySelector(`[data-subpage-header="${item.route}"]`)).toBeTruthy();
        const titles = Array.from(root.querySelectorAll('.card-title')).map(el => el.textContent);
        expect(titles).toContain(item.heading);

        // Back button returns cleanly to Chrono & Saisie
        root.querySelector('[data-behavior-target="subpage-back-entry"]').click();
        expect(state.tab).toBe('entry');
      }

      ui.destroy();
      root.remove();
    });

    it('exposes all 8 dedicated widget pages directly in the desktop side-rail', () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const state = buildSampleState();

      const ui = createUI({
        root,
        state,
        persist: vi.fn().mockResolvedValue(undefined),
        authClient: { isConfigured: () => false, signOut: vi.fn() },
        deviceNavControllerFactory: () => ({
          getProfile: () => getNavigationProfile(DEVICE_TYPES.DESKTOP),
          refresh: vi.fn(),
          destroy: vi.fn(),
        }),
      });

      for (const item of EXPECTED_PAGES) {
        const navBtn = root.querySelector(`#nav-${item.route}`);
        expect(navBtn).toBeTruthy();
        navBtn.click();
        expect(state.tab).toBe(item.route);
        const titles = Array.from(root.querySelectorAll('.card-title')).map(el => el.textContent);
        expect(titles).toContain(item.heading);
      }

      ui.destroy();
      root.remove();
    });
  });
});

