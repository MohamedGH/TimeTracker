import { formatCategoryPath, getDescendants } from './core/category-tree.js';
import { createTimeEntry } from './core/time-entry.js';
import { createActiveTimer, elapsedSeconds, elapsedMinutes } from './core/timer.js';
import { today } from './core/time.js';
import { buildExportPayload, parseImportPayload } from './core/import-export.js';
import { renderCharts, destroyCharts } from './charts/dashboard.js';
import { clearAllData } from './core/storage.js';
import { DEFAULT_CATEGORIES } from './core/model.js';
import { trackEvent, trackPageView, initAnalytics } from './core/analytics/analytics.js';
import { hasConsentDecision, isConsentGranted, setConsentStatus } from './core/analytics/consent.js';
import {
  ANALYTICS_EVENTS,
  timerStartedPayload, timerStoppedPayload, timeEntryCreatedPayload, timeEntryUpdatedPayload,
  savedActivityCreatedPayload,
  dashboardPeriodChangedPayload, dataExportedPayload, dataImportedPayload,
  authEventPayload,
  syncEventPayload,
} from './core/analytics/events.js';
import {
  initBehaviorTracking,
  getBehaviorTracking,
  runPatternDetection,
  getFeatureCandidates,
  getBehaviorDetectionMeta,
} from './core/behavior/index.js';
import { createCategoryBadge } from './core/category-palette.js';
import {
  createCategoryManager,
  renderCategoryEditorModal,
  renderCategoryDeleteConfirmModal,
} from './components/categories/category-manager.js';
import { createRouteManager } from './core/route-manager.js';
import { createErrorManager } from './core/error-manager.js';
import { calculateDashboardStats, filterEntriesByPeriod, formatDuration } from './core/statistics.js';
import {
  getUsualCategoryForActivity,
  generatePersonalizedSuggestions,
} from './core/suggestions-engine.js';
import {
  collectCategoryShortcuts,
  filterShortcutGroups,
} from './core/shortcuts-by-category.js';
import { installCategorySelectors } from './category-selector.js';
import { moveCategory } from './state/category-actions.js';
import { updateActivityAndEntries, moveActivity } from './state/activity-actions.js';
import { createGoogleOidcAuth, DRIVE_APPDATA_SCOPE, DRIVE_SYNC_SCOPES } from './core/auth/index.js';
import { syncWithGoogleDrive, createP2PSyncManager } from './core/sync/index.js';
import { createPwaInstallController } from './core/mobile/index.js';
import {
  NAV_LAYOUTS,
  NAV_ROUTES,
  createDeviceNavigationController,
  resolveRouteShortcutKey,
} from './core/device-navigation.js';

