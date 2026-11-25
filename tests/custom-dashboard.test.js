import { describe, it, expect, beforeEach } from 'vitest';
import {
  DASHBOARD_DATA_SOURCES,
  DASHBOARD_CHART_TYPES,
  DASHBOARD_METRICS,
  createDefaultDashboardConfig,
  applyDashboardPreset,
  addChartWidget,
  updateDashboardWidget,
  duplicateDashboardWidget,
  removeDashboardWidget,
  moveDashboardWidget,
  getCompatibleChartTypes,
  getCompatibleMetrics,
  resolveCompatibleChartType,
} from '../src/core/dashboard-config.js';
import {
  PERIODS,
  filterEntriesByPeriod,
  filterEntriesByCategorySubtree,
  buildCustomDashboardDataset,
} from '../src/core/statistics.js';
import { renderCustomChart } from '../src/charts/custom-charts.js';
import { clearAllData } from '../src/core/storage.js';
import { createAppState } from '../src/app-state.js';
import { createUI } from '../src/ui.js';

describe('Customizable Dashboard Configuration & Domain Logic', () => {
  it('provides default balanced preset with charts and built-in sections', () => {
    const config = createDefaultDashboardConfig();
    expect(config.presetId).toBe('standard');
    expect(config.widgets.length).toBeGreaterThanOrEqual(6);
    expect(config.widgets.some(w => w.kind === 'kpi')).toBe(true);
    expect(config.widgets.some(w => w.kind === 'map')).toBe(true);
    expect(config.widgets.some(w => w.kind === 'categoryTree')).toBe(true);
    expect(config.widgets.some(w => w.kind === 'insights')).toBe(true);
    expect(config.widgets.some(w => w.kind === 'chart' && w.dataSource === 'daily')).toBe(true);
  });

  it('switches between presets (standard, analytics, minimal)', () => {
    const analytics = applyDashboardPreset('analytics');
    expect(analytics.presetId).toBe('analytics');
    expect(analytics.widgets.some(w => w.chartType === 'heatmap')).toBe(true);
    expect(analytics.widgets.some(w => w.chartType === 'radar')).toBe(true);

    const minimal = applyDashboardPreset('minimal');
    expect(minimal.presetId).toBe('minimal');
    expect(minimal.widgets.some(w => w.kind === 'map')).toBe(false);
  });

  it('enforces chart type and metric compatibility when switching data sources', () => {
    const heatmapCharts = getCompatibleChartTypes(DASHBOARD_DATA_SOURCES.HEATMAP);
    expect(heatmapCharts.map(c => c.id)).toContain('heatmap');
    expect(heatmapCharts.map(c => c.id)).not.toContain('donut');

    const resolved = resolveCompatibleChartType(DASHBOARD_DATA_SOURCES.HEATMAP, 'donut');
    expect(resolved).toBe('heatmap');

    const metrics = getCompatibleMetrics(DASHBOARD_DATA_SOURCES.HEATMAP);
    expect(metrics.map(m => m.id)).toEqual(['minutes', 'count']);
  });

  it('adds, updates, duplicates, removes, and moves widgets immutably', () => {
    let cfg = createDefaultDashboardConfig();
    const initialCount = cfg.widgets.length;

    // Add chart
    cfg = addChartWidget(cfg, {
      title: 'Mon Radar',
      dataSource: DASHBOARD_DATA_SOURCES.WEEKDAY,
      chartType: DASHBOARD_CHART_TYPES.RADAR,
      metric: DASHBOARD_METRICS.MINUTES,
      width: 'half',
    });
    expect(cfg.widgets.length).toBe(initialCount + 1);
    const added = cfg.widgets.find(w => w.title === 'Mon Radar');
    expect(added).toBeTruthy();
    expect(added.chartType).toBe('radar');

    // Update chart
    cfg = updateDashboardWidget(cfg, added.id, {
      title: 'Mon Radar Modifié',
      chartType: DASHBOARD_CHART_TYPES.BAR,
    });
    const updated = cfg.widgets.find(w => w.id === added.id);
    expect(updated.title).toBe('Mon Radar Modifié');
    expect(updated.chartType).toBe('bar');

    // Duplicate chart
    cfg = duplicateDashboardWidget(cfg, added.id);
    expect(cfg.widgets.length).toBe(initialCount + 2);
    expect(cfg.widgets.some(w => w.title === 'Mon Radar Modifié (copie)')).toBe(true);

    // Move widget forward
    const origIdx = cfg.widgets.findIndex(w => w.id === added.id);
    cfg = moveDashboardWidget(cfg, added.id, 1);
    const newIdx = cfg.widgets.findIndex(w => w.id === added.id);
    expect(newIdx).toBe(origIdx + 1);

    // Remove chart
    cfg = removeDashboardWidget(cfg, added.id);
    expect(cfg.widgets.find(w => w.id === added.id)).toBeUndefined();

    // Hiding a built-in widget marks visible: false
    const kpiWidget = cfg.widgets.find(w => w.kind === 'kpi');
    cfg = removeDashboardWidget(cfg, kpiWidget.id);
    const hiddenKpi = cfg.widgets.find(w => w.id === kpiWidget.id);
    expect(hiddenKpi.visible).toBe(false);
  });
});

