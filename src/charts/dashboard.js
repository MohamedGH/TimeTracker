import { getValue, STORAGE_KEYS } from '../core/storage.js';
import { DEFAULT_CATEGORIES } from '../core/model.js';
import { formatCategoryPath } from '../core/category-tree.js';

let dayChart;
let hourChart;

export function destroyCharts() {
  dayChart?.destroy();
  hourChart?.destroy();
  dayChart = undefined;
  hourChart = undefined;
}

export function renderCharts({ dayCanvas, hourCanvas, entries }) {
  destroyCharts();
  if (!window.Chart || !dayCanvas || !hourCanvas) return;

  const byDay = new Map();
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const entry of entries) {
    byDay.set(entry.date, (byDay.get(entry.date) || 0) + entry.mins);
    const hour = Number(String(entry.start).slice(0, 2));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) byHour[hour] += entry.mins;
  }

  const dayLabels = [...byDay.keys()].sort();
  dayChart = new window.Chart(dayCanvas, {
    type: 'bar',
    data: { labels: dayLabels, datasets: [{ label: 'Minutes', data: dayLabels.map(d => byDay.get(d)) }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  hourChart = new window.Chart(hourCanvas, {
    type: 'line',
    data: { labels: byHour.map((_, i) => `${String(i).padStart(2, '0')}h`), datasets: [{ label: 'Minutes', data: byHour, tension: 0.25 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  renderCategoryBreakdown(hourCanvas, entries).catch(() => {});
}

async function renderCategoryBreakdown(anchorCanvas, entries) {
  const parent = anchorCanvas.parentElement;
  if (!parent) return;
  parent.querySelector('[data-category-breakdown]')?.remove();

  const stored = await getValue(STORAGE_KEYS.categories, []);
  const categories = mergeCategories(stored);
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const childrenByParent = new Map();
  for (const category of categories) {
    if (category.parentId == null) continue;
    if (!childrenByParent.has(category.parentId)) childrenByParent.set(category.parentId, []);
    childrenByParent.get(category.parentId).push(category);
  }

  const rootTotals = new Map();
  const directTotals = new Map();
  const total = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.mins) || 0), 0);

  for (const entry of entries) {
    const mins = Math.max(0, Number(entry.mins) || 0);
    if (!mins || !entry.categoryId) continue;
    directTotals.set(entry.categoryId, (directTotals.get(entry.categoryId) || 0) + mins);

    let current = categoryById.get(entry.categoryId);
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      rootTotals.set(current.id, (rootTotals.get(current.id) || 0) + mins);
      current = current.parentId ? categoryById.get(current.parentId) : null;
    }
  }

  const box = document.createElement('div');
  box.className = 'category-breakdown';
  box.dataset.categoryBreakdown = '1';
  box.appendChild(title('Répartition par catégorie / sous-catégorie'));
  box.appendChild(text('Pourcentage du temps total de la journée (24 h).'));

  const roots = categories.filter(category => category.parentId == null && rootTotals.has(category.id));
  roots.sort((a, b) => (rootTotals.get(b.id) || 0) - (rootTotals.get(a.id) || 0));

  if (!roots.length) {
    box.appendChild(text('Aucune donnée catégorisée sur cette période.'));
    parent.appendChild(box);
    return;
  }

  for (const root of roots) {
    appendBreakdownRow(box, root.label, rootTotals.get(root.id), total, false);
    appendChildren(box, root.id, childrenByParent, directTotals, rootTotals, categoryById, total, 1);
  }

  const uncategorized = entries.reduce((sum, entry) => sum + (!entry.categoryId ? Math.max(0, Number(entry.mins) || 0) : 0), 0);
  if (uncategorized) appendBreakdownRow(box, 'Sans catégorie', uncategorized, total, false);

  parent.appendChild(box);
}

function appendChildren(box, parentId, childrenByParent, directTotals, rootTotals, categoryById, total, depth) {
  const children = (childrenByParent.get(parentId) || [])
    .filter(category => rootTotals.has(category.id))
    .sort((a, b) => (rootTotals.get(b.id) || 0) - (rootTotals.get(a.id) || 0));

  for (const child of children) {
    const own = directTotals.get(child.id) || 0;
    appendBreakdownRow(box, formatCategoryPath([...categoryById.values()], child.id), own, total, true, depth);
    appendChildren(box, child.id, childrenByParent, directTotals, rootTotals, categoryById, total, depth + 1);
  }
}

function appendBreakdownRow(box, label, mins, total, child, depth = 0) {
  if (!mins) return;
  const row = document.createElement('div');
  row.className = 'entry-row';
  if (child) row.style.paddingLeft = `${16 + depth * 18}px`;
  const percent = total > 0 ? (mins / 1440) * 100 : 0;
  const trackedPercent = total > 0 ? (mins / total) * 100 : 0;
  row.append(
    text(label),
    text(`${formatMinutes(mins)} · ${percent.toFixed(1)} % du jour · ${trackedPercent.toFixed(1)} % du temps suivi`),
  );
  box.appendChild(row);
}

function mergeCategories(stored) {
  const result = [];
  const ids = new Set();
  for (const category of [...DEFAULT_CATEGORIES, ...(Array.isArray(stored) ? stored : [])]) {
    if (!category?.id || ids.has(category.id)) continue;
    result.push(category);
    ids.add(category.id);
  }
  return result;
}

function formatMinutes(mins) {
  const rounded = Math.round(mins);
  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

function title(value) {
  const node = document.createElement('h3');
  node.className = 'chart-title';
  node.textContent = value;
  return node;
}

function text(value) {
  const node = document.createElement('div');
  node.className = 'muted';
  node.textContent = value;
  return node;
}