export function createUI({
  root,
  state,
  stateManager: _stateManager,
  persist,
  saveAuthSession = async () => {},
  clearAuthSession = async () => {},
  getSyncPayload = () => ({
    entries: state.entries,
    activities: state.activities,
    categories: state.categories,
    tombstones: {},
    deviceId: 'local',
  }),
  applyMergedSyncState = async (merged) => {
    state.entries = merged.entries;
    state.activities = merged.activities;
    state.categories = merged.categories;
    await persist();
  },
  getSyncMeta = () => ({ deviceId: 'local', lastDriveSyncAt: null, driveAutoSync: false, lastP2pSyncAt: null }),
  saveSyncMeta = async (patch) => ({ ...getSyncMeta(), ...patch }),
  authClient = createGoogleOidcAuth(),
  driveSyncFn = syncWithGoogleDrive,
  p2pManagerFactory = createP2PSyncManager,
  pwaControllerFactory = createPwaInstallController,
  deviceNavControllerFactory = createDeviceNavigationController,
}) {
  let ticker;
  let lastTrackedTab = null;
  const insightsState = {
    running: false,
    lastRunAt: 0,
    lastSignature: null,
    hasCompletedInitialRun: false,
  };
  let entryFormMode = state.editingEntryId ? 'manual' : 'timer'; // 'timer' | 'manual'
  let authBusy = false;
  let driveSyncBusy = false;
  let syncPanelTab = 'drive'; // 'drive' | 'p2p'
  let p2pRole = 'offer'; // 'offer' | 'join'
  let p2pOfferInput = '';
  let p2pAnswerInput = '';

  const pwaController = pwaControllerFactory({
    onChange: () => {
      rerender();
    },
    onInstalled: () => {
      trackEvent(ANALYTICS_EVENTS.PWA_INSTALLED);
      errorManager.notifySuccess('Application installée sur votre appareil !');
      rerender();
    },
  });

  const deviceNavController = deviceNavControllerFactory({
    onChange: (profile) => {
      state.deviceType = profile.deviceType;
      _stateManager?.actions?.setDeviceType?.(profile.deviceType);
      rerender();
    },
  });
  state.deviceType = deviceNavController.getProfile().deviceType;

  const p2pManager = p2pManagerFactory({
    getLocalPayload: getSyncPayload,
    applyMergedPayload: async (merged) => {
      await applyMergedSyncState(merged);
      await saveSyncMeta({ lastP2pSyncAt: new Date().toISOString() });
      trackEvent(ANALYTICS_EVENTS.SYNC_P2P_COMPLETED, syncEventPayload('webrtc_p2p'));
      errorManager.notifySuccess('Synchronisation P2P fusionnée avec succès !');
      rerender();
    },
    onStateChange: () => {
      rerender();
    },
  });

  // Route Manager (Hash Routing & History)
  const routeManager = createRouteManager({
    onRouteChanged: (route) => {
      if (state.tab !== route) {
        state.tab = route;
        state.modal = null;
        state.editingEntryId = null;
        state.error = null;
        rerender();
      }
    },
    defaultRoute: state.tab || 'entry',
  });
  routeManager.start();

  // Error & Notice Manager
  const errorManager = createErrorManager({
    onErrorChanged: ({ error, notice }) => {
      state.error = error?.message || null;
      state.notice = notice;
      renderNoticeBanner();
    },
  });

  const rerender = () => render();

  function openCategoryCreateModal(parentId = null) {
    const parentCategory = parentId ? state.categories.find(c => c.id === parentId) : null;
    state.modal = {
      type: 'custom-category-editor',
      mode: 'create',
      categoryId: null,
      parentId: parentId || null,
      label: '',
      color: parentCategory?.color || null,
    };
    state.error = null;
    rerender();
  }

  function openCategoryEditModal(categoryId) {
    const existing = state.categories.find(c => c.id === categoryId);
    if (!existing) return;
    state.modal = {
      type: 'custom-category-editor',
      mode: 'edit',
      categoryId: existing.id,
      parentId: existing.parentId ?? null,
      label: existing.label || '',
      color: existing.color || null,
    };
    state.error = null;
    rerender();
  }

  function openActivityCreateModal(categoryId = null) {
    state.modal = {
      type: 'activity',
      mode: 'create',
      categoryId: categoryId || state.categories[0]?.id || null,
    };
    state.error = null;
    rerender();
  }

  function openActivityEditModal({ activityId = null, label = '', categoryId = null } = {}) {
    state.modal = {
      type: 'activity',
      mode: 'edit',
      activityId,
      oldLabel: label,
      oldCategoryId: categoryId ?? null,
      label,
      categoryId: categoryId ?? null,
    };
    state.error = null;
    rerender();
  }

  async function handleMoveCategory(categoryId, newParentId = null) {
    try {
      const movedCat = state.categories.find(c => c.id === categoryId);
      const targetParent = newParentId ? state.categories.find(c => c.id === newParentId) : null;
      state.categories = moveCategory(state.categories, categoryId, newParentId ?? null);
      await persist();
      trackEvent('category_moved');
      errorManager.notifySuccess(
        targetParent
          ? `« ${movedCat?.label || 'Catégorie'} » déplacée dans « ${targetParent.label} ».`
          : `« ${movedCat?.label || 'Catégorie'} » placée en catégorie racine.`
      );
      rerender();
    } catch (err) {
      errorManager.handleError(err, 'category');
      rerender();
    }
  }

  async function handleMoveActivity(payload) {
    try {
      const nextSlice = moveActivity(
        {
          activities: state.activities,
          entries: state.entries,
          activeTimer: state.activeTimer,
        },
        payload
      );
      state.activities = nextSlice.activities;
      state.entries = nextSlice.entries;
      state.activeTimer = nextSlice.activeTimer;
      await persist();
      trackEvent('saved_activity_moved');
      const targetCat = payload?.newCategoryId
        ? state.categories.find(c => c.id === payload.newCategoryId)
        : null;
      errorManager.notifySuccess(
        targetCat
          ? `« ${payload.label} » déplacée dans « ${targetCat.label} ».`
          : `« ${payload.label} » placée dans Sans catégorie.`
      );
      rerender();
    } catch (err) {
      errorManager.handleError(err, 'activity');
      rerender();
    }
  }

  const categoryManager = createCategoryManager({
    state,
    persist,
    rerender,
    onStartActivity: (activityName, categoryId) => {
      startTimer(activityName, categoryId || state.categories[0]?.id, today(), nowTime());
    },
    onAddActivity: (categoryId) => openActivityCreateModal(categoryId),
    onEditActivity: (payload) => openActivityEditModal(payload),
    onMoveCategory: handleMoveCategory,
    onMoveActivity: handleMoveActivity,
  });

  function render() {
    destroyCharts();
    categoryManager.destroy();

    const navProfile = deviceNavController.getProfile();
    state.deviceType = navProfile.deviceType;
    root.dataset.deviceType = navProfile.deviceType;
    root.dataset.navLayout = navProfile.navLayout;
    root.classList.remove('app-shell--mobile', 'app-shell--tablet', 'app-shell--desktop');
    root.classList.add('app-shell', navProfile.shellClass);

    if (!hasConsentDecision()) {
      root.replaceChildren(consentBanner());
    } else {
      root.replaceChildren();
    }
    root.appendChild(header());
    trackTabView();

    const main = node('main', 'content mobile-content');
    main.append(
      state.tab === 'entry' ? entryPage() :
      state.tab === 'dashboard' ? dashboardPage() :
      categoriesPage()
    );

    // If timer is running and user is on another tab, show floating mini-timer bar
    if (state.activeTimer && state.tab !== 'entry') {
      main.appendChild(floatingTimerBar());
    }

    const navElement = navigationBar(navProfile);
    if (navProfile.navLayout === NAV_LAYOUTS.TOP_BAR) {
      root.append(navElement, main);
    } else if (navProfile.navLayout === NAV_LAYOUTS.SIDE_RAIL) {
      const workspace = node('div', 'desktop-workspace');
      workspace.append(navElement, main);
      root.appendChild(workspace);
    } else {
      root.append(main, navElement);
    }

    const mobileSnap = pwaController.getSnapshot();
    if (!mobileSnap.isOnline) {
      root.appendChild(offlineIndicatorBanner());
    }

    if (state.modal) root.appendChild(modal());
    renderNoticeBanner();

    if (state.activeTimer) {
      clearInterval(ticker);
      ticker = setInterval(() => {
        const c = root.querySelector('[data-timer-clock]');
        if (c) c.textContent = clock(elapsedSeconds(state.activeTimer));
      }, 1000);
    } else {
      clearInterval(ticker);
    }

    if (state.tab === 'dashboard') requestAnimationFrame(drawCharts);
    installCategorySelectors(root);
  }

  function renderNoticeBanner() {
    const existingToast = root.querySelector('.app-notice-toast');
    existingToast?.remove();

    if (state.error) {
      const toast = node('div', 'app-notice-toast error', state.error);
      const closeBtn = document.createElement('button');
      closeBtn.className = 'toast-close-btn';
      closeBtn.textContent = '×';
      closeBtn.onclick = () => {
        errorManager.clearError();
        toast.remove();
      };
      toast.appendChild(closeBtn);
      root.appendChild(toast);
      return;
    }

    if (state.notice) {
      const toast = node('div', `app-notice-toast ${state.notice.type}`, state.notice.message);
      const closeBtn = document.createElement('button');
      closeBtn.className = 'toast-close-btn';
      closeBtn.textContent = '×';
      closeBtn.onclick = () => {
        errorManager.clearNotice();
        toast.remove();
      };
      toast.appendChild(closeBtn);
      root.appendChild(toast);
    }
  }

  function trackTabView() {
    if (lastTrackedTab === state.tab) return;
    lastTrackedTab = state.tab;
    trackPageView(state.tab);
    getBehaviorTracking()?.tracker.trackNavigation(state.tab);
  }

  function consentBanner() {
    const bar = node('div', 'consent-banner');
    bar.appendChild(node('p', null, 'Carnet du temps peut mesurer une utilisation anonyme (pages consultées, actions) pour s’améliorer. Aucune donnée personnelle (activités, catégories) n’est envoyée.'));
    const actions = node('div', 'consent-banner-actions');
    const accept = button('Accepter', 'secondary');
    accept.onclick = () => {
      setConsentStatus(true);
      initBehaviorTracking({ root });
      initAnalytics();
      rerender();
    };
    const decline = button('Refuser', 'secondary');
    decline.onclick = () => {
      setConsentStatus(false);
      rerender();
    };
    actions.append(accept, decline);
    bar.appendChild(actions);
    return bar;
  }

  function header() {
    const h = node('header', 'app-header mobile-header');
    const brandRow = node('div', 'header-brand-row');
    const brandLeft = node('div', 'header-brand-left');

    const iconWrap = node('div', 'header-app-icon');
    iconWrap.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="13" r="8"/>
      <path d="M12 9v4l2.5 2.5"/>
      <path d="M12 5V2"/>
      <path d="M10 2h4"/>
    </svg>`;

    const titleGroup = node('div', 'header-title-group');
    const title = node('h1', 'lt-title mobile-title', 'Carnet du temps');
    const subtitle = node('span', 'mobile-subtitle', getFormattedCurrentDate());
    titleGroup.append(title, subtitle);
    brandLeft.append(iconWrap, titleGroup);

    const brandRight = node('div', 'header-brand-right');
    if (state.activeTimer) {
      const activeBadge = node('div', 'header-active-timer-badge');
      activeBadge.innerHTML = `<span class="pulse-dot"></span><span>Chrono en cours</span>`;
      activeBadge.onclick = () => {
        routeManager.navigate('entry');
      };
      brandRight.appendChild(activeBadge);
    }

    const mobileSnap = pwaController.getSnapshot();
    if (mobileSnap.shouldShowHeaderInstall) {
      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'header-install-btn';
      installBtn.dataset.behaviorTarget = 'pwa-install-header';
      installBtn.setAttribute('aria-label', 'Installer l’application mobile');
      const dlIcon = node('span', 'header-install-icon');
      dlIcon.setAttribute('aria-hidden', 'true');
      dlIcon.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`;
      installBtn.append(dlIcon, node('span', 'header-install-label', 'Installer'));
      installBtn.onclick = handlePwaInstallClick;
      brandRight.appendChild(installBtn);
    }

    const accountBtn = document.createElement('button');
    accountBtn.type = 'button';
    accountBtn.className = `header-account-btn ${state.authUser ? 'is-signed-in' : ''}`.trim();
    accountBtn.dataset.behaviorTarget = 'account-open';
    accountBtn.setAttribute(
      'aria-label',
      state.authUser ? `Compte connecté : ${state.authUser.name || state.authUser.email}` : 'Se connecter avec Google'
    );
    if (state.authUser) {
      const shortName = String(state.authUser.givenName || state.authUser.name || 'Compte').split(/\s+/)[0];
      accountBtn.append(
        createAvatarNode(state.authUser, 'auth-avatar--xs'),
        node('span', 'header-account-label', shortName)
      );
    } else {
      const icon = node('span', 'header-account-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21a8 8 0 0 0-16 0"/>
        <circle cx="12" cy="8" r="4"/>
      </svg>`;
      accountBtn.append(icon, node('span', 'header-account-label', 'Connexion'));
    }
    accountBtn.onclick = () => {
      state.modal = { type: 'account' };
      state.error = null;
      rerender();
    };
    brandRight.appendChild(accountBtn);

    brandRow.append(brandLeft, brandRight);
    h.appendChild(brandRow);
    return h;
  }

  const NAV_ICONS = {
    entry: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>`,
    dashboard: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 20V10"/>
      <path d="M12 20V4"/>
      <path d="M6 20v-6"/>
    </svg>`,
    categories: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 9h16"/>
      <path d="M4 15h16"/>
      <path d="M10 3L8 21"/>
      <path d="M16 3l-2 18"/>
    </svg>`,
  };

  function navigationBar(navProfile) {
    const nav = node('nav', navProfile.navClass);
    nav.setAttribute('aria-label', 'Navigation principale');
    nav.dataset.deviceType = navProfile.deviceType;
    nav.dataset.navLayout = navProfile.navLayout;

    NAV_ROUTES.forEach(({ id, label, shortLabel, shortcutHint }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `nav-${id}`;
      const isActive = state.tab === id;
      b.className = `mobile-tab-item app-nav-item tab-btn ${isActive ? 'active' : ''}`.trim();
      b.dataset.behaviorTarget = `nav-${id}`;
      b.setAttribute('aria-label', label);
      if (isActive) b.setAttribute('aria-current', 'page');

      const iconWrap = node('span', 'mobile-tab-icon');
      iconWrap.innerHTML = NAV_ICONS[id] || '';
      if (id === 'entry' && state.activeTimer) {
        iconWrap.appendChild(node('span', 'tab-pulse-badge'));
      }

      const text = navProfile.showFullLabels ? label : shortLabel;
      const labelSpan = node('span', 'mobile-tab-label', text);
      b.append(iconWrap, labelSpan);

      if (navProfile.showKeyboardHints && shortcutHint) {
        const kbd = document.createElement('kbd');
        kbd.className = 'nav-kbd-hint';
        kbd.textContent = shortcutHint;
        b.appendChild(kbd);
      }

      b.onclick = () => {
        routeManager.navigate(id);
      };
      nav.appendChild(b);
    });

    return nav;
  }

  function floatingTimerBar() {
    const t = state.activeTimer;
    if (!t) return document.createDocumentFragment();

    const bar = node('div', 'floating-timer-bar');
    const info = node('div', 'floating-timer-info');

    const dot = node('span', 'pulse-dot');
    const act = node('strong', 'floating-timer-activity', t.activity);
    const cat = createCategoryBadge(t.categoryId ?? t.cat, state.categories, { showPath: false, size: 'small' });
    info.append(dot, act, cat);

    const actions = node('div', 'floating-timer-actions');
    const clockNode = node('span', 'floating-timer-clock', clock(elapsedSeconds(t)));
    clockNode.dataset.timerClock = '1';

    const stopBtn = button('Arrêter', 'small danger', 'floating-timer-stop');
    stopBtn.onclick = (e) => {
      e.stopPropagation();
      stopTimer();
    };

    actions.append(clockNode, stopBtn);
    bar.append(info, actions);

    bar.onclick = () => {
      routeManager.navigate('entry');
    };

    return bar;
  }

  function getFormattedCurrentDate() {
    const now = new Date();
    return now.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  function entryPage() {
    const f = document.createDocumentFragment();
    f.append(
      timerCard(),
      quickStartCard(),
      entryCard(),
      activitiesCard(),
      entriesCard(),
      dataCard(),
      syncCard(),
      accountCard(),
      mobileAppCard()
    );
    return f;
  }

  function timerCard() {
    const c = card('Chronomètre');
    if (!state.activeTimer) {
      c.appendChild(node('p', 'muted', 'Aucun chronomètre actif. Lancez une activité en 1 clic ou configurez-la ci-dessous.'));
      return c;
    }
    const t = state.activeTimer;
    const box = node('div', 'timer-active');

    const metaRow = node('div', 'timer-meta-row');
    metaRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;';
    const actLabel = node('strong', null, t.activity);
    const catBadge = createCategoryBadge(t.categoryId ?? t.cat, state.categories, { showPath: true, size: 'small' });
    metaRow.append(actLabel, catBadge);

    const clockNode = node('div', 't-clock', clock(elapsedSeconds(t)));
    clockNode.dataset.timerClock = '1';

    const stop = button('Arrêter le chronomètre', 'danger', 'timer-stop');
    stop.onclick = stopTimer;

    box.append(metaRow, clockNode, stop);
    c.appendChild(box);
    return c;
  }

  /**
   * Priorité UX 1 & 2: Raccourcis de démarrage rapide classés selon la catégorie.
   */
  function quickStartCard() {
    const { groups, totalShortcuts } = collectCategoryShortcuts({
      entries: state.entries,
      activities: state.activities,
      categories: state.categories,
    });

    if (!groups.length) return document.createDocumentFragment();

    const rawFilter = state.shortcutCategoryFilter || 'all';
    const visibleGroups = filterShortcutGroups(groups, rawFilter);
    const activeFilter = visibleGroups.length === groups.length && rawFilter !== 'all'
      ? 'all'
      : rawFilter;

    const applyShortcutFilter = (filterKey) => {
      state.shortcutCategoryFilter = filterKey;
      _stateManager?.actions?.setShortcutCategoryFilter?.(filterKey);
      rerender();
    };

    const c = node('section', 'quick-start-card');
    c.dataset.shortcutsByCategory = 'true';

    const headerRow = node('div', 'quick-start-header');
    const title = node('div', 'quick-start-title');
    title.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>Raccourcis par catégorie</span>`;
    const hint = node('span', 'quick-start-hint', `${totalShortcuts} · 1 clic`);
    headerRow.append(title, hint);
    c.appendChild(headerRow);

    if (groups.length > 1) {
      const filterBar = node('div', 'shortcut-filter-bar');
      filterBar.setAttribute('role', 'tablist');
      filterBar.setAttribute('aria-label', 'Filtrer les raccourcis par catégorie');

      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = `shortcut-filter-btn ${activeFilter === 'all' ? 'is-active' : ''}`.trim();
      allBtn.dataset.behaviorTarget = 'shortcut-filter-all';
      allBtn.dataset.shortcutFilter = 'all';
      allBtn.setAttribute('aria-pressed', String(activeFilter === 'all'));
      allBtn.textContent = `Toutes (${totalShortcuts})`;
      allBtn.onclick = () => applyShortcutFilter('all');
      filterBar.appendChild(allBtn);

      for (const group of groups) {
        const filterBtn = document.createElement('button');
        filterBtn.type = 'button';
        const isActive = activeFilter === group.filterKey;
        filterBtn.className = `shortcut-filter-btn ${isActive ? 'is-active' : ''}`.trim();
        filterBtn.dataset.behaviorTarget = 'shortcut-filter-category';
        filterBtn.dataset.shortcutFilter = group.filterKey;
        filterBtn.setAttribute('aria-pressed', String(isActive));
        filterBtn.textContent = `${group.label} (${group.count})`;
        filterBtn.onclick = () => applyShortcutFilter(group.filterKey);
        filterBar.appendChild(filterBtn);
      }

      c.appendChild(filterBar);
    }

    const groupsWrap = node('div', 'shortcut-groups-list');
    for (const group of visibleGroups) {
      const groupBox = node('div', 'shortcut-category-group');
      groupBox.dataset.shortcutCategory = group.filterKey;

      const groupHeader = node('div', 'shortcut-category-header');
      const catBadge = createCategoryBadge(group.categoryId, state.categories, { showPath: true, size: 'small' });
      const countBadge = node('span', 'shortcut-category-count', String(group.shortcuts.length));
      groupHeader.append(catBadge, countBadge);
      groupBox.appendChild(groupHeader);

      const chips = node('div', 'quick-chips-grid');
      for (const item of group.shortcuts) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'quick-chip';
        chip.dataset.behaviorTarget = 'quick-shortcut-start';
        chip.setAttribute('aria-label', `Démarrer ${item.name} (${group.pathLabel})`);

        const iconSpan = document.createElement('span');
        iconSpan.className = 'quick-chip-icon';
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;

        const nameSpan = node('span', 'quick-chip-name', item.name);
        chip.append(iconSpan, nameSpan);

        if (item.count > 0) {
          chip.appendChild(node('span', 'quick-chip-count', `${item.count}×`));
        }

        chip.onclick = () => {
          trackEvent('saved_activity_started');
          startTimer(item.name, item.categoryId || state.categories[0]?.id, today(), nowTime());
        };
        chips.appendChild(chip);
      }

      groupBox.appendChild(chips);
      groupsWrap.appendChild(groupBox);
    }

    c.appendChild(groupsWrap);
    return c;
  }

  /**
   * Priorité UX 3, 4 & 5:
   * - Mémorisation automatique de la catégorie habituelle
   * - Réduction des champs et clics inutiles
   * - Saisie manuelle secondaire mais toujours disponible
   */
  function entryCard() {
    const isEditing = Boolean(state.editingEntryId);
    const old = state.entries.find(e => e.id === state.editingEntryId);
    const c = card(isEditing ? 'Modifier une entrée' : 'Nouvelle session');

    // Mode Toggle: Chronomètre direct vs Saisie manuelle différée
    if (!isEditing) {
      const toggleRow = node('div', 'entry-mode-toggle');
      const chronoModeBtn = document.createElement('button');
      chronoModeBtn.type = 'button';
      chronoModeBtn.className = `mode-toggle-btn ${entryFormMode === 'timer' ? 'active' : ''}`;
      chronoModeBtn.dataset.behaviorTarget = 'entry-mode-timer';
      chronoModeBtn.textContent = '⏱️ Démarrer un chrono';
      chronoModeBtn.onclick = () => {
        entryFormMode = 'timer';
        rerender();
      };

      const manualModeBtn = document.createElement('button');
      manualModeBtn.type = 'button';
      manualModeBtn.className = `mode-toggle-btn ${entryFormMode === 'manual' ? 'active' : ''}`;
      manualModeBtn.dataset.behaviorTarget = 'entry-mode-manual';
      manualModeBtn.textContent = '📝 Saisie manuelle';
      manualModeBtn.onclick = () => {
        entryFormMode = 'manual';
        rerender();
      };

      toggleRow.append(chronoModeBtn, manualModeBtn);
      c.appendChild(toggleRow);
    }

    const form = node('form', 'entry-form');
    form.dataset.behaviorForm = 'entry-form';

    const activity = input('Activité', 'text', old?.activity || '', true, 'activity');
    const category = selectCategory(old?.categoryId);

    // Auto-memorization: when typing an activity, automatically discover and select the usual category!
    activity.input.addEventListener('input', () => {
      const val = activity.input.value.trim();
      if (!val) return;
      const usualCatId = getUsualCategoryForActivity(val, state.entries, state.activities);
      if (usualCatId && category.select.value !== usualCatId) {
        category.select.value = usualCatId;
        category.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    attachActivitySuggestions(activity, category);

    form.append(activity.wrap, category.wrap);

    // Manual fields (date, start, end)
    const manualFieldsWrap = node('div', `manual-entry-fields ${!isEditing && entryFormMode === 'timer' ? 'is-collapsed' : ''}`);
    const date = input('Date', 'date', old?.date || today(), true, 'date');
    const start = input('Début', 'time', old?.start || defaultStartTime(), true, 'start');
    const end = input('Fin', 'time', old?.end || nowTime(), true, 'end');

    const row = node('div', 'row');
    row.append(date.wrap, start.wrap, end.wrap);
    manualFieldsWrap.appendChild(row);
    form.appendChild(manualFieldsWrap);

    // Action buttons based on active mode
    if (!isEditing && entryFormMode === 'timer') {
      const timerBtn = button('▶ Démarrer le chronomètre', 'primary', 'timer-start');
      timerBtn.type = 'button';
      timerBtn.onclick = () => {
        const actName = activity.input.value.trim();
        const catId = category.select.value;
        if (!actName) {
          errorManager.handleError(new Error('Veuillez saisir un nom d’activité.'), 'entry');
          return;
        }
        startTimer(actName, catId || state.categories[0]?.id, today(), nowTime());
      };
      form.appendChild(timerBtn);
    } else {
      const saveBtn = button(old ? 'Enregistrer les modifications' : 'Enregistrer la session', 'primary', 'entry-save');
      saveBtn.type = 'submit';
      form.appendChild(saveBtn);
    }

    if (old) {
      const cancel = button('Annuler', 'secondary', 'entry-cancel');
      cancel.onclick = () => {
        state.editingEntryId = null;
        rerender();
      };
      form.appendChild(cancel);
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const value = createTimeEntry({
        id: old?.id || crypto.randomUUID(),
        activity: activity.input.value,
        categoryId: category.select.value || null,
        date: date.input.value,
        start: start.input.value,
        end: end.input.value,
        viaTimer: old ? old.viaTimer : false,
      });

      if (!value.activity || value.mins <= 0) {
        errorManager.handleError(new Error('Vérifiez l’activité et les horaires.'), 'entry');
        getBehaviorTracking()?.tracker.trackFormResult('entry-form', 'error', { object: 'time_entry', code: 'invalid-entry' });
        return;
      }

      state.entries = old ? state.entries.map(x => x.id === old.id ? value : x) : [value, ...state.entries];
      state.editingEntryId = null;
      state.error = null;
      await persist();
      trackEvent(
        old ? 'time_entry_updated' : 'time_entry_created',
        old ? timeEntryUpdatedPayload({ durationMinutes: value.mins, hasCategory: Boolean(value.categoryId) }) :
              timeEntryCreatedPayload({ durationMinutes: value.mins, hasCategory: Boolean(value.categoryId), viaTimer: Boolean(value.viaTimer) })
      );
      getBehaviorTracking()?.tracker.trackFormResult('entry-form', 'success', { object: 'time_entry' });
      errorManager.notifySuccess(old ? 'Modifications enregistrées.' : 'Session enregistrée !');
      rerender();
    };

    c.appendChild(form);
    return c;
  }

  function defaultStartTime() {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function attachActivitySuggestions(activity, category) {
    const listId = `activity-suggestions-${crypto.randomUUID()}`;
    const datalist = document.createElement('datalist');
    datalist.id = listId;
    activity.input.setAttribute('list', listId);
    activity.wrap.appendChild(datalist);

    const visibleList = node('div', 'activity-suggestions');
    activity.wrap.appendChild(visibleList);

    const refresh = () => {
      const selectedId = category.select.value;
      datalist.replaceChildren();
      visibleList.replaceChildren();

      if (!selectedId) {
        visibleList.appendChild(node('p', 'muted', 'Choisissez une catégorie pour voir les activités habituelles.'));
        return;
      }

      const allowed = new Set([selectedId, ...getDescendants(state.categories, selectedId).map(x => x.id)]);
      const seen = new Set();
      const matches = [];

      for (const a of state.activities) {
        const name = String(a.label || a.name || a.activity || '').trim();
        const categoryId = a.categoryId ?? a.cat;
        if (!name || !categoryId || !allowed.has(categoryId) || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        matches.push(name);
      }

      // Also include any activity from entries belonging to this category
      for (const e of state.entries) {
        const name = String(e.activity || '').trim();
        if (!name || !e.categoryId || !allowed.has(e.categoryId) || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        matches.push(name);
      }

      if (!matches.length) {
        visibleList.appendChild(node('p', 'muted', 'Aucune activité enregistrée pour cette catégorie.'));
        return;
      }

      for (const name of matches.slice(0, 5)) {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);

        const chip = button(name, 'small secondary', 'activity-suggestion-select');
        chip.type = 'button';
        chip.onclick = () => {
          activity.input.value = name;
          activity.input.focus();
          const catId = getUsualCategoryForActivity(name, state.entries, state.activities);
          if (catId && category.select.value !== catId) {
            category.select.value = catId;
            category.select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        visibleList.appendChild(chip);
      }
    };

    category.select.addEventListener('change', refresh);
    refresh();
  }

  function activitiesCard() {
    const c = card('Activités enregistrées');
    const add = button('Ajouter une activité', 'secondary', 'activity-add-open');
    add.onclick = () => {
      state.modal = { type: 'activity' };
      state.error = null;
      rerender();
    };
    c.appendChild(add);

    for (const a of state.activities) {
      const r = node('div', 'entry-row');
      const infoWrap = node('div');
      const headerRow = node('div', 'entry-header');
      headerRow.appendChild(node('strong', null, a.label || a.activity || ''));
      headerRow.appendChild(createCategoryBadge(a.categoryId, state.categories, { showPath: true, size: 'small' }));
      infoWrap.appendChild(headerRow);
      r.appendChild(infoWrap);

      const go = button('Démarrer', 'small', 'activity-start');
      go.onclick = () => {
        trackEvent('saved_activity_started');
        startTimer(a.label || a.activity, a.categoryId, today(), nowTime());
      };
      const del = button('×', 'small danger', 'activity-delete');
      del.onclick = async () => {
        state.activities = state.activities.filter(x => x.id !== a.id);
        await persist();
        trackEvent('saved_activity_deleted');
        rerender();
      };
      r.append(go, del);
      c.appendChild(r);
    }
    return c;
  }

  function entriesCard() {
    const c = card('Dernières entrées');
    if (!state.entries.length) {
      c.appendChild(node('p', 'empty', 'Aucune session enregistrée.'));
      return c;
    }

    for (const e of state.entries.slice(0, 20)) {
      const r = node('div', 'entry-row');
      const info = node('div');

      const headerRow = node('div', 'entry-header');
      headerRow.appendChild(node('strong', null, e.activity));
      headerRow.appendChild(createCategoryBadge(e.categoryId, state.categories, { showPath: true, size: 'small' }));
      info.appendChild(headerRow);

      const meta = node('div', 'entry-meta', `${e.date} · ${e.start}–${e.end} · ${formatDuration(e.mins)}`);
      info.appendChild(meta);

      const edit = button('Modifier', 'small', 'entry-edit');
      edit.onclick = () => {
        state.editingEntryId = e.id;
        entryFormMode = 'manual';
        rerender();
        root.querySelector('.entry-form')?.scrollIntoView?.({ behavior: 'smooth' });
      };

      const del = button('Supprimer', 'small danger', 'entry-delete');
      del.onclick = async () => {
        state.entries = state.entries.filter(x => x.id !== e.id);
        await persist();
        trackEvent('time_entry_deleted');
        errorManager.notifySuccess('Entrée supprimée.');
        rerender();
      };

      r.append(info, edit, del);
      c.appendChild(r);
    }
    return c;
  }

  /**
   * Priorité UX 7 & 8: Dashboard répondant directement à:
   * 1. Combien de temps aujourd'hui ?
   * 2. Où ai-je passé mon temps ?
   * 3. Quelles catégories prennent le plus de temps ?
   * 4. Quelles activités reviennent le plus souvent ?
   */
  function dashboardPage() {
    const f = document.createDocumentFragment();

    // Period selectors
    const periods = node('div', 'period-tabs');
    const periodDefs = [
      { id: 'today', label: 'Aujourd’hui' },
      { id: '7', label: '7 jours' },
      { id: '30', label: '30 jours' },
      { id: 'month', label: 'Ce mois' },
      { id: 'all', label: 'Tout' },
    ];

    for (const p of periodDefs) {
      const b = button(p.label, state.period === p.id ? 'active' : 'secondary', `dashboard-period-${p.id}`);
      b.onclick = () => {
        state.period = p.id;
        trackEvent('dashboard_period_changed', dashboardPeriodChangedPayload({ period: p.id }));
        rerender();
      };
      periods.appendChild(b);
    }
    f.appendChild(periods);

    // Calculate core statistics
    const stats = calculateDashboardStats(state.entries, state.categories, state.period);

    // KPI Cards: Answering "Combien de temps aujourd'hui ?" and "Où passe mon temps ?"
    const kpiGrid = node('div', 'dashboard-kpi-grid');
    kpiGrid.append(
      kpiCard('Aujourd’hui', stats.formattedToday, 'Temps de la journée', true),
      kpiCard('Total période', stats.formattedTotal, `${stats.entryCount} session${stats.entryCount > 1 ? 's' : ''}`),
      kpiCard('Jours actifs', String(stats.activeDaysCount), 'Jours suivis'),
      kpiCard('Moyenne / jour', stats.formattedDailyAverage, 'Par jour actif')
    );
    f.appendChild(kpiGrid);

    // Section 1: Où ai-je passé mon temps & Quelles catégories prennent le plus de temps ?
    const categoryCard = card('Répartition par catégorie');
    if (!stats.categoryBreakdown.length) {
      categoryCard.appendChild(node('p', 'muted', 'Aucune donnée sur cette période.'));
    } else {
      const list = node('div', 'category-breakdown-list');
      for (const item of stats.categoryBreakdown.slice(0, 8)) {
        const itemWrap = node('div', 'category-breakdown-item');
        const header = node('div', 'category-item-header');

        const left = node('div', 'category-item-left');
        const dot = node('span', 'category-color-dot');
        dot.style.background = item.color;
        const name = node('strong', null, item.label);
        left.append(dot, name);

        const right = node('div', 'category-item-right');
        const time = node('span', 'category-item-time', item.formattedTotal);
        const pct = node('span', 'category-item-pct', item.percentageFormatted);
        right.append(time, pct);

        header.append(left, right);

        const track = node('div', 'category-bar-track');
        const fill = node('div', 'category-bar-fill');
        fill.style.width = `${Math.min(100, Math.max(2, item.percentage))}%`;
        fill.style.background = item.color;
        track.appendChild(fill);

        itemWrap.append(header, track);
        list.appendChild(itemWrap);
      }
      categoryCard.appendChild(list);
    }
    f.appendChild(categoryCard);

    // Section 2: Quelles activités reviennent le plus souvent ?
    const topActivitiesCard = card('Activités fréquentes');
    if (!stats.topActivities.length) {
      topActivitiesCard.appendChild(node('p', 'muted', 'Aucune activité fréquente répertoriée.'));
    } else {
      const list = node('div', 'top-activities-list');
      for (const item of stats.topActivities) {
        const row = node('div', 'top-activity-item');

        const info = node('div', 'top-activity-info');
        const titleRow = node('div', 'top-activity-title-row');
        titleRow.appendChild(node('strong', null, item.name));
        titleRow.appendChild(createCategoryBadge(item.categoryId, state.categories, { showPath: false, size: 'small' }));
        info.appendChild(titleRow);

        const meta = node('div', 'top-activity-meta', `${item.count} session${item.count > 1 ? 's' : ''} · ${item.formattedTotal} (moy. ${item.formattedAvg})`);
        info.appendChild(meta);

        const action = node('div', 'top-activity-action');
        const launchBtn = button('Relancer', 'small', 'top-activity-launch');
        launchBtn.onclick = () => {
          startTimer(item.name, item.categoryId || state.categories[0]?.id, today(), nowTime());
        };
        action.appendChild(launchBtn);

        row.append(info, action);
        list.appendChild(row);
      }
      topActivitiesCard.appendChild(list);
    }
    f.appendChild(topActivitiesCard);

    // Section 3: Visual Charts
    const chart = card('Graphiques détaillés');
    chart.append(node('h3', 'chart-title', 'Temps par jour'));
    const dc = document.createElement('canvas');
    dc.id = 'day-chart';
    chart.appendChild(dc);

    chart.append(node('h3', 'chart-title', 'Répartition par heure de la journée'));
    const hc = document.createElement('canvas');
    hc.id = 'hour-chart';
    chart.appendChild(hc);

    chart.append(node('h3', 'chart-title', 'Arborescence interactive Catégories & Activités'));
    const cc = document.createElement('div');
    cc.id = 'category-tree-chart';
    chart.appendChild(cc);

    f.appendChild(chart);

    // Section 4: Suggestions personnalisées (Observations & Hypothèses)
    f.appendChild(insightsCard());

    return f;
  }

  function kpiCard(title, value, subtext, highlight = false) {
    const cardNode = node('div', `kpi-card ${highlight ? 'highlight' : ''}`);
    cardNode.append(
      node('span', 'kpi-label', title),
      node('span', 'kpi-value', value),
      node('span', 'kpi-subtext', subtext)
    );
    return cardNode;
  }

  const BEHAVIOR_KIND_LABELS = {
    workflow: 'Parcours récurrent',
    abandonment: 'Formulaire interrompu',
    repetition: 'Répétitions rapides',
  };

  function confidenceModifier(level) {
    if (level === 'élevée') return 'high';
    if (level === 'modérée') return 'medium';
    return 'low';
  }

  function renderProvenanceRow({ rule, occurrences, sessionCount, sessionUnit = 'sessions', periodLabel, confidence }) {
    const row = node('div', 'suggestion-provenance');
    if (rule) row.appendChild(node('span', 'suggestion-meta-chip', `Règle : ${rule}`));
    if (Number.isFinite(occurrences) && occurrences > 0) {
      row.appendChild(node('span', 'suggestion-meta-chip', `${occurrences} occurrence${occurrences > 1 ? 's' : ''}`));
    }
    if (Number.isFinite(sessionCount) && sessionCount > 0) {
      const singular = sessionUnit.endsWith('s') ? sessionUnit.slice(0, -1) : sessionUnit;
      row.appendChild(node('span', 'suggestion-meta-chip', `${sessionCount} ${sessionCount > 1 ? sessionUnit : singular}`));
    }
    if (periodLabel) {
      row.appendChild(node('span', 'suggestion-meta-chip', `Période : ${periodLabel}`));
    }
    if (confidence?.label) {
      const mod = confidenceModifier(confidence.level);
      row.appendChild(node('span', `suggestion-meta-chip suggestion-confidence suggestion-confidence--${mod}`, `Confiance : ${confidence.label}`));
    }
    return row;
  }

  function computeBehaviorCandidatesSignature(candidates) {
    return candidates
      .map(c => `${c.id}:${c.occurrences}:${c.supportSessions}:${c.confidence?.score ?? 0}`)
      .join('|');
  }

  function scheduleInsightsRefresh(currentSignature) {
    if (!isConsentGranted()) return;
    const behavior = getBehaviorTracking();
    if (!behavior || insightsState.running) return;

    const meta = getBehaviorDetectionMeta();
    const now = Date.now();
    const neverRan = meta.lastRunAt === 0 && !insightsState.hasCompletedInitialRun;
    const cooldownElapsed = (now - Math.max(insightsState.lastRunAt, meta.lastRunAt)) > 60_000;

    if (!neverRan && !cooldownElapsed) return;

    insightsState.running = true;
    insightsState.lastRunAt = now;

    runPatternDetection()
      .then(() => {
        const updatedCandidates = getFeatureCandidates({ limit: 4 });
        const updatedSignature = computeBehaviorCandidatesSignature(updatedCandidates);
        const wasFirstRun = !insightsState.hasCompletedInitialRun;
        insightsState.hasCompletedInitialRun = true;
        insightsState.lastRunAt = Date.now();
        insightsState.lastSignature = updatedSignature;
        insightsState.running = false;
        if (state.tab === 'dashboard' && (updatedSignature !== currentSignature || wasFirstRun)) {
          rerender();
        }
      })
      .catch(() => {
        insightsState.running = false;
      });
  }

  /**
   * Observations & Suggestions personnalisées :
   * Sépare strictement les observations métier (habitudes personnelles)
   * et les hypothèses comportementales locales (utilisation de TimeTracker).
   */
  function insightsCard() {
    const c = card('Observations & Suggestions personnalisées');
    c.dataset.insightsCard = 'true';

    // -------------------------------------------------------------------------
    // Section A : Habitudes personnelles (moteur métier local)
    // -------------------------------------------------------------------------
    const personalSection = node('div', 'insights-section');
    personalSection.dataset.insightsSection = 'business';
    const personalHeader = node('div', 'insights-section__header');
    personalHeader.append(
      node('h3', 'insights-section__title', 'Habitudes personnelles'),
      node('span', 'insights-section__subtitle', 'Données métier locales : sessions, horaires, catégories')
    );
    personalSection.appendChild(personalHeader);

    const personalList = node('div', 'suggestions-list');
    const nowDate = new Date();
    const personalSuggestions = generatePersonalizedSuggestions({
      entries: state.entries,
      activities: state.activities,
      categories: state.categories,
      currentHour: nowDate.getHours(),
      currentMinute: nowDate.getMinutes(),
    });

    for (const item of personalSuggestions) {
      const isStatus = item.status === 'insufficient_data' || item.status === 'no_trend';
      const box = node('div', `suggestion-box${isStatus ? ' suggestion-box--status' : ''}`);
      box.dataset.suggestionKind = item.kind || 'observation';
      box.dataset.suggestionStatus = item.status || item.type;

      const badgeRow = node('div', 'suggestion-badge-row');
      const badgeTone = isStatus ? 'neutral' : item.type;
      badgeRow.append(
        node('span', `suggestion-badge ${badgeTone}`, item.badge),
        node('span', 'suggestion-title', item.title)
      );
      box.appendChild(badgeRow);
      box.appendChild(node('p', 'suggestion-message', item.message));

      const sessionUnit = item.kind === 'usage_mode' ? 'sessions connues' : 'jours';
      box.appendChild(renderProvenanceRow({
        rule: item.rule,
        occurrences: item.occurrences,
        sessionCount: item.sessionCount,
        sessionUnit,
        periodLabel: item.periodLabel,
        confidence: isStatus ? null : item.confidence,
      }));

      if (item.action) {
        const actionRow = node('div', 'suggestion-action-row');
        const startBtn = button(item.action.label, 'small primary', 'suggestion-start-activity');
        startBtn.onclick = () => {
          startTimer(item.action.activity, item.action.categoryId || state.categories[0]?.id, today(), nowTime());
        };
        actionRow.appendChild(startBtn);
        box.appendChild(actionRow);
      }

      personalList.appendChild(box);
    }
    personalSection.appendChild(personalList);
    c.appendChild(personalSection);

    // -------------------------------------------------------------------------
    // Section B : Utilisation de TimeTracker (moteur comportemental local)
    // -------------------------------------------------------------------------
    const behaviorSection = node('div', 'insights-section');
    behaviorSection.dataset.insightsSection = 'behavior';
    const behaviorHeader = node('div', 'insights-section__header');
    const behaviorTitleWrap = node('div', 'insights-section__title-row');
    behaviorTitleWrap.append(
      node('h3', 'insights-section__title', 'Utilisation de TimeTracker'),
      node('span', 'insights-privacy-pill', '100 % local · jamais transmis')
    );
    behaviorHeader.append(
      behaviorTitleWrap,
      node('span', 'insights-section__subtitle', 'Parcours récurrents, formulaires et points de friction potentiels')
    );
    behaviorSection.appendChild(behaviorHeader);

    const behaviorList = node('div', 'suggestions-list');
    const consentGranted = isConsentGranted();
    const behaviorInstance = getBehaviorTracking();

    if (!consentGranted) {
      const box = node('div', 'suggestion-box suggestion-box--status');
      box.dataset.suggestionStatus = 'consent_disabled';
      const badgeRow = node('div', 'suggestion-badge-row');
      badgeRow.append(
        node('span', 'suggestion-badge neutral', 'Suivi désactivé'),
        node('span', 'suggestion-title', 'Consentement requis pour l’analyse d’interface')
      );
      box.appendChild(badgeRow);
      box.appendChild(node(
        'p',
        'suggestion-message',
        'L’analyse locale des parcours et points de friction est désactivée. Vos habitudes personnelles ci-dessus continuent de fonctionner uniquement à partir de vos entrées.'
      ));
      behaviorList.appendChild(box);
    } else if (!behaviorInstance) {
      const box = node('div', 'suggestion-box suggestion-box--status');
      box.dataset.suggestionStatus = 'insufficient_data';
      const badgeRow = node('div', 'suggestion-badge-row');
      badgeRow.append(
        node('span', 'suggestion-badge neutral', 'En attente'),
        node('span', 'suggestion-title', 'Collecteur local non actif')
      );
      box.appendChild(badgeRow);
      box.appendChild(node('p', 'suggestion-message', 'Les observations d’utilisation apparaîtront ici dès que le collecteur comportemental local sera initialisé.'));
      behaviorList.appendChild(box);
    } else {
      const candidates = getFeatureCandidates({ limit: 4 });
      const currentSignature = computeBehaviorCandidatesSignature(candidates);
      scheduleInsightsRefresh(currentSignature);

      const meta = getBehaviorDetectionMeta();
      if (!candidates.length) {
        const box = node('div', 'suggestion-box suggestion-box--status');
        const isAnalyzing = insightsState.running && !insightsState.hasCompletedInitialRun && meta.lastRunAt === 0;
        const isInsufficient = !isAnalyzing && meta.eventCountAtRun >= 0 && meta.eventCountAtRun < 4;
        box.dataset.suggestionStatus = isInsufficient ? 'insufficient_data' : 'no_trend';

        const badgeRow = node('div', 'suggestion-badge-row');
        badgeRow.append(
          node('span', 'suggestion-badge neutral', isAnalyzing ? 'Analyse en cours' : isInsufficient ? 'Données insuffisantes' : 'Aucune tendance'),
          node('span', 'suggestion-title', isAnalyzing ? 'Détection locale en cours…' : isInsufficient ? 'Historique d’interactions court' : 'Aucune friction ou routine d’interface détectée')
        );
        box.appendChild(badgeRow);
        box.appendChild(node(
          'p',
          'suggestion-message',
          isAnalyzing
            ? 'Analyse des interactions locales en cours sur votre appareil…'
            : isInsufficient
              ? `Données encore insuffisantes (${meta.eventCountAtRun} interaction${meta.eventCountAtRun > 1 ? 's' : ''}) pour formuler une hypothèse fiable.`
              : 'Aucune séquence répétée multi-sessions ni point de friction notable observé pour le moment.'
        ));
        if (!isAnalyzing) {
          box.appendChild(renderProvenanceRow({
            rule: isInsufficient ? 'Échantillon minimal comportemental non atteint' : 'Seuils multi-sessions non atteints',
            occurrences: meta.eventCountAtRun > 0 ? meta.eventCountAtRun : 0,
            periodLabel: 'Historique local',
          }));
        }
        behaviorList.appendChild(box);
      } else {
        for (const candidate of candidates) {
          const box = node('div', 'suggestion-box');
          box.dataset.suggestionKind = candidate.kind || 'workflow';
          box.dataset.suggestionStatus = candidate.status || 'hypothesis';

          const badgeRow = node('div', 'suggestion-badge-row');
          const kindLabel = BEHAVIOR_KIND_LABELS[candidate.kind] || candidate.category || 'Utilisation';
          badgeRow.append(
            node('span', 'suggestion-badge hypothesis', 'Hypothèse à confirmer'),
            node('span', 'suggestion-title', kindLabel)
          );
          box.appendChild(badgeRow);
          box.appendChild(node('p', 'suggestion-message', candidate.description));
          box.appendChild(renderProvenanceRow({
            rule: candidate.rule,
            occurrences: candidate.occurrences,
            sessionCount: candidate.supportSessions,
            sessionUnit: 'sessions',
            periodLabel: candidate.periodLabel,
            confidence: candidate.confidence,
          }));
          behaviorList.appendChild(box);
        }
      }
    }

    behaviorSection.appendChild(behaviorList);
    c.appendChild(behaviorSection);
    return c;
  }

  function categoriesPage() {
    return categoryManager.render();
  }

  function modal() {
    const m = state.modal;
    if (!m) return document.createDocumentFragment();

    if (m.type === 'custom-category-editor') {
      return renderCategoryEditorModal({ state, modal: m, persist, rerender });
    }

    if (m.type === 'custom-category-delete-confirm') {
      return renderCategoryDeleteConfirmModal({ state, modal: m, persist, rerender });
    }

    if (m.type === 'category' || m.type === 'rename') {
      const mode = m.type === 'rename' ? 'edit' : 'create';
      return renderCategoryEditorModal({
        state,
        modal: {
          mode,
          categoryId: m.id || null,
          parentId: m.parentId ?? null,
          color: m.color || null,
          label: m.label || '',
        },
        persist,
        rerender,
      });
    }

    const overlay = node('div', 'modal-overlay');
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        state.modal = null;
        rerender();
      }
    });

    if (m.type === 'account') {
      const box = node('div', 'modal-box');
      const head = node('div', 'modal-head');
      const title = node('h2', 'card-title', 'Compte Google (OIDC)');
      const close = button('×', 'modal-close', 'modal-close');
      close.onclick = () => {
        state.modal = null;
        rerender();
      };
      head.append(title, close);
      box.appendChild(head);
      box.appendChild(accountSectionContent());
      overlay.appendChild(box);
      return overlay;
    }

    if (m.type === 'pwa-ios-guide' || m.type === 'pwa-install-guide') {
      const isIos = m.type === 'pwa-ios-guide';
      const box = node('div', 'modal-box');
      const head = node('div', 'modal-head');
      const title = node(
        'h2',
        'card-title',
        isIos ? 'Installer sur iPhone / iPad' : 'Installer l’application mobile'
      );
      const close = button('×', 'modal-close', 'modal-close');
      close.onclick = () => {
        state.modal = null;
        pwaController.closeIOSGuide();
        rerender();
      };
      head.append(title, close);
      box.appendChild(head);

      const list = node('ol', 'mobile-guide-steps');
      if (isIos) {
        list.append(
          node('li', null, 'Ouvrez cette page dans Safari sur votre iPhone ou iPad.'),
          node('li', null, 'Appuyez sur le bouton Partager (carré avec une flèche vers le haut).'),
          node('li', null, 'Faites défiler vers le bas puis appuyez sur « Sur l’écran d’accueil ».')
        );
      } else {
        list.append(
          node('li', null, 'Ouvrez le menu de votre navigateur (⋮ sur Android Chrome/Edge).'),
          node('li', null, 'Sélectionnez « Installer l’application » ou « Ajouter à l’écran d’accueil ».'),
          node('li', null, 'L’application fonctionnera hors ligne avec toutes vos données locales.')
        );
      }
      box.appendChild(list);

      const okBtn = button('Compris', 'primary mobile-guide-close', 'pwa-guide-close');
      okBtn.onclick = () => {
        state.modal = null;
        pwaController.closeIOSGuide();
        rerender();
      };
      box.appendChild(okBtn);
      overlay.appendChild(box);
      return overlay;
    }

    const isEditActivity = m.mode === 'edit';
    const box = node('div', 'modal-box');
    const head = node('div', 'modal-head');
    const titleText = isEditActivity ? 'Modifier l’activité' : 'Nouvelle activité';
    const title = node('h2', 'card-title', titleText);
    const close = button('×', 'modal-close', 'modal-close');
    close.onclick = () => {
      state.modal = null;
      rerender();
    };
    head.append(title, close);
    box.appendChild(head);

    const form = node('form');
    form.dataset.behaviorForm = 'activity-form';
    const a = input('Nom', 'text', isEditActivity ? (m.label || '') : '', true, 'label');
    const c = selectCategory(
      isEditActivity ? (m.categoryId ?? null) : (m.categoryId || state.categories[0]?.id),
      isEditActivity && m.categoryId === null
    );
    const save = button(isEditActivity ? 'Enregistrer les modifications' : 'Enregistrer', undefined, 'activity-save');
    save.type = 'submit';

    form.append(a.wrap, c.wrap, save);
    form.onsubmit = async e => {
      e.preventDefault();
      const labelVal = a.input.value.trim();
      if (!labelVal) {
        errorManager.handleError(new Error('Veuillez donner un nom à l’activité.'), 'activity');
        getBehaviorTracking()?.tracker.trackFormResult('activity-form', 'error', { object: 'saved_activity', code: 'invalid-label' });
        return;
      }

      if (isEditActivity) {
        const nextSlice = updateActivityAndEntries(
          {
            activities: state.activities,
            entries: state.entries,
            activeTimer: state.activeTimer,
          },
          {
            activityId: m.activityId || null,
            oldLabel: m.oldLabel || '',
            oldCategoryId: m.oldCategoryId ?? null,
            newLabel: labelVal,
            newCategoryId: c.select.value || null,
          }
        );
        state.activities = nextSlice.activities;
        state.entries = nextSlice.entries;
        state.activeTimer = nextSlice.activeTimer;
        state.modal = null;
        await persist();
        getBehaviorTracking()?.tracker.trackFormResult('activity-form', 'success', { object: 'saved_activity' });
        errorManager.notifySuccess(`Activité « ${labelVal} » modifiée !`);
        rerender();
        return;
      }

      state.activities.push({
        id: crypto.randomUUID(),
        label: labelVal,
        categoryId: c.select.value || null,
        useCount: 1,
        lastUsedAt: new Date().toISOString(),
      });
      state.modal = null;
      await persist();
      trackEvent('saved_activity_created', savedActivityCreatedPayload({ hasCategory: Boolean(c.select.value) }));
      getBehaviorTracking()?.tracker.trackFormResult('activity-form', 'success', { object: 'saved_activity' });
      errorManager.notifySuccess(`Activité « ${labelVal} » ajoutée !`);
      rerender();
    };

    box.appendChild(form);
    overlay.appendChild(box);
    return overlay;
  }

  function dataCard() {
    const c = card('Gestion des données');
    const row = node('div', 'action-row');
    const exp = button('Exporter les données', undefined, 'data-export');
    const imp = button('Importer un fichier', undefined, 'data-import');
    const clear = button('Effacer toutes les données', 'danger', 'data-clear');

    exp.onclick = exportData;
    imp.onclick = () => {
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = '.json,application/json';
      file.onchange = () => importData(file);
      file.click();
    };
    clear.onclick = clearData;

    row.append(exp, imp, clear);
    c.appendChild(row);
    return c;
  }

  function syncCard() {
    const c = card('Synchronisation multi-appareils');
    const meta = getSyncMeta();
    const p2pSnap = p2pManager.getSnapshot();

    const tabs = node('div', 'entry-mode-toggle sync-mode-tabs');
    const driveTabBtn = document.createElement('button');
    driveTabBtn.type = 'button';
    driveTabBtn.className = `mode-toggle-btn ${syncPanelTab === 'drive' ? 'active' : ''}`.trim();
    driveTabBtn.dataset.behaviorTarget = 'sync-tab-drive';
    driveTabBtn.textContent = '☁️ Google Drive';
    driveTabBtn.onclick = () => {
      syncPanelTab = 'drive';
      rerender();
    };

    const p2pTabBtn = document.createElement('button');
    p2pTabBtn.type = 'button';
    p2pTabBtn.className = `mode-toggle-btn ${syncPanelTab === 'p2p' ? 'active' : ''}`.trim();
    p2pTabBtn.dataset.behaviorTarget = 'sync-tab-p2p';
    p2pTabBtn.textContent = p2pSnap.isConnected ? '🔗 P2P (Connecté)' : '🔗 P2P Direct';
    p2pTabBtn.onclick = () => {
      syncPanelTab = 'p2p';
      rerender();
    };

    tabs.append(driveTabBtn, p2pTabBtn);
    c.appendChild(tabs);

    if (syncPanelTab === 'drive') {
      c.appendChild(renderDriveSyncPanel(meta));
    } else {
      c.appendChild(renderP2PSyncPanel(meta, p2pSnap));
    }

    return c;
  }

  function renderDriveSyncPanel(meta) {
    const panel = node('div', 'sync-panel');
    panel.appendChild(
      node(
        'p',
        'muted sync-desc',
        'Sauvegarde et fusion CRDT sans perte dans le dossier privé appDataFolder de votre Google Drive, sans serveur backend.'
      )
    );

    const statusRow = node('div', 'sync-status-row');
    statusRow.appendChild(
      node('span', `sync-status-pill ${meta.lastDriveSyncAt ? 'is-ok' : ''}`.trim(),
        meta.lastDriveSyncAt
          ? `Dernière synchro : ${formatSyncTimestamp(meta.lastDriveSyncAt)}`
          : 'Jamais synchronisé')
    );
    panel.appendChild(statusRow);

    const syncBtn = button(
      driveSyncBusy ? 'Synchronisation Drive…' : 'Synchroniser avec Google Drive',
      'primary sync-action-btn',
      'sync-drive-run'
    );
    syncBtn.disabled = driveSyncBusy;
    syncBtn.onclick = () => handleDriveSync({ silent: false });
    panel.appendChild(syncBtn);

    const autoLabel = document.createElement('label');
    autoLabel.className = 'sync-auto-toggle';
    const autoCheck = document.createElement('input');
    autoCheck.type = 'checkbox';
    autoCheck.checked = Boolean(meta.driveAutoSync);
    autoCheck.onchange = async () => {
      await saveSyncMeta({ driveAutoSync: autoCheck.checked });
      errorManager.notifyInfo(
        autoCheck.checked
          ? 'Synchronisation automatique Drive activée au retour en ligne.'
          : 'Synchronisation automatique Drive désactivée.'
      );
      rerender();
    };
    autoLabel.append(autoCheck, document.createTextNode(' Synchroniser automatiquement au retour en ligne'));
    panel.appendChild(autoLabel);

    if (!authClient.isConfigured()) {
      panel.appendChild(
        node('p', 'muted auth-config-hint', 'Définissez VITE_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID pour activer Google Drive.')
      );
    }

    return panel;
  }

  function renderP2PSyncPanel(meta, snap) {
    const panel = node('div', 'sync-panel');
    panel.appendChild(
      node(
        'p',
        'muted sync-desc',
        'Connexion directe navigateur à navigateur via WebRTC DataChannel (zéro cloud, fusion CRDT par identifiant et horodatage).'
      )
    );

    const statusLabelMap = {
      idle: 'Déconnecté',
      creating_offer: 'Génération de l’invitation…',
      awaiting_answer: 'En attente du code réponse',
      awaiting_connection: 'Connexion WebRTC en cours…',
      connected: 'Pair connecté en direct (WebRTC)',
      error: 'Erreur de connexion P2P',
    };

    const statusRow = node('div', 'sync-status-row');
    statusRow.appendChild(
      node(
        'span',
        `sync-status-pill ${snap.isConnected ? 'is-ok' : snap.status === 'error' ? 'is-err' : ''}`.trim(),
        statusLabelMap[snap.status] || 'Déconnecté'
      )
    );
    if (meta.lastP2pSyncAt) {
      statusRow.appendChild(node('span', 'sync-last-time', `Dernière fusion : ${formatSyncTimestamp(meta.lastP2pSyncAt)}`));
    }
    panel.appendChild(statusRow);

    if (snap.lastError) {
      panel.appendChild(node('p', 'error', snap.lastError));
    }

    if (snap.isConnected) {
      const actionRow = node('div', 'action-row');
      const nowBtn = button('Synchroniser maintenant', 'primary', 'p2p-sync-now');
      nowBtn.onclick = () => {
        try {
          p2pManager.syncNow();
          errorManager.notifyInfo('État local envoyé au pair WebRTC.');
        } catch (err) {
          errorManager.handleError(err, 'sync');
        }
      };
      const discBtn = button('Déconnecter P2P', 'danger', 'p2p-disconnect');
      discBtn.onclick = () => {
        p2pManager.disconnect();
        p2pOfferInput = '';
        p2pAnswerInput = '';
        rerender();
      };
      actionRow.append(nowBtn, discBtn);
      panel.appendChild(actionRow);
      return panel;
    }

    const roleTabs = node('div', 'entry-mode-toggle sync-role-tabs');
    const offerRoleBtn = document.createElement('button');
    offerRoleBtn.type = 'button';
    offerRoleBtn.className = `mode-toggle-btn ${p2pRole === 'offer' ? 'active' : ''}`.trim();
    offerRoleBtn.dataset.behaviorTarget = 'p2p-role-offer';
    offerRoleBtn.textContent = '1. Inviter (Appareil A)';
    offerRoleBtn.onclick = () => {
      p2pRole = 'offer';
      rerender();
    };

    const joinRoleBtn = document.createElement('button');
    joinRoleBtn.type = 'button';
    joinRoleBtn.className = `mode-toggle-btn ${p2pRole === 'join' ? 'active' : ''}`.trim();
    joinRoleBtn.dataset.behaviorTarget = 'p2p-role-join';
    joinRoleBtn.textContent = '2. Rejoindre (Appareil B)';
    joinRoleBtn.onclick = () => {
      p2pRole = 'join';
      rerender();
    };
    roleTabs.append(offerRoleBtn, joinRoleBtn);
    panel.appendChild(roleTabs);

    if (p2pRole === 'offer') {
      const createBtn = button(
        snap.status === 'creating_offer' ? 'Création du code…' : 'Créer un code d’invitation',
        'secondary sync-action-btn',
        'p2p-create-offer'
      );
      createBtn.disabled = snap.status === 'creating_offer';
      createBtn.onclick = async () => {
        try {
          await p2pManager.createOffer();
          errorManager.notifyInfo('Code d’invitation P2P prêt à être copié.');
        } catch (err) {
          errorManager.handleError(err, 'sync');
        }
      };
      panel.appendChild(createBtn);

      if (snap.offerCode) {
        panel.appendChild(createTokenOutputBlock('Code d’invitation à copier sur l’Appareil B', snap.offerCode, 'p2p-copy-offer'));

        const ansField = node('div', 'field sync-token-field');
        ansField.appendChild(label('Coller le code réponse reçu de l’Appareil B'));
        const ansArea = document.createElement('textarea');
        ansArea.className = 'sync-token-textarea';
        ansArea.rows = 2;
        ansArea.placeholder = 'TT1:...';
        ansArea.value = p2pAnswerInput;
        ansArea.dataset.behaviorField = 'p2p-answer-input';
        ansArea.oninput = () => {
          p2pAnswerInput = ansArea.value;
        };
        ansField.appendChild(ansArea);
        panel.appendChild(ansField);

        const connectBtn = button('Connecter l’appareil', 'primary sync-action-btn', 'p2p-accept-answer');
        connectBtn.onclick = async () => {
          try {
            await p2pManager.acceptAnswer(p2pAnswerInput);
            errorManager.notifyInfo('Réponse P2P appliquée, ouverture du canal…');
          } catch (err) {
            errorManager.handleError(err, 'sync');
          }
        };
        panel.appendChild(connectBtn);
      }
    } else {
      const offField = node('div', 'field sync-token-field');
      offField.appendChild(label('Coller le code d’invitation (TT1:...) de l’Appareil A'));
      const offArea = document.createElement('textarea');
      offArea.className = 'sync-token-textarea';
      offArea.rows = 2;
      offArea.placeholder = 'TT1:...';
      offArea.value = p2pOfferInput;
      offArea.dataset.behaviorField = 'p2p-offer-input';
      offArea.oninput = () => {
        p2pOfferInput = offArea.value;
      };
      offField.appendChild(offArea);
      panel.appendChild(offField);

      const acceptOfferBtn = button('Générer le code réponse', 'primary sync-action-btn', 'p2p-accept-offer');
      acceptOfferBtn.onclick = async () => {
        try {
          await p2pManager.acceptOfferAndCreateAnswer(p2pOfferInput);
          errorManager.notifyInfo('Code réponse P2P généré : renvoyez-le à l’Appareil A.');
        } catch (err) {
          errorManager.handleError(err, 'sync');
        }
      };
      panel.appendChild(acceptOfferBtn);

      if (snap.answerCode) {
        panel.appendChild(createTokenOutputBlock('Code réponse à renvoyer à l’Appareil A', snap.answerCode, 'p2p-copy-answer'));
      }
    }

    return panel;
  }

  function createTokenOutputBlock(titleText, tokenValue, behaviorTarget) {
    const wrap = node('div', 'sync-token-output');
    wrap.appendChild(label(titleText));
    const ta = document.createElement('textarea');
    ta.className = 'sync-token-textarea';
    ta.rows = 2;
    ta.readOnly = true;
    ta.value = tokenValue;

    const copyBtn = button('Copier le code', 'small secondary', behaviorTarget);
    copyBtn.onclick = async () => {
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(tokenValue);
        } else {
          ta.select();
          document.execCommand?.('copy');
        }
        errorManager.notifySuccess('Code P2P copié dans le presse-papiers.');
      } catch {
        ta.select();
        errorManager.notifyInfo('Sélectionnez et copiez le code manuellement.');
      }
    };

    wrap.append(ta, copyBtn);
    return wrap;
  }

  function formatSyncTimestamp(isoStr) {
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return String(isoStr);
      return d.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(isoStr);
    }
  }

  async function handleDriveSync({ silent = false } = {}) {
    if (driveSyncBusy) return;
    driveSyncBusy = true;
    if (!silent) rerender();
    try {
      const result = await driveSyncFn({
        authClient,
        getLocalPayload: getSyncPayload,
        applyMergedPayload: applyMergedSyncState,
      });
      await saveSyncMeta({ lastDriveSyncAt: result.syncedAt });
      trackEvent(ANALYTICS_EVENTS.SYNC_DRIVE_COMPLETED, syncEventPayload('drive_appdata'));
      if (!silent) {
        errorManager.notifySuccess(
          `Google Drive synchronisé (${result.counts.entries} session${result.counts.entries > 1 ? 's' : ''}).`
        );
      }
    } catch (err) {
      if (!silent) {
        errorManager.handleError(err, 'sync');
      }
    } finally {
      driveSyncBusy = false;
      rerender();
    }
  }

  function accountCard() {
    const c = card('Compte & Authentification');
    c.appendChild(accountSectionContent());
    return c;
  }

  function offlineIndicatorBanner() {
    const banner = node('div', 'offline-indicator-banner');
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    const dot = node('span', 'offline-indicator-dot');
    const text = node('span', null, 'Hors ligne — Données locales sauvegardées');
    banner.append(dot, text);
    return banner;
  }

  async function handlePwaInstallClick() {
    const snap = pwaController.getSnapshot();
    if (snap.canPromptInstall) {
      try {
        const res = await pwaController.promptInstall();
        if (res.outcome === 'dismissed') {
          errorManager.notifyInfo('Installation annulée. Vous pourrez l’installer plus tard.');
        }
      } catch (err) {
        errorManager.handleError(err, 'mobile');
      }
      return;
    }
    if (snap.installMode === 'ios-guide') {
      pwaController.openIOSGuide();
      state.modal = { type: 'pwa-ios-guide' };
      rerender();
      return;
    }
    state.modal = { type: 'pwa-install-guide' };
    rerender();
  }

  function mobileAppCard() {
    const c = card('Application mobile');
    const snap = pwaController.getSnapshot();
    const wrap = node('div', 'mobile-app-panel');

    const statusRow = node('div', 'mobile-status-row');
    const envLabel = snap.isNative
      ? `App native Capacitor (${snap.nativePlatform})`
      : snap.isInstalled
        ? 'Application installée (PWA)'
        : 'Navigateur Web (PWA prête)';
    statusRow.appendChild(
      node('span', `sync-status-pill ${snap.isNative || snap.isInstalled ? 'is-ok' : ''}`.trim(), envLabel)
    );
    statusRow.appendChild(
      node(
        'span',
        `sync-status-pill ${snap.isOnline ? 'is-ok' : 'is-err'}`,
        snap.isOnline ? 'En ligne' : 'Hors ligne'
      )
    );
    wrap.appendChild(statusRow);

    wrap.appendChild(
      node(
        'p',
        'muted sync-desc',
        snap.isNative
          ? 'Application exécutée dans le conteneur natif Capacitor avec stockage local persistant.'
          : 'Installez Carnet du temps sur votre téléphone (PWA hors ligne) ou empaquetez-le en natif Android / iOS avec Capacitor.'
      )
    );

    if (!snap.isNative && !snap.isInstalled) {
      const btnLabel = snap.canPromptInstall
        ? 'Installer l’application'
        : snap.installMode === 'ios-guide'
          ? 'Installer sur iPhone / iPad'
          : 'Installer sur l’écran d’accueil';
      const installBtn = button(btnLabel, 'primary sync-action-btn', 'pwa-install-card');
      installBtn.onclick = handlePwaInstallClick;
      wrap.appendChild(installBtn);
    }

    c.appendChild(wrap);
    return c;
  }

  function accountSectionContent() {
    const wrap = node('div', 'auth-account-panel');
    if (state.authUser) {
      const profile = node('div', 'auth-profile-row');
      profile.appendChild(createAvatarNode(state.authUser, 'auth-avatar--lg'));

      const details = node('div', 'auth-profile-details');
      details.appendChild(node('strong', 'auth-profile-name', state.authUser.name || 'Utilisateur Google'));
      if (state.authUser.email) {
        details.appendChild(node('span', 'auth-profile-email', state.authUser.email));
      }
      const badges = node('div', 'auth-profile-badges');
      badges.appendChild(node('span', 'auth-protocol-badge', 'OAuth 2.0 / OIDC'));
      if (state.authUser.emailVerified) {
        badges.appendChild(node('span', 'auth-verified-badge', 'Email vérifié'));
      }
      details.appendChild(badges);
      profile.appendChild(details);
      wrap.appendChild(profile);

      wrap.appendChild(
        node(
          'p',
          'muted auth-note',
          'Session vérifiée directement via Google OpenID Connect. Vos activités et saisies restent stockées localement (local-first).'
        )
      );

      const signOutBtn = button(
        authBusy ? 'Déconnexion…' : 'Se déconnecter',
        'secondary auth-signout-btn',
        'auth-google-signout'
      );
      signOutBtn.disabled = authBusy;
      signOutBtn.onclick = handleGoogleSignOut;
      wrap.appendChild(signOutBtn);
      return wrap;
    }

    wrap.appendChild(
      node(
        'p',
        'muted auth-note',
        'Identifiez-vous directement avec Google (OAuth 2.0 / OIDC), sans intermédiaire. L’application reste entièrement utilisable hors ligne.'
      )
    );
    wrap.appendChild(createGoogleSignInButton());

    if (!authClient.isConfigured()) {
      wrap.appendChild(
        node(
          'p',
          'muted auth-config-hint',
          'Client OAuth non configuré dans cet environnement (VITE_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID).'
        )
      );
    }
    return wrap;
  }

  function createGoogleSignInButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'google-signin-btn';
    btn.dataset.behaviorTarget = 'auth-google-signin';
    btn.disabled = authBusy;

    const icon = document.createElement('span');
    icon.className = 'google-signin-btn__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/>
      <path fill="#34A853" d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.1.74-2.51 1.18-4.22 1.18-3.24 0-5.99-2.19-6.97-5.13H1.03v3.14C3.04 21.18 7.21 24 12 24Z"/>
      <path fill="#FBBC05" d="M5.03 14.04A7.2 7.2 0 0 1 4.65 12c0-.71.13-1.4.38-2.04V6.82H1.03A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.03 5.18l4-3.14Z"/>
      <path fill="#EA4335" d="M12 4.75c1.79 0 3.4.62 4.67 1.83l3.5-3.5C18.07 1.19 15.3 0 12 0 7.21 0 3.04 2.82 1.03 6.82l4 3.14c.98-2.94 3.73-5.21 6.97-5.21Z"/>
    </svg>`;

    btn.append(icon, node('span', 'google-signin-btn__label', authBusy ? 'Connexion en cours…' : 'Se connecter avec Google'));
    btn.onclick = handleGoogleSignIn;
    return btn;
  }

  function createAvatarNode(user, sizeClass = '') {
    const wrap = node('span', `auth-avatar ${sizeClass}`.trim());
    if (user?.picture) {
      const img = document.createElement('img');
      img.src = user.picture;
      img.alt = user.name || 'Profil Google';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        wrap.replaceChildren(document.createTextNode(getUserInitials(user)));
      };
      wrap.appendChild(img);
    } else {
      wrap.textContent = getUserInitials(user);
    }
    return wrap;
  }

  function getUserInitials(user) {
    const source = String(user?.name || user?.email || 'U').trim();
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  async function handleGoogleSignIn() {
    if (authBusy) return;
    authBusy = true;
    rerender();
    try {
      const session = await authClient.signIn({ scope: DRIVE_SYNC_SCOPES });
      state.authUser = session.user;
      await saveAuthSession(session);
      if (state.modal?.type === 'account') {
        state.modal = null;
      }
      trackEvent(ANALYTICS_EVENTS.AUTH_SIGNED_IN, authEventPayload());
      errorManager.notifySuccess(`Connecté en tant que ${session.user.name || session.user.email}.`);
    } catch (err) {
      errorManager.handleError(err, 'auth');
    } finally {
      authBusy = false;
      rerender();
    }
  }

  async function handleGoogleSignOut() {
    if (authBusy) return;
    authBusy = true;
    rerender();
    try {
      await authClient.signOut();
      await clearAuthSession();
      state.authUser = null;
      if (state.modal?.type === 'account') {
        state.modal = null;
      }
      trackEvent(ANALYTICS_EVENTS.AUTH_SIGNED_OUT, authEventPayload());
      errorManager.notifyInfo('Session Google déconnectée.');
    } catch (err) {
      errorManager.handleError(err, 'auth');
    } finally {
      authBusy = false;
      rerender();
    }
  }

  function exportData() {
    const payload = buildExportPayload({
      entries: state.entries,
      savedActivities: state.activities,
      categories: state.categories,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `carnet-du-temps-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
    trackEvent('data_exported', dataExportedPayload({ entryCount: state.entries.length, categoryCount: state.categories.length }));
    errorManager.notifySuccess('Sauvegarde exportée avec succès.');
  }

  async function importData(input) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = parseImportPayload(await file.text());
      const builtins = state.categories.filter(c => c.builtin);
      const ids = new Set(builtins.map(c => c.id));
      state.entries = data.entries;
      state.activities = data.savedActivities;
      state.categories = [...builtins, ...data.categories.filter(c => !ids.has(c.id))];
      await persist();
      trackEvent('data_imported', dataImportedPayload({ entryCount: state.entries.length, categoryCount: state.categories.length }));
      getBehaviorTracking()?.tracker.trackFormResult('data-import', 'success', { object: 'data' });
      errorManager.notifySuccess('Données importées avec succès !');
      rerender();
    } catch (e) {
      errorManager.handleError(e, 'import');
      getBehaviorTracking()?.tracker.trackFormResult('data-import', 'error', { object: 'data', code: 'invalid-json' });
      rerender();
    }
  }

  async function clearData() {
    if (!window.confirm('Effacer toutes les données locales ? Cette action est irréversible.')) return;
    try {
      await clearAllData();
      await authClient.signOut();
      state.entries = [];
      state.activities = [];
      state.categories = DEFAULT_CATEGORIES.map(c => ({ ...c }));
      state.activeTimer = null;
      state.authUser = null;
      state.modal = null;
      state.editingEntryId = null;
      state.error = null;
      state.tab = 'entry';
      await persist();
      trackEvent('data_cleared');
      errorManager.notifyInfo('Toutes les données ont été réinitialisées.');
      rerender();
    } catch (e) {
      errorManager.handleError(e, 'storage');
      getBehaviorTracking()?.tracker.trackError(e, { context: 'data' });
      rerender();
    }
  }

  async function startTimer(activity, categoryId, date, startTime) {
    if (!activity || !categoryId) {
      errorManager.handleError(new Error('Activité ou catégorie manquante.'), 'timer');
      return;
    }
    state.activeTimer = createActiveTimer({
      activity,
      categoryId,
      startTs: Date.now(),
      startTime: startTime || nowTime(),
      date: date || today(),
    });
    await persist();
    trackEvent('timer_started', timerStartedPayload({ hasCategory: Boolean(categoryId) }));
    errorManager.notifySuccess(`Chronomètre lancé pour « ${activity} »`);
    rerender();
  }

  async function stopTimer() {
    const t = state.activeTimer;
    if (!t) return;
    const end = nowTime();
    const endDate = t.date === today() ? t.date : today();
    const durationMinutes = elapsedMinutes(t);
    const hasCategory = Boolean(t.categoryId ?? t.cat);
    const entry = createTimeEntry({
      id: crypto.randomUUID(),
      activity: t.activity,
      categoryId: t.categoryId ?? t.cat,
      date: t.date,
      start: t.startTime,
      end,
      endDate,
      mins: durationMinutes,
      viaTimer: true,
    });
    state.entries = [entry, ...state.entries];
    state.activeTimer = null;

    // Update usage on saved activities if found
    const actIdx = state.activities.findIndex(a => (a.label || a.activity) === t.activity);
    if (actIdx >= 0) {
      state.activities[actIdx].useCount = (state.activities[actIdx].useCount || 0) + 1;
      state.activities[actIdx].lastUsedAt = new Date().toISOString();
    }

    await persist();
    trackEvent('timer_stopped', timerStoppedPayload({ durationMinutes, hasCategory }));
    trackEvent('time_entry_created', timeEntryCreatedPayload({ durationMinutes, hasCategory, viaTimer: true }));
    errorManager.notifySuccess(`Session « ${t.activity} » enregistrée (${formatDuration(durationMinutes)})`);
    rerender();
  }

  function dashboardEntries() {
    return filterEntriesByPeriod(state.entries, state.period);
  }

  function drawCharts() {
    const d = root.querySelector('#day-chart');
    const h = root.querySelector('#hour-chart');
    const c = root.querySelector('#category-tree-chart');
    if (d && h || c) {
      renderCharts({
        dayCanvas: d,
        hourCanvas: h,
        categoryTreeContainer: c,
        entries: dashboardEntries(),
        categories: state.categories,
        activities: state.activities,
        onStartActivity: (activityName, categoryId) => {
          startTimer(activityName, categoryId || state.categories[0]?.id, today(), nowTime());
        },
        onAddCategory: (parentId) => openCategoryCreateModal(parentId),
        onAddActivity: (categoryId) => openActivityCreateModal(categoryId),
        onEditCategory: (categoryId) => openCategoryEditModal(categoryId),
        onEditActivity: (payload) => openActivityEditModal(payload),
        onMoveCategory: handleMoveCategory,
        onMoveActivity: handleMoveActivity,
      });
    }
  }

  function selectCategory(selected, allowEmpty = false) {
    const wrap = node('div', 'field');
    wrap.appendChild(label('Catégorie'));
    const select = document.createElement('select');
    select.dataset.behaviorField = 'category';
    if (allowEmpty) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = 'Sans catégorie';
      emptyOpt.selected = selected === null || selected === '';
      select.appendChild(emptyOpt);
    }
    for (const c of state.categories) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = formatCategoryPath(state.categories, c.id);
      o.selected = c.id === selected;
      select.appendChild(o);
    }
    wrap.appendChild(select);
    return { wrap, select };
  }

  function input(labelText, type, value, required, fieldRole = null) {
    const wrap = node('div', 'field');
    wrap.appendChild(label(labelText));
    const inp = document.createElement('input');
    inp.type = type;
    inp.value = value ?? '';
    inp.required = required;
    if (fieldRole) inp.dataset.behaviorField = fieldRole;
    wrap.appendChild(inp);
    return { wrap, input: inp };
  }

  function card(title) {
    const c = node('section', 'card');
    c.appendChild(node('h2', 'card-title', title));
    return c;
  }

  function button(text, kind = '', behaviorTarget = null) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${kind}`.trim();
    b.textContent = text;
    if (behaviorTarget) b.dataset.behaviorTarget = behaviorTarget;
    return b;
  }

  function label(text) {
    return node('label', null, text);
  }

  function node(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = String(text);
    return n;
  }

  function nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function clock(s) {
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  const handleOnlineSync = () => {
    const meta = getSyncMeta();
    if (meta.driveAutoSync && state.authUser && authClient.hasScope?.(DRIVE_APPDATA_SCOPE)) {
      handleDriveSync({ silent: true });
    }
  };
  const handleDesktopShortcut = (e) => {
    if (deviceNavController.getProfile().deviceType !== 'desktop') return;
    const route = resolveRouteShortcutKey(e);
    if (!route) return;
    e.preventDefault();
    routeManager.navigate(route);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnlineSync);
    window.addEventListener('keydown', handleDesktopShortcut);
  }

  render();
  return {
    render,
    destroy: () => {
      clearInterval(ticker);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnlineSync);
        window.removeEventListener('keydown', handleDesktopShortcut);
      }
      deviceNavController.destroy();
      pwaController.destroy();
      p2pManager.disconnect();
      routeManager.destroy();
      categoryManager.destroy();
      destroyCharts();
    },
  };
}
