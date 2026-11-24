import { getValue, STORAGE_KEYS } from '../core/storage.js';
import { DEFAULT_CATEGORIES } from '../core/model.js';

let dayChart;
let hourChart;
let categoryTreeController;

export function destroyCharts() {
  dayChart?.destroy();
  hourChart?.destroy();
  categoryTreeController?.destroy();
  dayChart = undefined;
  hourChart = undefined;
  categoryTreeController = undefined;
}

export async function renderCharts({
  dayCanvas,
  hourCanvas,
  categoryCanvas,
  categoryTreeContainer,
  entries = [],
  categories: suppliedCategories = null,
  activities: suppliedActivities = null,
  onStartActivity = null,
  onAddCategory = null,
  onAddActivity = null,
  onEditCategory = null,
  onEditActivity = null,
  onMoveCategory = null,
  onMoveActivity = null,
  initialCollapsedIds = null,
  initialSearchQuery = '',
  onCollapsedChange = null,
  onSearchChange = null,
}) {
  destroyCharts();

  const categories = Array.isArray(suppliedCategories) && suppliedCategories.length
    ? suppliedCategories
    : mergeCategories(await getValue(STORAGE_KEYS.categories, []));

  if (window.Chart && dayCanvas && hourCanvas) {
    const byDay = new Map();
    const byHour = Array.from({ length: 24 }, () => 0);
    const categoryByDay = new Map();

    // Map each category to its root ancestor so subcategory time rolls up in the daily bar chart
    const categoryMap = new Map(categories.map(c => [c.id, c]));
    const getRootId = (catId) => {
      let current = categoryMap.get(catId);
      const visited = new Set();
      while (current?.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        const parent = categoryMap.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
      return current?.id || catId;
    };

    for (const entry of entries) {
      const mins = Math.max(0, Number(entry.mins) || 0);
      byDay.set(entry.date, (byDay.get(entry.date) || 0) + mins);
      const hour = Number(String(entry.start).slice(0, 2));
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) byHour[hour] += mins;
      if (entry.categoryId) {
        const rootId = getRootId(entry.categoryId);
        if (!categoryByDay.has(entry.date)) categoryByDay.set(entry.date, new Map());
        const map = categoryByDay.get(entry.date);
        map.set(rootId, (map.get(rootId) || 0) + mins);
      }
    }

    const roots = categories.filter(c => !c.parentId);
    const dayLabels = [...byDay.keys()].sort();
    const color = c => c.color || '#999999';

    dayChart = new window.Chart(dayCanvas, {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: roots.map(c => ({
          label: c.label,
          backgroundColor: color(c),
          borderColor: color(c),
          data: dayLabels.map(day => categoryByDay.get(day)?.get(c.id) || 0),
        })),
      },
      options: {
        responsive: true,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Minutes' } },
        },
      },
    });

    hourChart = new window.Chart(hourCanvas, {
      type: 'line',
      data: {
        labels: byHour.map((_, i) => `${String(i).padStart(2, '0')}h`),
        datasets: [{
          label: 'Temps suivi',
          data: byHour,
          borderColor: '#666666',
          backgroundColor: '#99999955',
          tension: 0.25,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } },
      },
    });
  }

  const treeHost = categoryTreeContainer || categoryCanvas;
  if (treeHost) {
    const { renderCategoryHierarchy } = await import('./category-hierarchy.js');
    categoryTreeController = await renderCategoryHierarchy(treeHost, entries, {
      categories,
      activities: suppliedActivities,
      initialCollapsedIds,
      initialSearchQuery,
      onCollapsedChange,
      onSearchChange,
      onStartActivity,
      onAddCategory,
      onAddActivity,
      onEditCategory,
      onEditActivity,
      onMoveCategory,
      onMoveActivity,
    });
  }
}

function mergeCategories(stored) {
  const result = [];
  const ids = new Set();
  for (const c of [...DEFAULT_CATEGORIES, ...(Array.isArray(stored) ? stored : [])]) {
    if (!c?.id || ids.has(c.id)) continue;
    result.push(c);
    ids.add(c.id);
  }
  return result;
}
