import { getValue, STORAGE_KEYS } from '../core/storage.js';
import { DEFAULT_CATEGORIES } from '../core/model.js';

export async function renderCategoryHierarchy(container, entries = []) {
  container.replaceChildren();
  const stored = await getValue(STORAGE_KEYS.categories, []);
  const categories = mergeCategories(stored);
  const activities = await getValue(STORAGE_KEYS.activities, []);
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const children = new Map();
  for (const c of categories) {
    const parent = c.parentId || '__root__';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(c);
  }
  const activityByCategory = new Map();
  for (const a of Array.isArray(activities) ? activities : []) {
    const id = a.categoryId ?? a.cat;
    if (!id) continue;
    if (!activityByCategory.has(id)) activityByCategory.set(id, []);
    activityByCategory.get(id).push(a);
  }
  const totals = new Map();
  for (const e of entries) {
    const mins = Math.max(0, Number(e.mins) || 0);
    let c = categoryMap.get(e.categoryId);
    const visited = new Set();
    while (c && !visited.has(c.id)) {
      visited.add(c.id);
      totals.set(c.id, (totals.get(c.id) || 0) + mins);
      c = c.parentId ? categoryMap.get(c.parentId) : null;
    }
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const nodes = [], edges = [];
  let y = 30, maxDepth = 0;
  const row = 54, col = 270;
  function walk(parent, depth, parentId = null) {
    for (const c of children.get(parent) || []) {
      const id = `category:${c.id}`;
      nodes.push({ id, depth, y, type: 'category', label: c.label, color: c.color || '#999' });
      if (parentId) edges.push([parentId, id]);
      y += row; maxDepth = Math.max(maxDepth, depth);
      walk(c.id, depth + 1, id);
      for (const a of activityByCategory.get(c.id) || []) {
        const aid = `activity:${a.id}`;
        nodes.push({ id: aid, depth: depth + 1, y, type: 'activity', label: a.label || a.name || a.activity || 'Activité' });
        edges.push([id, aid]); y += row; maxDepth = Math.max(maxDepth, depth + 1);
      }
    }
  }
  walk('__root__', 0);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'overflow:auto;width:100%;border:1px solid var(--border,#ddd);border-radius:10px;padding:10px;box-sizing:border-box;';
  const title = document.createElement('div');
  title.textContent = 'Catégories → sous-catégories → activités';
  title.style.cssText = 'font-weight:600;margin-bottom:8px;';
  wrap.appendChild(title);
  const svg = document.createElementNS(svgNS, 'svg');
  const width = Math.max(900, (maxDepth + 1) * col + 40);
  const height = Math.max(180, y + 20);
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  wrap.appendChild(svg); container.appendChild(wrap);

  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const [fromId, toId] of edges) {
    const a = byId.get(fromId), b = byId.get(toId);
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M ${a.depth * col + 210} ${a.y + 16} C ${a.depth * col + 240} ${a.y + 16}, ${b.depth * col - 30} ${b.y + 16}, ${b.depth * col + 10} ${b.y + 16}`);
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('opacity', '.28');
    svg.appendChild(path);
  }
  for (const n of nodes) {
    const g = document.createElementNS(svgNS, 'g');
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', n.depth * col); rect.setAttribute('y', n.y); rect.setAttribute('width', 210); rect.setAttribute('height', 32); rect.setAttribute('rx', 7);
    rect.setAttribute('fill', n.type === 'category' ? n.color : 'none');
    rect.setAttribute('stroke', n.type === 'category' ? n.color : 'currentColor');
    if (n.type === 'activity') rect.setAttribute('stroke-dasharray', '4 3');
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', n.depth * col + 10); text.setAttribute('y', n.y + 21); text.setAttribute('font-size', '13');
    text.setAttribute('fill', n.type === 'category' ? '#fff' : 'currentColor');
    text.textContent = n.type === 'category' && totals.get(n.id.slice(9)) ? `${n.label} · ${formatMinutes(totals.get(n.id.slice(9)))}` : n.label;
    g.append(rect, text); svg.appendChild(g);
  }
}

function mergeCategories(stored) {
  const result = [], ids = new Set();
  for (const c of [...DEFAULT_CATEGORIES, ...(Array.isArray(stored) ? stored : [])]) {
    if (!c?.id || ids.has(c.id)) continue;
    result.push(c); ids.add(c.id);
  }
  return result;
}
function formatMinutes(mins) { const n = Math.round(mins); return `${Math.floor(n / 60)}h ${n % 60}m`; }
