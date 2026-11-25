import * as d3 from 'd3';
import { formatDuration } from '../core/statistics.js';

const FALLBACK_COLORS = [
  '#3F7068',
  '#8C6D3F',
  '#4A5A75',
  '#5C7A5E',
  '#9E5A47',
  '#6E6378',
  '#B08B4F',
  '#5B7D87',
];

function pickColor(item, idx) {
  return item?.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

function getContrastTextColor(hex) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return '#1F241F';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.56 ? '#FFFFFF' : '#1F241F';
}

function truncateText(text, maxLen = 18) {
  const s = String(text || '');
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

function createTooltip(host) {
  const tip = document.createElement('div');
  tip.className = 'custom-chart-tooltip';
  tip.hidden = true;
  host.appendChild(tip);

  return {
    show(htmlText, event) {
      tip.textContent = htmlText;
      tip.hidden = false;
      if (event && host.getBoundingClientRect) {
        const rect = host.getBoundingClientRect();
        const x = Math.max(8, Math.min(rect.width - 140, (event.clientX || 0) - rect.left + 10));
        const y = Math.max(8, (event.clientY || 0) - rect.top - 32);
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
      }
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function formatAxisTick(val, metric) {
  if (metric === 'count') return String(Math.round(val));
  if (val >= 60) {
    const h = Math.round((val / 60) * 10) / 10;
    return `${h}h`;
  }
  return `${Math.round(val)}m`;
}

function renderEmpty(container, message = 'Aucune donnée pour cette période ou ce filtre.') {
  const box = document.createElement('div');
  box.className = 'custom-chart-empty';
  box.textContent = message;
  container.appendChild(box);
}

function createSvg(container, width, height, chartType) {
  const svg = d3.select(container)
    .append('svg')
    .attr('class', `custom-chart-svg custom-chart-svg--${chartType}`)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img');
  return svg;
}

function renderVerticalBars(container, dataset, tooltip) {
  const items = dataset.series;
  const width = 520;
  const height = 240;
  const margin = { top: 16, right: 16, bottom: 38, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = createSvg(container, width, height, 'bar');
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand()
    .domain(items.map(d => d.label))
    .range([0, innerW])
    .padding(items.length > 14 ? 0.18 : 0.28);

  const maxVal = Math.max(1, d3.max(items, d => d.value) || 1);
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).nice().range([innerH, 0]);

  const yTicks = y.ticks(4);
  g.selectAll('.chart-grid-line')
    .data(yTicks)
    .join('line')
    .attr('class', 'chart-grid-line')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d));

  g.selectAll('.chart-y-label')
    .data(yTicks)
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', -8)
    .attr('y', d => y(d) + 3)
    .attr('text-anchor', 'end')
    .text(d => formatAxisTick(d, dataset.metric));

  g.selectAll('rect.chart-bar')
    .data(items)
    .join('rect')
    .attr('class', 'chart-bar')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', d => Math.max(1, innerH - y(d.value)))
    .attr('rx', 4)
    .attr('fill', (d, i) => pickColor(d, i))
    .on('mouseenter', (event, d) => {
      tooltip.show(`${d.fullLabel || d.label} : ${d.formattedValue} (${d.shareFormatted})`, event);
    })
    .on('mouseleave', () => tooltip.hide());

  const step = items.length > 12 ? Math.ceil(items.length / 8) : 1;
  g.selectAll('.chart-x-label')
    .data(items.filter((_, idx) => idx % step === 0))
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', d => (x(d.label) || 0) + x.bandwidth() / 2)
    .attr('y', innerH + 18)
    .attr('text-anchor', 'middle')
    .text(d => truncateText(d.label, 10));
}

function renderStackedBars(container, dataset, tooltip) {
  const rows = dataset.rows;
  const stacks = dataset.stacks;
  if (!Array.isArray(rows) || !Array.isArray(stacks) || !stacks.length) {
    renderVerticalBars(container, dataset, tooltip);
    return;
  }

  const width = 520;
  const height = 240;
  const margin = { top: 16, right: 16, bottom: 36, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = createSvg(container, width, height, 'stackedBar');
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const stackGen = d3.stack()
    .keys(stacks.map(s => s.id))
    .value((row, key) => row.valuesByStack?.[key] || 0);
  const layers = stackGen(rows);
  const stackMeta = new Map(stacks.map((s, idx) => [s.id, { ...s, color: s.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length] }]));

  const x = d3.scaleBand()
    .domain(rows.map(r => r.label))
    .range([0, innerW])
    .padding(rows.length > 14 ? 0.18 : 0.28);

  const maxTotal = Math.max(1, d3.max(rows, r => r.total) || 1);
  const y = d3.scaleLinear().domain([0, maxTotal * 1.1]).nice().range([innerH, 0]);

  const yTicks = y.ticks(4);
  g.selectAll('.chart-grid-line')
    .data(yTicks)
    .join('line')
    .attr('class', 'chart-grid-line')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d));

  g.selectAll('.chart-y-label')
    .data(yTicks)
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', -8)
    .attr('y', d => y(d) + 3)
    .attr('text-anchor', 'end')
    .text(d => formatAxisTick(d, dataset.metric));

  for (const layer of layers) {
    const meta = stackMeta.get(layer.key);
    const safeKey = String(layer.key).replace(/[^a-zA-Z0-9_-]/g, '_');
    g.selectAll(`.chart-bar-stack-${safeKey}`)
      .data(layer)
      .join('rect')
      .attr('class', `chart-bar chart-bar-stack-${safeKey}`)
      .attr('x', d => x(d.data.label))
      .attr('y', d => y(d[1]))
      .attr('width', x.bandwidth())
      .attr('height', d => Math.max(0, y(d[0]) - y(d[1])))
      .attr('rx', 2)
      .attr('fill', meta?.color || '#3F7068')
      .on('mouseenter', (event, d) => {
        const val = d[1] - d[0];
        const formatted = dataset.metric === 'count' ? `${val} session${val > 1 ? 's' : ''}` : formatDuration(val);
        tooltip.show(`${d.data.date} · ${meta?.label || ''} : ${formatted}`, event);
      })
      .on('mouseleave', () => tooltip.hide());
  }

  const step = rows.length > 12 ? Math.ceil(rows.length / 8) : 1;
  g.selectAll('.chart-x-label')
    .data(rows.filter((_, idx) => idx % step === 0))
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', d => (x(d.label) || 0) + x.bandwidth() / 2)
    .attr('y', innerH + 18)
    .attr('text-anchor', 'middle')
    .text(d => d.label);

  // Compact legend row below chart
  const legend = document.createElement('div');
  legend.className = 'custom-chart-inline-legend';
  for (const stack of stacks.slice(0, 8)) {
    const item = document.createElement('span');
    item.className = 'custom-chart-inline-legend-item';
    const dot = document.createElement('span');
    dot.className = 'custom-chart-legend-dot';
    dot.style.background = stack.color || '#3F7068';
    const label = document.createElement('span');
    label.textContent = stack.label;
    item.append(dot, label);
    legend.appendChild(item);
  }
  container.appendChild(legend);
}

