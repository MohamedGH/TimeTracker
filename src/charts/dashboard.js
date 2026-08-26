import { getValue, STORAGE_KEYS } from '../core/storage.js';
import { DEFAULT_CATEGORIES } from '../core/model.js';

let dayChart;
let hourChart;
let categoryChart;

export function destroyCharts() {
  dayChart?.destroy();
  hourChart?.destroy();
  categoryChart?.destroy();
  dayChart = undefined;
  hourChart = undefined;
  categoryChart = undefined;
}

export async function renderCharts({ dayCanvas, hourCanvas, categoryCanvas, entries }) {
  destroyCharts();
  if (!window.Chart || !dayCanvas || !hourCanvas) return;

  const byDay = new Map();
  const byHour = Array.from({ length: 24 }, () => 0);
  const categoryByDay = new Map();
  for (const entry of entries) {
    const mins = Math.max(0, Number(entry.mins) || 0);
    byDay.set(entry.date, (byDay.get(entry.date) || 0) + mins);
    const hour = Number(String(entry.start).slice(0, 2));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) byHour[hour] += mins;
    if (entry.categoryId) {
      if (!categoryByDay.has(entry.date)) categoryByDay.set(entry.date, new Map());
      const map = categoryByDay.get(entry.date);
      map.set(entry.categoryId, (map.get(entry.categoryId) || 0) + mins);
    }
  }

  const categories = mergeCategories(await getValue(STORAGE_KEYS.categories, []));
  const roots = categories.filter(c => !c.parentId);
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const dayLabels = [...byDay.keys()].sort();
  const color = c => c.color || '#999999';

  dayChart = new window.Chart(dayCanvas, {
    type: 'bar',
    data: { labels: dayLabels, datasets: roots.map(c => ({
      label: c.label,
      backgroundColor: color(c),
      borderColor: color(c),
      data: dayLabels.map(day => categoryByDay.get(day)?.get(c.id) || 0)
    })) },
    options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Minutes' } } } }
  });

  hourChart = new window.Chart(hourCanvas, {
    type: 'line',
    data: { labels: byHour.map((_, i) => `${String(i).padStart(2, '0')}h`), datasets: [{ label: 'Temps suivi', data: byHour, borderColor: '#666666', backgroundColor: '#99999955', tension: 0.25, fill: true }] },
    options: { responsive: true, scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } } }
  });

  if (categoryCanvas) {
    const { renderCategoryHierarchy } = await import('./category-hierarchy.js');
    await renderCategoryHierarchy(categoryCanvas, entries);
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
