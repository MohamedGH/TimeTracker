import { getValue, STORAGE_KEYS } from '../core/storage.js';
import { DEFAULT_CATEGORIES } from '../core/model.js';
import { formatCategoryPath } from '../core/category-tree.js';

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

export function renderCharts({ dayCanvas, hourCanvas, categoryCanvas, entries }) {
  destroyCharts();
  if (!window.Chart || !dayCanvas || !hourCanvas) return;

  const byDay = new Map();
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const entry of entries) {
    const mins = Math.max(0, Number(entry.mins) || 0);
    byDay.set(entry.date, (byDay.get(entry.date) || 0) + mins);
    const hour = Number(String(entry.start).slice(0, 2));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) byHour[hour] += mins;
  }

  const dayLabels = [...byDay.keys()].sort();
  dayChart = new window.Chart(dayCanvas, {
    type: 'bar', data: { labels: dayLabels, datasets: [{ label: 'Minutes', data: dayLabels.map(d => byDay.get(d)) }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  hourChart = new window.Chart(hourCanvas, {
    type: 'line', data: { labels: byHour.map((_, i) => `${String(i).padStart(2, '0')}h`), datasets: [{ label: 'Minutes', data: byHour, tension: 0.25 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  if (categoryCanvas) renderCategoryChart(categoryCanvas, entries);
}

async function renderCategoryChart(canvas, entries) {
  const stored = await getValue(STORAGE_KEYS.categories, []);
  const categories = mergeCategories(stored);
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const totals = new Map();
  for (const entry of entries) {
    if (!entry.categoryId) continue;
    const mins = Math.max(0, Number(entry.mins) || 0);
    let current = categoryById.get(entry.categoryId);
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      totals.set(current.id, (totals.get(current.id) || 0) + mins);
      current = current.parentId ? categoryById.get(current.parentId) : null;
    }
  }
  const rows = [...totals.entries()].filter(([, mins]) => mins > 0).sort((a, b) => b[1] - a[1]);
  categoryChart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: rows.map(([id]) => formatCategoryPath(categories, id)),
      datasets: [{ data: rows.map(([, mins]) => mins) }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatMinutes(ctx.raw)} · ${((ctx.raw / 1440) * 100).toFixed(1)} % du jour` } },
      },
    },
  });
}

function mergeCategories(stored) {
  const result = [];
  const ids = new Set();
  for (const category of [...DEFAULT_CATEGORIES, ...(Array.isArray(stored) ? stored : [])]) {
    if (!category?.id || ids.has(category.id)) continue;
    result.push(category); ids.add(category.id);
  }
  return result;
}
function formatMinutes(mins) { const n = Math.round(mins); return `${Math.floor(n / 60)}h ${n % 60}m`; }
