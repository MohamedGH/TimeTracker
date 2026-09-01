import { formatCategoryPath, getDescendants } from './core/category-tree.js';
import { createTimeEntry } from './core/time-entry.js';
import { createActiveTimer, elapsedSeconds, elapsedMinutes } from './core/timer.js';
import { today, splitEntryByDay } from './core/time.js';
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

export function createUI({ root, state, persist }) {
  let ticker;
  let lastTrackedTab = null;
  let lastInsightsRefresh = 0;
  const rerender = () => render();

  function render() {
    destroyCharts();
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
    if (state.error) root.appendChild(node('div', 'error', state.error));

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
    
    // Pocket watch app icon badge
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
        state.tab = 'entry';
        rerender();
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
        state.tab = id;
        state.modal = null;
        state.editingEntryId = null;
        state.error = null;
        rerender();
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
      state.tab = 'entry';
      rerender();
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
    f.append(timerCard(), entryCard(), activitiesCard(), entriesCard(), dataCard());
    return f;
  }

  function timerCard() {
    const c = card('Timer');
    if (!state.activeTimer) {
      c.appendChild(node('p', 'muted', 'Aucun timer actif.'));
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

    const stop = button('Arrêter le timer', 'danger', 'timer-stop');
    stop.onclick = stopTimer;

    box.append(metaRow, clockNode, stop);
    c.appendChild(box);
    return c;
  }

  function entryCard() {
    const c = card(state.editingEntryId ? 'Modifier une entrée' : 'Nouvelle entrée');
    const old = state.entries.find(e => e.id === state.editingEntryId);
    const form = node('form', 'entry-form');
    form.dataset.behaviorForm = 'entry-form';

    const activity = input('Activité', 'text', old?.activity || '', true, 'activity');
    const category = selectCategory(old?.categoryId);
    attachActivitySuggestions(activity, category);

    const date = input('Date', 'date', old?.date || today(), true, 'date');
    const start = input('Début', 'time', old?.start || '09:00', true, 'start');
    const end = input('Fin', 'time', old?.end || '10:00', true, 'end');

    const row = node('div', 'row');
    row.append(date.wrap, start.wrap, end.wrap);

    form.append(activity.wrap, category.wrap, row);

    const save = button(old ? 'Enregistrer les modifications' : 'Enregistrer', undefined, 'entry-save');
    save.type = 'submit';
    form.appendChild(save);

    const timer = button('Démarrer le timer', 'secondary', 'timer-start');
    timer.onclick = () => startTimer(activity.input.value.trim(), category.select.value, date.input.value, start.input.value);
    form.appendChild(timer);

    if (old) {
      const cancel = button('Annuler', 'secondary', 'entry-cancel');
      cancel.onclick = () => {
        state.editingEntryId = null;
        rerender();
      };
      form.appendChild(cancel);
    }

    form.onsubmit = async e => {
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
        showError(c, 'Vérifiez l’activité et les horaires.');
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
      rerender();
    };

    c.appendChild(form);
    return c;
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
        visibleList.appendChild(node('p', 'muted', 'Choisissez une catégorie pour voir les activités déjà utilisées.'));
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

      if (!matches.length) {
        visibleList.appendChild(node('p', 'muted', 'Aucune activité enregistrée pour cette catégorie.'));
        return;
      }

      for (const name of matches) {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);

        const chip = button(name, 'small secondary', 'activity-suggestion-select');
        chip.type = 'button';
        chip.onclick = () => {
          activity.input.value = name;
          activity.input.focus();
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
      c.appendChild(node('p', 'empty', 'Aucune entrée.'));
      return c;
    }

    for (const e of state.entries.slice(0, 20)) {
      const r = node('div', 'entry-row');
      const info = node('div');

      const headerRow = node('div', 'entry-header');
      headerRow.appendChild(node('strong', null, e.activity));
      headerRow.appendChild(createCategoryBadge(e.categoryId, state.categories, { showPath: true, size: 'small' }));
      info.appendChild(headerRow);

      const meta = node('div', 'entry-meta', `${e.date} · ${e.start}–${e.end} · ${Math.round(e.mins)} min`);
      info.appendChild(meta);

      const edit = button('Modifier', 'small', 'entry-edit');
      edit.onclick = () => {
        state.editingEntryId = e.id;
        rerender();
      };

      const del = button('Supprimer', 'small danger', 'entry-delete');
      del.onclick = async () => {
        state.entries = state.entries.filter(x => x.id !== e.id);
        await persist();
        trackEvent('time_entry_deleted');
        rerender();
      };

      r.append(info, edit, del);
      c.appendChild(r);
    }
    return c;
  }

  function dashboardPage() {
    const f = document.createDocumentFragment();
    const periods = node('div', 'period-tabs');
    for (const p of ['7', '14', '30', '90']) {
      const b = button(`${p} jours`, state.period === p ? 'active' : 'secondary', `dashboard-period-${p}`);
      b.onclick = () => {
        state.period = p;
        trackEvent('dashboard_period_changed', dashboardPeriodChangedPayload({ period: p }));
        rerender();
      };
      periods.appendChild(b);
    }
    f.appendChild(periods);

    const data = dashboardEntries();
    const total = data.reduce((s, e) => s + e.mins, 0);
    const metrics = node('div', 'metric-grid');
    metrics.append(
      metric('Temps total', `${Math.floor(total / 60)}h ${Math.round(total % 60)}m`),
      metric('Entrées', data.length),
      metric('Jours actifs', new Set(data.map(e => e.date)).size)
    );
    f.appendChild(metrics);

    const chart = card('Statistiques');
    chart.append(node('h3', 'chart-title', 'Temps par jour'));
    const dc = document.createElement('canvas');
    dc.id = 'day-chart';
    chart.appendChild(dc);

    chart.append(node('h3', 'chart-title', 'Répartition par heure'));
    const hc = document.createElement('canvas');
    hc.id = 'hour-chart';
    chart.appendChild(hc);

    chart.append(node('h3', 'chart-title', 'Répartition du temps par catégorie / sous-catégorie'));
    const cc = document.createElement('canvas');
    cc.id = 'category-chart';
    chart.appendChild(cc);

    f.appendChild(chart);
    f.appendChild(insightsCard());
    return f;
  }

  function insightsCard() {
    const c = card('Suggestions détectées (bêta)');
    const behavior = getBehaviorTracking();
    if (!behavior) {
      c.appendChild(node('p', 'muted', 'Activez le suivi (bandeau de consentement) pour voir apparaître ici des suggestions basées sur votre propre usage.'));
      return c;
    }
    const list = node('div', 'insights-list');
    list.appendChild(node('p', 'muted', 'Analyse en cours…'));
    c.appendChild(list);
    refreshInsights(list);
    return c;
  }

  function refreshInsights(list) {
    const now = Date.now();
    const shouldRun = now - lastInsightsRefresh > 10000;
    const paint = () => {
      const candidates = getFeatureCandidates({ limit: 5 });
      list.replaceChildren();
      if (!candidates.length) {
        list.appendChild(node('p', 'muted', 'Pas encore assez de données pour détecter un schéma récurrent.'));
        return;
      }
      for (const candidate of candidates) {
        const item = node('div', 'insight-item');
        item.appendChild(node('p', null, candidate.description));
        item.appendChild(node('span', 'muted', `Support : ${candidate.supportUsers} utilisateur${candidate.supportUsers > 1 ? 's' : ''} · hypothèse non appliquée automatiquement`));
        list.appendChild(item);
      }
    };
    if (shouldRun) {
      lastInsightsRefresh = now;
      runPatternDetection().then(paint).catch(paint);
    } else {
      paint();
    }
  }

  function categoriesPage() {
    const manager = createCategoryManager({ state, persist, rerender });
    return manager.render();
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

    const box = node('div', 'modal-box');
    const head = node('div', 'modal-head');
    const titleText = 'Activité enregistrée';
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
    const a = input('Nom', 'text', '', true, 'label');
    const c = selectCategory(state.categories[0]?.id);
    const save = button('Enregistrer', undefined, 'activity-save');
    save.type = 'submit';

    form.append(a.wrap, c.wrap, save);
    form.onsubmit = async e => {
      e.preventDefault();
      const label = a.input.value.trim();
      if (!label) {
        getBehaviorTracking()?.tracker.trackFormResult('activity-form', 'error', { object: 'saved_activity', code: 'invalid-label' });
        return;
      }
      state.activities.push({ id: crypto.randomUUID(), label, categoryId: c.select.value });
      state.modal = null;
      await persist();
      trackEvent('saved_activity_created', savedActivityCreatedPayload({ hasCategory: Boolean(c.select.value) }));
      getBehaviorTracking()?.tracker.trackFormResult('activity-form', 'success', { object: 'saved_activity' });
      rerender();
    };

    box.appendChild(form);
    overlay.appendChild(box);
    return overlay;
  }

  function dataCard() {
    const c = card('Données');
    const row = node('div', 'action-row');
    const exp = button('Exporter', undefined, 'data-export');
    const imp = button('Importer', undefined, 'data-import');
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
    a.download = `time-tracker-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
    trackEvent('data_exported', dataExportedPayload({ entryCount: state.entries.length, categoryCount: state.categories.length }));
  }

  async function importData(input) {
    const file = input.files?.[0];
    if (!file) return;
    state.error = null;
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
      rerender();
    } catch (e) {
      state.error = e?.message || 'Impossible d’importer ce fichier JSON.';
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
      rerender();
    } catch (e) {
      state.error = e?.message || 'Impossible d’effacer toutes les données.';
      getBehaviorTracking()?.tracker.trackError(e, { context: 'data' });
      rerender();
    }
  }

  async function startTimer(activity, categoryId, date, startTime) {
    if (!activity || !categoryId) return;
    state.activeTimer = createActiveTimer({
      activity,
      categoryId,
      startTs: Date.now(),
      startTime,
      date,
    });
    await persist();
    trackEvent('timer_started', timerStartedPayload({ hasCategory: Boolean(categoryId) }));
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
    await persist();
    trackEvent('timer_stopped', timerStoppedPayload({ durationMinutes, hasCategory }));
    trackEvent('time_entry_created', timeEntryCreatedPayload({ durationMinutes, hasCategory, viaTimer: true }));
    rerender();
  }

  function dashboardEntries() {
    const end = new Date();
    const days = Number(state.period) || 7;
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    const min = start.toISOString().slice(0, 10);
    const max = end.toISOString().slice(0, 10);
    return state.entries.flatMap(splitEntryByDay).filter(e => e.date >= min && e.date <= max);
  }

  function drawCharts() {
    const d = root.querySelector('#day-chart');
    const h = root.querySelector('#hour-chart');
    const c = root.querySelector('#category-chart');
    if (d && h) renderCharts({ dayCanvas: d, hourCanvas: h, categoryCanvas: c, entries: dashboardEntries() });
  }

  function selectCategory(selected) {
    const wrap = node('div', 'field');
    wrap.appendChild(label('Catégorie'));
    const select = document.createElement('select');
    select.dataset.behaviorField = 'category';
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

  function metric(labelText, value) {
    return node('div', 'metric', `${labelText}: ${value}`);
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

  function showError(parent, message) {
    const old = parent.querySelector('.error');
    old?.remove();
    parent.prepend(node('div', 'error', message));
  }

  function nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function clock(s) {
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  render();
  return {
    render,
    destroy: () => {
      clearInterval(ticker);
      destroyCharts();
    },
  };
}
