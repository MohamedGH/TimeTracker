import { formatCategoryPath, getDescendants } from './core/category-tree.js';
import { createTimeEntry } from './core/time-entry.js';
import { createActiveTimer, elapsedSeconds, elapsedMinutes } from './core/timer.js';
import { today } from './core/time.js';
import { buildExportPayload, parseImportPayload } from './core/import-export.js';
import { renderCharts, destroyCharts } from './charts/dashboard.js';
import { clearAllData } from './core/storage.js';
import { DEFAULT_CATEGORIES } from './core/model.js';
import { trackEvent, trackPageView, initAnalytics } from './core/analytics/analytics.js';
import { hasConsentDecision, setConsentStatus } from './core/analytics/consent.js';
import {
  timerStartedPayload, timerStoppedPayload, timeEntryCreatedPayload, timeEntryUpdatedPayload,
  savedActivityCreatedPayload,
  dashboardPeriodChangedPayload, dataExportedPayload, dataImportedPayload,
} from './core/analytics/events.js';
import { initBehaviorTracking, getBehaviorTracking, runPatternDetection, getFeatureCandidates } from './core/behavior/index.js';
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
  getRecentActivities,
  getFrequentActivities,
  generatePersonalizedSuggestions,
} from './core/suggestions-engine.js';
import { installCategorySelectors } from './category-selector.js';
import { updateActivityAndEntries } from './state/activity-actions.js';