function renderHorizontalBars(container, dataset) {
  const items = dataset.series.slice(0, 10);
  const maxVal = Math.max(1, d3.max(items, d => d.value) || 1);

  const list = document.createElement('div');
  list.className = 'custom-hbar-list';
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'custom-hbar-row';

    const header = document.createElement('div');
    header.className = 'custom-hbar-header';

    const left = document.createElement('div');
    left.className = 'custom-hbar-left';
    const dot = document.createElement('span');
    dot.className = 'custom-chart-legend-dot';
    dot.style.background = pickColor(item, idx);
    const name = document.createElement('span');
    name.className = 'custom-hbar-name';
    name.textContent = item.label;
    left.append(dot, name);
    if (item.subLabel) {
      const sub = document.createElement('span');
      sub.className = 'custom-hbar-sub';
      sub.textContent = `· ${item.subLabel}`;
      left.appendChild(sub);
    }

    const right = document.createElement('div');
    right.className = 'custom-hbar-right';
    const valSpan = document.createElement('span');
    valSpan.className = 'custom-hbar-val';
    valSpan.textContent = item.formattedValue;
    const pctSpan = document.createElement('span');
    pctSpan.className = 'custom-hbar-pct';
    pctSpan.textContent = item.shareFormatted;
    right.append(valSpan, pctSpan);

    header.append(left, right);

    const track = document.createElement('div');
    track.className = 'custom-hbar-track';
    const fill = document.createElement('div');
    fill.className = 'custom-hbar-fill';
    fill.style.width = `${Math.max(2, Math.round((item.value / maxVal) * 1000) / 10)}%`;
    fill.style.background = pickColor(item, idx);
    track.appendChild(fill);

    row.append(header, track);
    list.appendChild(row);
  });
  container.appendChild(list);
}

