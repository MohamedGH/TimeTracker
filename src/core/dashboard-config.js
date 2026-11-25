/**
 * Customizable Dashboard Configuration — Pure functional domain model for TimeTracker.
 * Defines available data sources, chart types, metrics, layout presets, and pure mutations.
 */

export const DASHBOARD_WIDGET_KINDS = Object.freeze({
  KPI: 'kpi',
  CHART: 'chart',
  MAP: 'map',
  CATEGORY_TREE: 'categoryTree',
  INSIGHTS: 'insights',
});

export const DASHBOARD_CHART_TYPES = Object.freeze({
  BAR: 'bar',
  STACKED_BAR: 'stackedBar',
  HORIZONTAL_BAR: 'horizontalBar',
  LINE: 'line',
  AREA: 'area',
  DONUT: 'donut',
  RADAR: 'radar',
  HEATMAP: 'heatmap',
  TREEMAP: 'treemap',
  TABLE: 'table',
});

export const DASHBOARD_CHART_TYPE_DEFS = Object.freeze([
  { id: 'bar', label: 'Barres verticales' },
  { id: 'stackedBar', label: 'Barres empilées' },
  { id: 'horizontalBar', label: 'Barres horizontales' },
  { id: 'line', label: 'Courbe' },
  { id: 'area', label: 'Aire' },
  { id: 'donut', label: 'Anneau (Donut)' },
  { id: 'radar', label: 'Radar' },
  { id: 'heatmap', label: 'Carte thermique' },
  { id: 'treemap', label: 'Treemap' },
  { id: 'table', label: 'Tableau chiffré' },
]);

export const DASHBOARD_DATA_SOURCES = Object.freeze({
  DAILY: 'daily',
  CATEGORIES: 'categories',
  SUBCATEGORIES: 'subcategories',
  ACTIVITIES: 'activities',
  HOURLY: 'hourly',
  WEEKDAY: 'weekday',
  HEATMAP: 'heatmap',
  MODE: 'mode',
  DURATION_BUCKETS: 'durationBuckets',
});

export const DASHBOARD_DATA_SOURCE_DEFS = Object.freeze([
  {
    id: 'daily',
    label: 'Évolution par jour',
    description: 'Volume quotidien de temps ou de sessions',
    defaultChartType: 'stackedBar',
    compatibleCharts: ['stackedBar', 'bar', 'line', 'area', 'table'],
    compatibleMetrics: ['minutes', 'count', 'avg'],
  },
  {
    id: 'categories',
    label: 'Catégories principales',
    description: 'Répartition par catégorie racine (sous-catégories incluses)',
    defaultChartType: 'donut',
    compatibleCharts: ['donut', 'horizontalBar', 'bar', 'treemap', 'radar', 'table'],
    compatibleMetrics: ['minutes', 'count', 'avg'],
  },
  {
    id: 'subcategories',
    label: 'Catégories & sous-catégories',
    description: 'Temps direct par catégorie et sous-catégorie',
    defaultChartType: 'horizontalBar',
    compatibleCharts: ['horizontalBar', 'donut', 'bar', 'treemap', 'table'],
    compatibleMetrics: ['minutes', 'count', 'avg'],
  },
  {
    id: 'activities',
    label: 'Activités fréquentes',
    description: 'Classement des activités les plus suivies',
    defaultChartType: 'horizontalBar',
    compatibleCharts: ['horizontalBar', 'bar', 'donut', 'treemap', 'table'],
    compatibleMetrics: ['minutes', 'count', 'avg'],
  },
  {
    id: 'hourly',
    label: 'Heures de la journée',
    description: 'Distribution horaire de 00h à 23h',
    defaultChartType: 'area',
    compatibleCharts: ['area', 'line', 'bar', 'radar', 'table'],
    compatibleMetrics: ['minutes', 'count'],
  },
  {
    id: 'weekday',
    label: 'Jours de la semaine',
    description: 'Rythme hebdomadaire du lundi au dimanche',
    defaultChartType: 'radar',
    compatibleCharts: ['radar', 'bar', 'line', 'donut', 'table'],
    compatibleMetrics: ['minutes', 'count', 'avg'],
  },
  {
    id: 'heatmap',
    label: 'Matrice Jour × Créneau',
    description: 'Intensité par jour de la semaine et moment de journée',
    defaultChartType: 'heatmap',
    compatibleCharts: ['heatmap', 'table'],
    compatibleMetrics: ['minutes', 'count'],
  },
  {
    id: 'mode',
    label: 'Chrono vs Saisie manuelle',
    description: 'Part des sessions enregistrées au chrono ou saisies à la main',
    defaultChartType: 'donut',
    compatibleCharts: ['donut', 'bar', 'horizontalBar', 'table'],
    compatibleMetrics: ['minutes', 'count', 'avg'],
  },
  {
    id: 'durationBuckets',
    label: 'Durée des sessions',
    description: 'Répartition par tranches (<15 min, 15-30, 30-60, 1-2h, >2h)',
    defaultChartType: 'bar',
    compatibleCharts: ['bar', 'horizontalBar', 'donut', 'table'],
    compatibleMetrics: ['count', 'minutes'],
  },
]);