describe('Dataset extraction across dimensions and metrics', () => {
  const categories = [
    { id: 'travail', label: 'Travail', color: '#3F7068', parentId: null },
    { id: 'dev', label: 'Développement', color: '#2980B9', parentId: 'travail' },
    { id: 'sport', label: 'Sport', color: '#8C6D3F', parentId: null },
  ];

  const entries = [
    { id: '1', activity: 'Code', categoryId: 'dev', date: '2026-09-28', start: '09:00', end: '11:00', mins: 120, manual: false },
    { id: '2', activity: 'Réunion', categoryId: 'travail', date: '2026-09-28', start: '14:00', end: '14:45', mins: 45, manual: true },
    { id: '3', activity: 'Course', categoryId: 'sport', date: '2026-09-27', start: '18:00', end: '18:30', mins: 30, manual: false },
    { id: '4', activity: 'Code', categoryId: 'dev', date: '2026-09-20', start: '10:00', end: '12:00', mins: 120, manual: false },
  ];

  it('supports custom date ranges with start and end', () => {
    const filtered = filterEntriesByPeriod(entries, PERIODS.CUSTOM, '2026-09-28', {
      customRange: { start: '2026-09-27', end: '2026-09-28' },
    });
    expect(filtered.map(e => e.id)).toEqual(['1', '2', '3']);
  });

  it('filters entries recursively by category subtree', () => {
    const travailSubtree = filterEntriesByCategorySubtree(entries, categories, 'travail');
    // dev is a child of travail, so includes 1 (dev), 2 (travail), 4 (dev)
    expect(travailSubtree.map(e => e.id)).toEqual(['1', '2', '4']);

    const sportSubtree = filterEntriesByCategorySubtree(entries, categories, 'sport');
    expect(sportSubtree.map(e => e.id)).toEqual(['3']);
  });

  it('builds datasets for all 9 data sources with metrics', () => {
    // 1. Daily stacked
    const dsDaily = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'daily',
      metric: 'minutes',
      period: '7',
      refDate: '2026-09-28',
    });
    expect(dsDaily.rows.length).toBe(7);
    expect(dsDaily.empty).toBe(false);

    // 2. Categories
    const dsCat = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'categories',
      metric: 'minutes',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsCat.series.length).toBe(2); // travail (roots) & sport
    expect(dsCat.totalMinutes).toBe(315);

    // 3. Subcategories
    const dsSub = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'subcategories',
      metric: 'count',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsSub.series.some(s => s.label === 'Développement')).toBe(true);

    // 4. Activities
    const dsAct = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'activities',
      metric: 'minutes',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsAct.series[0].label).toBe('Code');
    expect(dsAct.series[0].value).toBe(240);

    // 5. Hourly
    const dsHour = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'hourly',
      metric: 'minutes',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsHour.series.length).toBe(24);

    // 6. Weekday
    const dsWeek = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'weekday',
      metric: 'minutes',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsWeek.series.length).toBe(7);

    // 7. Heatmap matrix
    const dsHeat = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'heatmap',
      metric: 'minutes',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsHeat.rowLabels.length).toBe(7);
    expect(dsHeat.colLabels.length).toBe(4);
    expect(dsHeat.cells.length).toBe(28);

    // 8. Mode (Chrono vs Manuel)
    const dsMode = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'mode',
      metric: 'count',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsMode.series.find(s => s.id === 'chrono').value).toBe(3);
    expect(dsMode.series.find(s => s.id === 'manual').value).toBe(1);

    // 9. Duration buckets
    const dsBuckets = buildCustomDashboardDataset({
      entries,
      categories,
      dataSource: 'durationBuckets',
      metric: 'count',
      period: 'all',
      refDate: '2026-09-28',
    });
    expect(dsBuckets.series.length).toBe(5);
  });
});