function renderLineOrArea(container, dataset, chartType, tooltip) {
  const items = dataset.series;
  const width = 520;
  const height = 240;
  const margin = { top: 16, right: 16, bottom: 38, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = createSvg(container, width, height, chartType);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scalePoint()
    .domain(items.map(d => d.label))
    .range([0, innerW])
    .padding(0.4);

  const maxVal = Math.max(1, d3.max(items, d => d.value) || 1);
  const y = d3.scaleLinear().domain([0, maxVal * 1.12]).nice().range([innerH, 0]);

  const yTicks = y.ticks(4);
  g.selectAll('.chart-grid-line')
    .data(yTicks)
    .join('line')
    .attr('class', 'chart-grid-line')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d));

  g.selectAll('.chart-y-label')
    .data(yTicks)
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', -8)
    .attr('y', d => y(d) + 3)
    .attr('text-anchor', 'end')
    .text(d => formatAxisTick(d, dataset.metric));

  const strokeColor = '#3F7068';
  if (chartType === 'area') {
    const areaGen = d3.area()
      .x(d => x(d.label))
      .y0(innerH)
      .y1(d => y(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(items)
      .attr('class', 'chart-area-fill')
      .attr('d', areaGen)
      .attr('fill', strokeColor)
      .attr('fill-opacity', 0.16);
  }

  const lineGen = d3.line()
    .x(d => x(d.label))
    .y(d => y(d.value))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(items)
    .attr('class', 'chart-line-path')
    .attr('fill', 'none')
    .attr('stroke', strokeColor)
    .attr('stroke-width', 2.25)
    .attr('d', lineGen);

  g.selectAll('circle.chart-point')
    .data(items)
    .join('circle')
    .attr('class', 'chart-point')
    .attr('cx', d => x(d.label))
    .attr('cy', d => y(d.value))
    .attr('r', items.length > 16 ? 3 : 4)
    .attr('fill', '#FFFFFF')
    .attr('stroke', strokeColor)
    .attr('stroke-width', 2)
    .on('mouseenter', (event, d) => {
      tooltip.show(`${d.fullLabel || d.label} : ${d.formattedValue}`, event);
    })
    .on('mouseleave', () => tooltip.hide());

  const step = items.length > 12 ? Math.ceil(items.length / 8) : 1;
  g.selectAll('.chart-x-label')
    .data(items.filter((_, idx) => idx % step === 0))
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', d => x(d.label))
    .attr('y', innerH + 18)
    .attr('text-anchor', 'middle')
    .text(d => truncateText(d.label, 10));
}

function renderDonut(container, dataset, tooltip) {
  const items = dataset.series.filter(d => d.value > 0).slice(0, 8);
  if (!items.length) {
    renderEmpty(container);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'custom-donut-layout';
  container.appendChild(wrap);

  const size = 210;
  const radius = size / 2 - 8;
  const svg = createSvg(wrap, size, size, 'donut');
  const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);

  const pie = d3.pie().value(d => d.value).sort(null);
  const arc = d3.arc().innerRadius(radius * 0.62).outerRadius(radius).cornerRadius(3).padAngle(0.02);

  g.selectAll('path.chart-donut-arc')
    .data(pie(items))
    .join('path')
    .attr('class', 'chart-donut-arc')
    .attr('d', arc)
    .attr('fill', (d, i) => pickColor(d.data, i))
    .on('mouseenter', (event, d) => {
      tooltip.show(`${d.data.label} : ${d.data.formattedValue} (${d.data.shareFormatted})`, event);
    })
    .on('mouseleave', () => tooltip.hide());

  g.append('text')
    .attr('class', 'chart-donut-total')
    .attr('text-anchor', 'middle')
    .attr('dy', '-0.1em')
    .text(dataset.formattedTotal);

  g.append('text')
    .attr('class', 'chart-donut-sub')
    .attr('text-anchor', 'middle')
    .attr('dy', '1.3em')
    .text(dataset.metric === 'count' ? 'Total sessions' : dataset.metric === 'avg' ? 'Moyenne' : 'Temps total');

  const legend = document.createElement('div');
  legend.className = 'custom-donut-legend';
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'custom-donut-legend-row';
    const left = document.createElement('span');
    left.className = 'custom-donut-legend-left';
    const dot = document.createElement('span');
    dot.className = 'custom-chart-legend-dot';
    dot.style.background = pickColor(item, idx);
    const label = document.createElement('span');
    label.className = 'custom-donut-legend-label';
    label.textContent = item.label;
    left.append(dot, label);

    const right = document.createElement('span');
    right.className = 'custom-donut-legend-val';
    right.textContent = `${item.formattedValue} · ${item.shareFormatted}`;

    row.append(left, right);
    legend.appendChild(row);
  });
  wrap.appendChild(legend);
}