export const DASHBOARD_METRICS = Object.freeze({
  MINUTES: 'minutes',
  COUNT: 'count',
  AVG: 'avg',
});

export const DASHBOARD_METRIC_DEFS = Object.freeze([
  { id: 'minutes', label: 'Durée totale' },
  { id: 'count', label: 'Nombre de sessions' },
  { id: 'avg', label: 'Durée moyenne' },
]);

export const DASHBOARD_WIDGET_WIDTHS = Object.freeze(['half', 'full']);

export const BUILTIN_WIDGET_LABELS = Object.freeze({
  kpi: 'Indicateurs clés',
  map: 'Carte des lieux d’activité',
  categoryTree: 'Arborescence Catégories & Activités',
  insights: 'Observations & Suggestions',
});

export const DASHBOARD_PRESETS = Object.freeze([
  {
    id: 'standard',
    label: 'Vue équilibrée',
    widgets: [
      { id: 'w-kpi', kind: 'kpi', width: 'full', visible: true },
      {
        id: 'w-daily',
        kind: 'chart',
        title: 'Temps par jour',
        dataSource: 'daily',
        chartType: 'stackedBar',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-categories',
        kind: 'chart',
        title: 'Répartition par catégorie',
        dataSource: 'categories',
        chartType: 'donut',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-hourly',
        kind: 'chart',
        title: 'Répartition horaire',
        dataSource: 'hourly',
        chartType: 'area',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-activities',
        kind: 'chart',
        title: 'Activités principales',
        dataSource: 'activities',
        chartType: 'horizontalBar',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      { id: 'w-map', kind: 'map', width: 'full', visible: true },
      { id: 'w-tree', kind: 'categoryTree', width: 'full', visible: true },
      { id: 'w-insights', kind: 'insights', width: 'full', visible: true },
    ],
  },
  {
    id: 'analytics',
    label: 'Analyse approfondie',
    widgets: [
      { id: 'w-kpi', kind: 'kpi', width: 'full', visible: true },
      {
        id: 'w-daily',
        kind: 'chart',
        title: 'Tendance quotidienne par catégorie',
        dataSource: 'daily',
        chartType: 'stackedBar',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-weekday',
        kind: 'chart',
        title: 'Rythme hebdomadaire',
        dataSource: 'weekday',
        chartType: 'radar',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-heatmap',
        kind: 'chart',
        title: 'Matrice Jour × Créneau horaire',
        dataSource: 'heatmap',
        chartType: 'heatmap',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'full',
        visible: true,
      },
      {
        id: 'w-treemap',
        kind: 'chart',
        title: 'Poids relatif des catégories',
        dataSource: 'categories',
        chartType: 'treemap',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-mode',
        kind: 'chart',
        title: 'Chronomètre vs Saisie manuelle',
        dataSource: 'mode',
        chartType: 'donut',
        metric: 'count',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-durations',
        kind: 'chart',
        title: 'Distribution des durées de session',
        dataSource: 'durationBuckets',
        chartType: 'bar',
        metric: 'count',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-table',
        kind: 'chart',
        title: 'Tableau détaillé des activités',
        dataSource: 'activities',
        chartType: 'table',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      { id: 'w-insights', kind: 'insights', width: 'full', visible: true },
    ],
  },
  {
    id: 'minimal',
    label: 'Essentiel & Synthèse',
    widgets: [
      { id: 'w-kpi', kind: 'kpi', width: 'full', visible: true },
      {
        id: 'w-categories',
        kind: 'chart',
        title: 'Catégories principales',
        dataSource: 'categories',
        chartType: 'donut',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-daily',
        kind: 'chart',
        title: 'Évolution par jour',
        dataSource: 'daily',
        chartType: 'bar',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'half',
        visible: true,
      },
      {
        id: 'w-activities',
        kind: 'chart',
        title: 'Top activités',
        dataSource: 'activities',
        chartType: 'horizontalBar',
        metric: 'minutes',
        categoryFilter: 'global',
        width: 'full',
        visible: true,
      },
    ],
  },
]);

export const QUICK_CHART_TEMPLATES = Object.freeze([
  {
    id: 'tpl-weekday-radar',
    label: 'Rythme semaine (Radar)',
    dataSource: 'weekday',
    chartType: 'radar',
    metric: 'minutes',
    width: 'half',
  },
  {
    id: 'tpl-heatmap',
    label: 'Carte thermique Jour × Heure',
    dataSource: 'heatmap',
    chartType: 'heatmap',
    metric: 'minutes',
    width: 'full',
  },
  {
    id: 'tpl-treemap',
    label: 'Treemap catégories',
    dataSource: 'categories',
    chartType: 'treemap',
    metric: 'minutes',
    width: 'half',
  },
  {
    id: 'tpl-mode-donut',
    label: 'Chrono vs Manuel',
    dataSource: 'mode',
    chartType: 'donut',
    metric: 'count',
    width: 'half',
  },
  {
    id: 'tpl-duration-buckets',
    label: 'Durées des sessions',
    dataSource: 'durationBuckets',
    chartType: 'bar',
    metric: 'count',
    width: 'half',
  },
  {
    id: 'tpl-activities-table',
    label: 'Tableau des activités',
    dataSource: 'activities',
    chartType: 'table',
    metric: 'minutes',
    width: 'full',
  },
]);

const SOURCE_MAP = new Map(DASHBOARD_DATA_SOURCE_DEFS.map(def => [def.id, def]));
const CHART_MAP = new Map(DASHBOARD_CHART_TYPE_DEFS.map(def => [def.id, def]));
const METRIC_MAP = new Map(DASHBOARD_METRIC_DEFS.map(def => [def.id, def]));

export function getDataSourceDef(dataSource) {
  return SOURCE_MAP.get(dataSource) || DASHBOARD_DATA_SOURCE_DEFS[0];
}

export function getChartTypeDef(chartType) {
  return CHART_MAP.get(chartType) || DASHBOARD_CHART_TYPE_DEFS[0];
}

export function getMetricDef(metric) {
  return METRIC_MAP.get(metric) || DASHBOARD_METRIC_DEFS[0];
}

export function getCompatibleChartTypes(dataSource) {
  const def = getDataSourceDef(dataSource);
  return def.compatibleCharts.map(id => getChartTypeDef(id));
}

export function getCompatibleMetrics(dataSource) {
  const def = getDataSourceDef(dataSource);
  return def.compatibleMetrics.map(id => getMetricDef(id));
}

export function resolveCompatibleChartType(dataSource, preferredChartType) {
  const def = getDataSourceDef(dataSource);
  if (def.compatibleCharts.includes(preferredChartType)) {
    return preferredChartType;
  }
  return def.defaultChartType;
}

export function resolveCompatibleMetric(dataSource, preferredMetric) {
  const def = getDataSourceDef(dataSource);
  if (def.compatibleMetrics.includes(preferredMetric)) {
    return preferredMetric;
  }
  return def.compatibleMetrics[0];
}

export function getDefaultTitleForChart({ dataSource, chartType: _chartType, metric }) {
  const srcDef = getDataSourceDef(dataSource);
  if (metric === 'count' && dataSource === 'daily') return 'Sessions par jour';
  if (metric === 'avg' && dataSource === 'activities') return 'Durée moyenne par activité';
  return srcDef.label;
}

function normalizeWidget(raw, idx) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = Object.values(DASHBOARD_WIDGET_KINDS).includes(raw.kind) ? raw.kind : null;
  if (!kind) return null;

  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id.trim()
    : `w-${kind}-${idx + 1}`;
  const width = DASHBOARD_WIDGET_WIDTHS.includes(raw.width)
    ? raw.width
    : (kind === 'chart' ? 'half' : 'full');
  const visible = raw.visible !== false;

  if (kind !== DASHBOARD_WIDGET_KINDS.CHART) {
    return { id, kind, width, visible };
  }

  const dataSource = SOURCE_MAP.has(raw.dataSource) ? raw.dataSource : DASHBOARD_DATA_SOURCES.DAILY;
  const chartType = resolveCompatibleChartType(dataSource, raw.chartType);
  const metric = resolveCompatibleMetric(dataSource, raw.metric);
  const categoryFilter = typeof raw.categoryFilter === 'string' && raw.categoryFilter.trim()
    ? raw.categoryFilter.trim()
    : 'global';
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim()
    : getDefaultTitleForChart({ dataSource, chartType, metric });

  return {
    id,
    kind,
    title,
    dataSource,
    chartType,
    metric,
    categoryFilter,
    width,
    visible,
  };
}

export function createDefaultDashboardConfig() {
  const preset = DASHBOARD_PRESETS[0];
  return {
    presetId: preset.id,
    widgets: preset.widgets.map(w => ({ ...w })),
  };
}

export function normalizeDashboardConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.widgets) || raw.widgets.length === 0) {
    return createDefaultDashboardConfig();
  }

  const seenIds = new Set();
  const widgets = [];
  raw.widgets.forEach((w, idx) => {
    const norm = normalizeWidget(w, idx);
    if (!norm || seenIds.has(norm.id)) return;
    seenIds.add(norm.id);
    widgets.push(norm);
  });

  if (!widgets.length) {
    return createDefaultDashboardConfig();
  }

  const presetId = typeof raw.presetId === 'string' && raw.presetId.trim()
    ? raw.presetId.trim()
    : 'custom';

  return {
    presetId,
    widgets,
  };
}