describe('D3 Custom Chart Rendering', () => {
  const dataset = {
    empty: false,
    metric: 'minutes',
    totalMinutes: 180,
    formattedTotal: '3 h',
    series: [
      { id: '1', label: 'Travail', value: 120, formattedValue: '2 h', shareFormatted: '50.0%', color: '#3F7068', count: 2, formattedMinutes: '2 h', formattedAvg: '1 h' },
      { id: '2', label: 'Sport', value: 60, formattedValue: '1 h', shareFormatted: '25.0%', color: '#8C6D3F', count: 1, formattedMinutes: '1 h', formattedAvg: '1 h' },
      { id: '3', label: 'Études', value: 60, formattedValue: '1 h', shareFormatted: '25.0%', color: '#4A5A75', count: 1, formattedMinutes: '1 h', formattedAvg: '1 h' },
    ],
    rows: [
      { date: '2026-09-28', label: '28/09', total: 120, valuesByStack: { travail: 120 } },
    ],
    stacks: [
      { id: 'travail', label: 'Travail', color: '#3F7068' },
    ],
    rowLabels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
    colLabels: ['Matin', 'Midi', 'Après-midi', 'Soir'],
    cells: [
      { rowLabel: 'Lun', colLabel: 'Matin', value: 120, count: 1, formattedValue: '2 h' },
    ],
    maxValue: 120,
  };

  it('renders SVG / elements across chart types without throwing', () => {
    const types = ['bar', 'stackedBar', 'horizontalBar', 'line', 'area', 'donut', 'radar', 'heatmap', 'treemap', 'table'];
    for (const type of types) {
      const container = document.createElement('div');
      renderCustomChart(container, dataset, type);
      expect(container.children.length).toBeGreaterThan(0);
      if (type === 'table') {
        expect(container.querySelector('table.custom-chart-table')).toBeTruthy();
      } else if (type === 'horizontalBar') {
        expect(container.querySelector('.custom-hbar-list')).toBeTruthy();
      } else {
        expect(container.querySelector('svg')).toBeTruthy();
      }
    }
  });

  it('renders clean empty state placeholder when dataset is empty', () => {
    const container = document.createElement('div');
    renderCustomChart(container, { empty: true }, 'bar');
    expect(container.querySelector('.custom-chart-empty')).toBeTruthy();
  });
});

describe('Customizable Dashboard UI Interaction & Session Persistence', () => {
  beforeEach(async () => {
    await clearAllData();
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#dashboard';
  });

  it('allows customizing widgets, adding new charts, changing presets, and persisting everything across app reload', async () => {
    const root1 = document.createElement('div');
    document.body.appendChild(root1);

    const app1 = await createAppState();
    // Seed some entries
    app1.state.entries = [
      { id: 'e1', activity: 'Dev Frontend', categoryId: 'travail', date: '2026-09-28', start: '09:00', end: '11:00', mins: 120, manual: false },
      { id: 'e2', activity: 'Sport Footing', categoryId: 'sport', date: '2026-09-28', start: '18:00', end: '19:00', mins: 60, manual: false },
    ];
    await app1.persist();

    const ui1 = createUI({
      root: root1,
      ...app1,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    // 1. Verify dashboard rendered
    expect(root1.querySelector('.dashboard-custom-toolbar')).toBeTruthy();
    expect(root1.querySelector('[data-behavior-target="dashboard-preset-select"]')).toBeTruthy();

    // 2. Switch preset to "analytics"
    const presetSelect = root1.querySelector('[data-behavior-target="dashboard-preset-select"]');
    presetSelect.value = 'analytics';
    presetSelect.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 40));

    expect(app1.state.uiState.dashboardConfig.presetId).toBe('analytics');
    expect(root1.querySelector('[data-custom-chart-id="w-heatmap"]')).toBeTruthy();

    // 3. Open "+ Ajouter un graphique" modal and pick a quick template
    const addBtn = root1.querySelector('[data-behavior-target="dashboard-add-chart"]');
    addBtn.click();
    await new Promise(r => setTimeout(r, 40));

    const modal = root1.querySelector('.modal-overlay');
    expect(modal).toBeTruthy();
    expect(modal.querySelector('.dashboard-template-card')).toBeTruthy();
    const radarTpl = modal.querySelector('[data-template-id="tpl-weekday-radar"]');
    radarTpl.click();
    await new Promise(r => setTimeout(r, 40));

    // Chart should now exist in state
    const addedChart = app1.state.uiState.dashboardConfig.widgets.find(w => w.dataSource === 'weekday' && w.chartType === 'radar');
    expect(addedChart).toBeTruthy();

    // 4. Toggle customize panel and hide map section
    const customizeToggle = root1.querySelector('[data-behavior-target="dashboard-customize-toggle"]');
    customizeToggle.click();
    await new Promise(r => setTimeout(r, 40));

    const customizePanel = root1.querySelector('[data-dashboard-customize-panel="true"]');
    expect(customizePanel.hidden).toBe(false);

    // 5. Change global category filter
    const catFilter = root1.querySelector('[data-behavior-target="dashboard-category-filter"]');
    catFilter.value = 'travail';
    catFilter.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 40));
    expect(app1.state.uiState.dashboardCategoryFilter).toBe('travail');

    // Clean up first instance
    ui1.destroy();
    root1.remove();

    // 6. Reopen app from scratch (simulate fresh session)
    window.location.hash = '#dashboard';
    const root2 = document.createElement('div');
    document.body.appendChild(root2);

    const app2 = await createAppState();
    const ui2 = createUI({
      root: root2,
      ...app2,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    // Check that custom dashboard configuration and category filter survived reload
    expect(app2.state.uiState.dashboardCategoryFilter).toBe('travail');
    expect(app2.state.uiState.dashboardConfig.widgets.some(w => w.dataSource === 'weekday' && w.chartType === 'radar')).toBe(true);
    expect(root2.querySelector('[data-behavior-target="dashboard-category-filter"]').value).toBe('travail');

    ui2.destroy();
    root2.remove();
  });
});