function renderRadar(container, dataset, tooltip) {
  let items = dataset.series;
  if (items.length > 12) {
    // Group 24h into 12 2-hour spokes for crisp spider legibility
    const grouped = [];
    for (let i = 0; i < items.length; i += 2) {
      const a = items[i];
      const b = items[i + 1];
      const mins = (a?.minutes || 0) + (b?.minutes || 0);
      const count = (a?.count || 0) + (b?.count || 0);
      const val = (a?.value || 0) + (b?.value || 0);
      grouped.push({
        label: a.label,
        value: val,
        formattedValue: dataset.metric === 'count' ? `${count} session${count > 1 ? 's' : ''}` : formatDuration(mins),
      });
    }
    items = grouped;
  }
  if (items.length < 3) {
    renderHorizontalBars(container, dataset);
    return;
  }

  const size = 270;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 88;
  const levels = 4;
  const maxVal = Math.max(1, d3.max(items, d => d.value) || 1);

  const svg = createSvg(container, size, size, 'radar');
  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
  const angleStep = (Math.PI * 2) / items.length;

  for (let lvl = 1; lvl <= levels; lvl += 1) {
    const r = (radius * lvl) / levels;
    const ringPts = items.map((_, i) => {
      const angle = i * angleStep - Math.PI / 2;
      return `${Math.cos(angle) * r},${Math.sin(angle) * r}`;
    }).join(' ');
    g.append('polygon')
      .attr('class', 'chart-radar-ring')
      .attr('points', ringPts)
      .attr('fill', 'none');
  }

  items.forEach((item, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const x2 = Math.cos(angle) * radius;
    const y2 = Math.sin(angle) * radius;
    g.append('line')
      .attr('class', 'chart-radar-spoke')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', x2)
      .attr('y2', y2);

    const lx = Math.cos(angle) * (radius + 18);
    const ly = Math.sin(angle) * (radius + 18);
    g.append('text')
      .attr('class', 'chart-axis-text')
      .attr('x', lx)
      .attr('y', ly + 3)
      .attr('text-anchor', Math.abs(lx) < 6 ? 'middle' : lx > 0 ? 'start' : 'end')
      .text(truncateText(item.label, 11));
  });

  const coords = items.map((item, i) => {
    const r = (item.value / maxVal) * radius;
    const angle = i * angleStep - Math.PI / 2;
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      item,
    };
  });

  g.append('polygon')
    .attr('class', 'chart-radar-area')
    .attr('points', coords.map(c => `${c.x},${c.y}`).join(' '))
    .attr('fill', '#3F7068')
    .attr('fill-opacity', 0.22)
    .attr('stroke', '#3F7068')
    .attr('stroke-width', 2);

  g.selectAll('circle.chart-point')
    .data(coords)
    .join('circle')
    .attr('class', 'chart-point')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', 4)
    .attr('fill', '#FFFFFF')
    .attr('stroke', '#3F7068')
    .attr('stroke-width', 2)
    .on('mouseenter', (event, d) => {
      tooltip.show(`${d.item.label} : ${d.item.formattedValue}`, event);
    })
    .on('mouseleave', () => tooltip.hide());
}