export function createUI({ root, state, stateManager: _stateManager, persist }) {
  let ticker;
  let lastTrackedTab = null;
  let lastInsightsRefresh = 0;
  let entryFormMode = state.editingEntryId ? 'manual' : 'timer'; // 'timer' | 'manual'

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

  const categoryManager = createCategoryManager({
    state,
    persist,
    rerender,
    onStartActivity: (activityName, categoryId) => {
      startTimer(activityName, categoryId || state.categories[0]?.id, today(), nowTime());
    },
    onAddActivity: (categoryId) => openActivityCreateModal(categoryId),
    onEditActivity: (payload) => openActivityEditModal(payload),
  });

  function render() {
    destroyCharts();
    categoryManager.destroy();
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

    // If timer is running and user is on another tab, show floating mini-timer bar above bottom navigation
    if (state.activeTimer && state.tab !== 'entry') {
      main.appendChild(floatingTimerBar());
    }

    root.appendChild(main);
    root.appendChild(bottomTabBar());

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

    brandRow.append(brandLeft, brandRight);
    h.appendChild(brandRow);
    return h;
  }

  function bottomTabBar() {
    const nav = node('nav', 'mobile-bottom-nav');
    const tabs = [
      {
        id: 'entry',
        label: 'Chrono & Saisie',
        shortLabel: 'Chrono',
        icon: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>`,
        badge: Boolean(state.activeTimer),
      },
      {
        id: 'dashboard',
        label: 'Tableau de bord',
        shortLabel: 'Stats',
        icon: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 20V10"/>
          <path d="M12 20V4"/>
          <path d="M6 20v-6"/>
        </svg>`,
        badge: false,
      },
      {
        id: 'categories',
        label: 'Catégories',
        shortLabel: 'Catégories',
        icon: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9h16"/>
          <path d="M4 15h16"/>
          <path d="M10 3L8 21"/>
          <path d="M16 3l-2 18"/>
        </svg>`,
        badge: false,
      },
    ];

    tabs.forEach(({ id, label, shortLabel, icon, badge }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `nav-${id}`;
      b.className = `mobile-tab-item tab-btn ${state.tab === id ? 'active' : ''}`.trim();
      b.dataset.behaviorTarget = `nav-${id}`;
      b.setAttribute('aria-label', label);

      const iconWrap = node('span', 'mobile-tab-icon');
      iconWrap.innerHTML = icon;
      if (badge) {
        const dot = node('span', 'tab-pulse-badge');
        iconWrap.appendChild(dot);
      }

      const labelSpan = node('span', 'mobile-tab-label', shortLabel);
      b.append(iconWrap, labelSpan);

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
      dataCard()
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
   * Priorité UX 1 & 2: Démarrer rapidement une activité & proposer les activités récentes/fréquentes.
   */
  function quickStartCard() {
    const recent = getRecentActivities(state.entries, state.activities, 4);
    const frequent = getFrequentActivities(state.entries, state.activities, 4);

    // Merge recent and frequent into unique suggestions
    const seen = new Set();
    const suggestions = [];
    for (const item of [...recent, ...frequent]) {
      const key = item.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        suggestions.push(item);
      }
      if (suggestions.length >= 6) break;
    }

    if (!suggestions.length) return document.createDocumentFragment();

    const c = node('section', 'quick-start-card');
    const title = node('div', 'quick-start-title');
    title.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>Démarrage rapide (1 clic)</span>`;
    c.appendChild(title);

    const chips = node('div', 'quick-chips-grid');
    for (const item of suggestions) {
      const cat = state.categories.find(k => k.id === item.categoryId);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-chip';
      chip.setAttribute('aria-label', `Démarrer ${item.name}`);

      chip.innerHTML = `
        <span class="quick-chip-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        </span>
        <span class="quick-chip-name">${escapeHtml(item.name)}</span>
        ${cat ? `<span class="quick-chip-category" style="background:${cat.color || '#948C7E'}">${escapeHtml(cat.label)}</span>` : ''}
      `;

      chip.onclick = () => {
        trackEvent('saved_activity_started');
        startTimer(item.name, item.categoryId || state.categories[0]?.id, today(), nowTime());
      };
      chips.appendChild(chip);
    }
    c.appendChild(chips);
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
      chronoModeBtn.textContent = '⏱️ Démarrer un chrono';
      chronoModeBtn.onclick = () => {
        entryFormMode = 'timer';
        rerender();
      };

      const manualModeBtn = document.createElement('button');
      manualModeBtn.type = 'button';
      manualModeBtn.className = `mode-toggle-btn ${entryFormMode === 'manual' ? 'active' : ''}`;
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
              timeEntryCreatedPayload({ durationMinutes: value.mins, hasCategory: Boolean(value.categoryId) })
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
        root.querySelector('.entry-form')?.scrollIntoView({ behavior: 'smooth' });
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

  /**
   * Priorité 3: Suggestions personnalisées présentées comme observations ou hypothèses.
   */
  function insightsCard() {
    const c = card('Observations & Suggestions personnalisées');
    const list = node('div', 'suggestions-list');

    // 1. Suggestions calculated from the local user's real entries
    const personalSuggestions = generatePersonalizedSuggestions({
      entries: state.entries,
      activities: state.activities,
      categories: state.categories,
      currentHour: new Date().getHours(),
    });

    for (const item of personalSuggestions) {
      const box = node('div', 'suggestion-box');

      const badgeRow = node('div', 'suggestion-badge-row');
      const badge = node('span', `suggestion-badge ${item.type}`, item.badge);
      const title = node('span', 'suggestion-title', item.title);
      badgeRow.append(badge, title);
      box.appendChild(badgeRow);

      const message = node('p', 'suggestion-message', item.message);
      box.appendChild(message);

      if (item.action) {
        const actionRow = node('div', 'suggestion-action-row');
        const startBtn = button(item.action.label, 'small primary');
        startBtn.onclick = () => {
          startTimer(item.action.activity, item.action.categoryId || state.categories[0]?.id, today(), nowTime());
        };
        actionRow.appendChild(startBtn);
        box.appendChild(actionRow);
      }

      list.appendChild(box);
    }

    // 2. Behavioral hypotheses from Pattern Detection
    const candidates = getFeatureCandidates({ limit: 4 });
    for (const candidate of candidates) {
      const box = node('div', 'suggestion-box');
      const badgeRow = node('div', 'suggestion-badge-row');
      const badge = node('span', 'suggestion-badge hypothesis', 'Hypothèse comportementale');
      badgeRow.appendChild(badge);
      box.appendChild(badgeRow);

      const message = node('p', 'suggestion-message', candidate.description);
      box.appendChild(message);
      list.appendChild(box);
    }

    c.appendChild(list);

    // Refresh background pattern detection if due
    const now = Date.now();
    if (now - lastInsightsRefresh > 15000 && hasConsentDecision()) {
      lastInsightsRefresh = now;
      runPatternDetection({ minSupportUsers: 1 }).catch(() => {});
    }

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
      state.entries = [];
      state.activities = [];
      state.categories = DEFAULT_CATEGORIES.map(c => ({ ...c }));
      state.activeTimer = null;
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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  render();
  return {
    render,
    destroy: () => {
      clearInterval(ticker);
      routeManager.destroy();
      categoryManager.destroy();
      destroyCharts();
    },
  };
}
