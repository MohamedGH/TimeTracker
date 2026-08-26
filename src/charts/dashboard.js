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
    if (!categoryByDay.has(entry.date)) categoryByDay.set(entry.date, new Map());
    if (entry.categoryId) {
      const m = categoryByDay.get(entry.date);
      m.set(entry.categoryId, (m.get(entry.categoryId) || 0) + mins);
    }
  }
  const dayLabels = [...byDay.keys()].sort();
  const categories = mergeCategories(await getValue(STORAGE_KEYS.categories, []));
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const roots = categories.filter(c => !c.parentId);
  dayChart = new window.Chart(dayCanvas, {
    type: 'bar',
    data: { labels: dayLabels, datasets: roots.map(category => ({ label: category.label, data: dayLabels.map(day => categoryByDay.get(day)?.get(category.id) || 0) })) },
    options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Minutes' } } }, plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMinutes(ctx.raw)} · ${((ctx.raw / 1440) * 100).toFixed(1)} % du jour` } } } },
  });
  hourChart = new window.Chart(hourCanvas, {
    type: 'line',
    data: { labels: byHour.map((_, i) => `${String(i).padStart(2, '0')}h`), datasets: [{ label: 'Temps suivi', data: byHour, tension: 0.25, fill: true }] },
    options: { responsive: true, scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } }, plugins: { tooltip: { callbacks: { label: ctx => `${formatMinutes(ctx.raw)} · ${((ctx.raw / 1440) * 100).toFixed(1)} % du jour` } } } },
  });
  if (categoryCanvas) renderCategoryChart(categoryCanvas, entries, categories, categoryMap);
}

function renderCategoryChart(canvas, entries, categories, categoryById) {
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
  categoryChart = new window.Chart(canvas, { type: 'doughnut', data: { labels: rows.map(([id]) => formatCategoryPath(categories, id)), datasets: [{ data: rows.map(([, mins]) => mins) }] }, options: { responsive: true, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatMinutes(ctx.raw)} · ${((ctx.raw / 1440) * 100).toFixed(1)} % du jour` } } } } });
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