function renderHeatmap(container, dataset, tooltip) {
  const { rowLabels = [], colLabels = [], cells = [], maxValue = 0 } = dataset;
  if (!cells.length) {
    renderEmpty(container);
    return;
  }

  const width = 520;
  const height = 248;
  const margin = { top: 28, right: 12, bottom: 12, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = createSvg(container, width, height, 'heatmap');
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(colLabels).range([0, innerW]).padding(0.08);
  const y = d3.scaleBand().domain(rowLabels).range([0, innerH]).padding(0.1);
  const colorScale = d3.scaleLinear()
    .domain([0, Math.max(1, maxValue)])
    .range(['#F1EDE3', '#2F5C4D']);

  g.selectAll('.chart-heatmap-col')
    .data(colLabels)
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', d => (x(d) || 0) + x.bandwidth() / 2)
    .attr('y', -10)
    .attr('text-anchor', 'middle')
    .text(d => d);

  g.selectAll('.chart-heatmap-row')
    .data(rowLabels)
    .join('text')
    .attr('class', 'chart-axis-text')
    .attr('x', -8)
    .attr('y', d => (y(d) || 0) + y.bandwidth() / 2 + 4)
    .attr('text-anchor', 'end')
    .text(d => d);

  g.selectAll('rect.chart-heatmap-cell')
    .data(cells)
    .join('rect')
    .attr('class', 'chart-heatmap-cell')
    .attr('x', d => x(d.colLabel))
    .attr('y', d => y(d.rowLabel))
    .attr('width', x.bandwidth())
    .attr('height', y.bandwidth())
    .attr('rx', 4)
    .attr('fill', d => (d.value > 0 ? colorScale(d.value) : '#F5F2EA'))
    .on('mouseenter', (event, d) => {
      tooltip.show(`${d.rowLabel} · ${d.colLabel} : ${d.formattedValue} (${d.count} session${d.count > 1 ? 's' : ''})`, event);
    })
    .on('mouseleave', () => tooltip.hide());

  g.selectAll('text.chart-heatmap-val')
    .data(cells.filter(d => d.value > 0))
    .join('text')
    .attr('class', 'chart-heatmap-val')
    .attr('x', d => (x(d.colLabel) || 0) + x.bandwidth() / 2)
    .attr('y', d => (y(d.rowLabel) || 0) + y.bandwidth() / 2 + 4)
    .attr('text-anchor', 'middle')
    .attr('fill', d => (maxValue > 0 && d.value / maxValue > 0.45 ? '#FFFFFF' : '#1F241F'))
    .text(d => formatAxisTick(d.value, dataset.metric));
}

function renderTreemap(container, dataset, tooltip) {
  const items = dataset.series.filter(d => d.value > 0).slice(0, 12);
  if (!items.length) {
    renderEmpty(container);
    return;
  }

  const width = 520;
  const height = 240;
  const root = d3.hierarchy({
    children: items.map((item, idx) => ({
      ...item,
      color: pickColor(item, idx),
    })),
  }).sum(d => d.value || 0);

  d3.treemap().size([width, height]).padding(4).round(true)(root);

  const svg = createSvg(container, width, height, 'treemap');
  const leaves = root.leaves();

  const cell = svg.selectAll('g.chart-treemap-node')
    .data(leaves)
    .join('g')
    .attr('class', 'chart-treemap-node')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  cell.append('rect')
    .attr('width', d => Math.max(1, d.x1 - d.x0))
    .attr('height', d => Math.max(1, d.y1 - d.y0))
    .attr('rx', 6)
    .attr('fill', d => d.data.color)
    .on('mouseenter', (event, d) => {
      tooltip.show(`${d.data.label} : ${d.data.formattedValue} (${d.data.shareFormatted})`, event);
    })
    .on('mouseleave', () => tooltip.hide());

  cell.each(function appendLabel(d) {
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    if (w < 54 || h < 34) return;
    const textColor = getContrastTextColor(d.data.color);
    const nodeSel = d3.select(this);
    nodeSel.append('text')
      .attr('class', 'chart-treemap-label')
      .attr('x', 8)
      .attr('y', 19)
      .attr('fill', textColor)
      .text(truncateText(d.data.label, Math.max(6, Math.floor(w / 8))));
    if (h >= 50) {
      nodeSel.append('text')
        .attr('class', 'chart-treemap-value')
        .attr('x', 8)
        .attr('y', 36)
        .attr('fill', textColor)
        .text(`${d.data.formattedValue} · ${d.data.shareFormatted}`);
    }
  });
}

function renderDataTable(container, dataset) {
  const items = dataset.series.filter(d => d.value > 0 || d.count > 0);
  if (!items.length) {
    renderEmpty(container);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'custom-chart-table-wrap';
  const table = document.createElement('table');
  table.className = 'custom-chart-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const [idx, label] of ['Élément', 'Durée', 'Sessions', 'Moyenne', 'Part'].entries()) {
    const th = document.createElement('th');
    th.textContent = label;
    if (idx > 0) th.className = 'is-num';
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  items.slice(0, 14).forEach((item, idx) => {
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    const dot = document.createElement('span');
    dot.className = 'custom-chart-legend-dot';
    dot.style.background = pickColor(item, idx);
    const txt = document.createElement('span');
    txt.textContent = item.fullLabel || item.label;
    tdLabel.append(dot, txt);

    const tdMins = document.createElement('td');
    tdMins.className = 'is-num';
    tdMins.textContent = item.formattedMinutes;

    const tdCount = document.createElement('td');
    tdCount.className = 'is-num';
    tdCount.textContent = String(item.count);

    const tdAvg = document.createElement('td');
    tdAvg.className = 'is-num';
    tdAvg.textContent = item.formattedAvg;

    const tdShare = document.createElement('td');
    tdShare.className = 'is-num';
    tdShare.textContent = item.shareFormatted;

    tr.append(tdLabel, tdMins, tdCount, tdAvg, tdShare);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

/**
 * Renders any customizable dashboard chart widget into `container`.
 */
export function renderCustomChart(container, dataset, chartType = 'bar') {
  if (!container) return;
  container.replaceChildren();
  container.classList.add('custom-chart-host');

  if (!dataset || dataset.empty) {
    renderEmpty(container);
    return;
  }

  const tooltip = createTooltip(container);

  switch (chartType) {
    case 'stackedBar':
      renderStackedBars(container, dataset, tooltip);
      break;
    case 'horizontalBar':
      renderHorizontalBars(container, dataset);
      break;
    case 'line':
    case 'area':
      renderLineOrArea(container, dataset, chartType, tooltip);
      break;
    case 'donut':
      renderDonut(container, dataset, tooltip);
      break;
    case 'radar':
      renderRadar(container, dataset, tooltip);
      break;
    case 'heatmap':
      renderHeatmap(container, dataset, tooltip);
      break;
    case 'treemap':
      renderTreemap(container, dataset, tooltip);
      break;
    case 'table':
      renderDataTable(container, dataset);
      break;
    case 'bar':
    default:
      renderVerticalBars(container, dataset, tooltip);
      break;
  }
}