export function applyDashboardPreset(presetId) {
  const preset = DASHBOARD_PRESETS.find(p => p.id === presetId) || DASHBOARD_PRESETS[0];
  return {
    presetId: preset.id,
    widgets: preset.widgets.map(w => ({ ...w })),
  };
}

export function addChartWidget(config, widgetInput = {}) {
  const base = normalizeDashboardConfig(config);
  const dataSource = SOURCE_MAP.has(widgetInput.dataSource)
    ? widgetInput.dataSource
    : DASHBOARD_DATA_SOURCES.CATEGORIES;
  const chartType = resolveCompatibleChartType(dataSource, widgetInput.chartType);
  const metric = resolveCompatibleMetric(dataSource, widgetInput.metric);
  const id = typeof widgetInput.id === 'string' && widgetInput.id.trim()
    ? widgetInput.id.trim()
    : `w-chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const title = typeof widgetInput.title === 'string' && widgetInput.title.trim()
    ? widgetInput.title.trim()
    : getDefaultTitleForChart({ dataSource, chartType, metric });
  const width = DASHBOARD_WIDGET_WIDTHS.includes(widgetInput.width) ? widgetInput.width : 'half';
  const categoryFilter = typeof widgetInput.categoryFilter === 'string' && widgetInput.categoryFilter.trim()
    ? widgetInput.categoryFilter.trim()
    : 'global';

  const newWidget = {
    id,
    kind: DASHBOARD_WIDGET_KINDS.CHART,
    title,
    dataSource,
    chartType,
    metric,
    categoryFilter,
    width,
    visible: true,
  };

  // Insert right after the last chart or KPI so new charts appear prominently above map/insights if present
  const widgets = [...base.widgets];
  const insertAt = widgets.reduce((pos, w, idx) => (
    w.kind === DASHBOARD_WIDGET_KINDS.KPI || w.kind === DASHBOARD_WIDGET_KINDS.CHART ? idx + 1 : pos
  ), 0);
  widgets.splice(insertAt, 0, newWidget);

  return {
    presetId: 'custom',
    widgets,
  };
}

export function updateDashboardWidget(config, widgetId, patch = {}) {
  const base = normalizeDashboardConfig(config);
  let changed = false;
  const widgets = base.widgets.map((w) => {
    if (w.id !== widgetId) return w;
    changed = true;
    if (w.kind !== DASHBOARD_WIDGET_KINDS.CHART) {
      return {
        ...w,
        ...(DASHBOARD_WIDGET_WIDTHS.includes(patch.width) ? { width: patch.width } : {}),
        ...(typeof patch.visible === 'boolean' ? { visible: patch.visible } : {}),
      };
    }

    const nextSource = SOURCE_MAP.has(patch.dataSource) ? patch.dataSource : w.dataSource;
    const dataSourceChanged = nextSource !== w.dataSource;
    const nextChartType = resolveCompatibleChartType(
      nextSource,
      patch.chartType ?? (dataSourceChanged ? getDataSourceDef(nextSource).defaultChartType : w.chartType)
    );
    const nextMetric = resolveCompatibleMetric(nextSource, patch.metric ?? w.metric);

    let nextTitle = w.title;
    if (typeof patch.title === 'string') {
      nextTitle = patch.title.trim() || getDefaultTitleForChart({ dataSource: nextSource, chartType: nextChartType, metric: nextMetric });
    } else if (dataSourceChanged && w.title === getDefaultTitleForChart({ dataSource: w.dataSource, chartType: w.chartType, metric: w.metric })) {
      nextTitle = getDefaultTitleForChart({ dataSource: nextSource, chartType: nextChartType, metric: nextMetric });
    }

    return {
      ...w,
      title: nextTitle,
      dataSource: nextSource,
      chartType: nextChartType,
      metric: nextMetric,
      categoryFilter: typeof patch.categoryFilter === 'string' && patch.categoryFilter.trim()
        ? patch.categoryFilter.trim()
        : w.categoryFilter,
      width: DASHBOARD_WIDGET_WIDTHS.includes(patch.width) ? patch.width : w.width,
      visible: typeof patch.visible === 'boolean' ? patch.visible : w.visible,
    };
  });

  if (!changed) return base;
  return {
    presetId: 'custom',
    widgets,
  };
}

export function duplicateDashboardWidget(config, widgetId) {
  const base = normalizeDashboardConfig(config);
  const idx = base.widgets.findIndex(w => w.id === widgetId);
  if (idx < 0 || base.widgets[idx].kind !== DASHBOARD_WIDGET_KINDS.CHART) return base;
  const source = base.widgets[idx];
  const copy = {
    ...source,
    id: `w-chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: `${source.title} (copie)`,
  };
  const widgets = [...base.widgets];
  widgets.splice(idx + 1, 0, copy);
  return {
    presetId: 'custom',
    widgets,
  };
}

export function removeDashboardWidget(config, widgetId) {
  const base = normalizeDashboardConfig(config);
  const target = base.widgets.find(w => w.id === widgetId);
  if (!target) return base;

  // Built-in structural sections are hidden rather than permanently erased so users can re-enable them easily
  if (target.kind !== DASHBOARD_WIDGET_KINDS.CHART) {
    return updateDashboardWidget(base, widgetId, { visible: false });
  }

  return {
    presetId: 'custom',
    widgets: base.widgets.filter(w => w.id !== widgetId),
  };
}

export function moveDashboardWidget(config, widgetId, direction) {
  const base = normalizeDashboardConfig(config);
  const idx = base.widgets.findIndex(w => w.id === widgetId);
  if (idx < 0) return base;

  const delta = direction < 0 ? -1 : 1;
  // Find nearest visible neighbor when moving in visible layout, or direct neighbor
  let targetIdx = idx + delta;
  while (targetIdx >= 0 && targetIdx < base.widgets.length && !base.widgets[targetIdx].visible) {
    targetIdx += delta;
  }
  if (targetIdx < 0 || targetIdx >= base.widgets.length) return base;

  const widgets = [...base.widgets];
  const [moved] = widgets.splice(idx, 1);
  widgets.splice(targetIdx, 0, moved);
  return {
    presetId: 'custom',
    widgets,
  };
}
