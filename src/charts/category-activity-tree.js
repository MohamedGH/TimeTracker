/**
 * Animated Collapsible Category-Activity Tree powered by D3.js.
 * Visualizes Category -> Subcategory -> Activity (leaves) -> Recent Sessions
 * with smooth enter/update/exit animations, pan/zoom, search filtering, and collapsible leaves.
 */

import * as d3 from 'd3';
import {
  TREE_NODE_TYPES,
  buildCategoryActivityTree,
  filterTreeByQuery,
  collectNodeIds,
  computeTreeMetrics,
} from '../core/category-activity-tree-model.js';

const NODE_DIMENSIONS = Object.freeze({
  [TREE_NODE_TYPES.ROOT]: { width: 196, height: 46, rx: 12 },
  [TREE_NODE_TYPES.CATEGORY]: { width: 222, height: 44, rx: 10 },
  [TREE_NODE_TYPES.ACTIVITY]: { width: 214, height: 42, rx: 10 },
  [TREE_NODE_TYPES.SESSION]: { width: 196, height: 30, rx: 8 },
});

const ROW_SPACING_X = 56;
const DEPTH_SPACING_Y = 276;

/**
 * Truncates text cleanly for SVG labels.
 * Pure function: (string, number) -> string
 */
export function truncateLabel(text, maxChars = 20) {
  const str = String(text || '').trim();
  if (str.length <= maxChars) return str;
  return `${str.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/**
 * Determines whether reduced motion is preferred.
 */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Renders an interactive, animated collapsible D3 tree inside `container`.
 */
export function renderCategoryActivityTree({
  container,
  categories = [],
  activities = [],
  entries = [],
  includeEmptyCategories = true,
  animationDuration = 360,
  onStartActivity = null,
  onSelectCategory = null,
  onAddCategory = null,
  onAddActivity = null,
} = {}) {
  if (!container) return null;

  container.replaceChildren();

  let currentData = { categories, activities, entries, includeEmptyCategories };
  let searchQuery = '';
  let initializedDefaultCollapse = false;
  const collapsedIds = new Set();
  const canCreate = typeof onAddCategory === 'function' || typeof onAddActivity === 'function';

  // Build wrapper structure
  const wrapper = document.createElement('div');
  wrapper.className = 'cat-tree-viz';

  // 1. Toolbar (search + collapse/expand + quick create + zoom)
  const toolbar = document.createElement('div');
  toolbar.className = 'cat-tree-toolbar';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'cat-tree-search-wrap';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'cat-tree-search';
  searchInput.placeholder = 'Filtrer catégories ou activités…';
  searchInput.setAttribute('aria-label', 'Filtrer catégories ou activités dans l’arbre');
  searchWrap.appendChild(searchInput);

  const controlsRow = document.createElement('div');
  controlsRow.className = 'cat-tree-controls';

  if (typeof onAddCategory === 'function') {
    const addCatBtn = makeControlBtn('+ Catégorie', 'add-category', 'Ajouter une catégorie depuis le graphique');
    addCatBtn.classList.add('cat-tree-btn--create');
    addCatBtn.onclick = () => onAddCategory(null);
    controlsRow.appendChild(addCatBtn);
  }

  if (typeof onAddActivity === 'function') {
    const addActBtn = makeControlBtn('+ Activité', 'add-activity', 'Ajouter une activité depuis le graphique');
    addActBtn.classList.add('cat-tree-btn--create');
    addActBtn.onclick = () => onAddActivity(null);
    controlsRow.appendChild(addActBtn);
  }

  const expandAllBtn = makeControlBtn('Tout déplier', 'expand-all', 'Déplier toutes les catégories et activités');
  const collapseLeavesBtn = makeControlBtn('Replier feuilles', 'collapse-leaves', 'Replier les feuilles d’activités');
  const collapseAllBtn = makeControlBtn('Tout replier', 'collapse-all', 'Replier toutes les branches');

  const zoomGroup = document.createElement('div');
  zoomGroup.className = 'cat-tree-zoom-group';
  const zoomOutBtn = makeControlBtn('−', 'zoom-out', 'Dézoomer');
  const zoomResetBtn = makeControlBtn('Centrer', 'zoom-reset', 'Recentrer l’arbre');
  const zoomInBtn = makeControlBtn('+', 'zoom-in', 'Zoomer');
  zoomGroup.append(zoomOutBtn, zoomResetBtn, zoomInBtn);

  controlsRow.append(expandAllBtn, collapseLeavesBtn, collapseAllBtn, zoomGroup);
  toolbar.append(searchWrap, controlsRow);

  // 2. Summary metadata bar (zero-pill unboxed typography)
  const summaryBar = document.createElement('div');
  summaryBar.className = 'cat-tree-summary';

  // 3. SVG Canvas Stage
  const stage = document.createElement('div');
  stage.className = 'cat-tree-stage';

  // Contextual creation popover anchored inside stage
  const nodePopover = document.createElement('div');
  nodePopover.className = 'cat-tree-node-popover';
  nodePopover.hidden = true;
  nodePopover.setAttribute('role', 'dialog');
  nodePopover.setAttribute('aria-label', 'Ajouter depuis ce nœud');

  function closePopover() {
    nodePopover.hidden = true;
    nodePopover.replaceChildren();
  }

  function openNodeCreatePopover(d) {
    if (!canCreate) return;
    const isRoot = d.data.type === TREE_NODE_TYPES.ROOT;
    const parentCategoryId = isRoot ? null : d.data.categoryId;

    // If only one callback is available, trigger it directly without extra click
    if (typeof onAddCategory === 'function' && typeof onAddActivity !== 'function') {
      onAddCategory(parentCategoryId);
      return;
    }
    if (typeof onAddActivity === 'function' && typeof onAddCategory !== 'function') {
      onAddActivity(parentCategoryId);
      return;
    }

    nodePopover.replaceChildren();
    const header = document.createElement('div');
    header.className = 'cat-tree-node-popover__head';
    const title = document.createElement('span');
    title.className = 'cat-tree-node-popover__title';
    title.textContent = isRoot ? 'Racine de l’arbre' : d.data.label;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cat-tree-node-popover__close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.onclick = closePopover;
    header.append(title, closeBtn);

    const actions = document.createElement('div');
    actions.className = 'cat-tree-node-popover__actions';

    if (typeof onAddCategory === 'function') {
      const catBtn = document.createElement('button');
      catBtn.type = 'button';
      catBtn.className = 'btn small cat-tree-popover-btn';
      catBtn.dataset.treePopoverAction = 'add-category';
      catBtn.textContent = isRoot ? '+ Catégorie racine' : '+ Sous-catégorie';
      catBtn.onclick = () => {
        closePopover();
        onAddCategory(parentCategoryId);
      };
      actions.appendChild(catBtn);
    }

    if (typeof onAddActivity === 'function') {
      const actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'btn small secondary cat-tree-popover-btn';
      actBtn.dataset.treePopoverAction = 'add-activity';
      actBtn.textContent = isRoot ? '+ Nouvelle activité' : `+ Activité dans « ${truncateLabel(d.data.label, 14)} »`;
      actBtn.onclick = () => {
        closePopover();
        onAddActivity(parentCategoryId);
      };
      actions.appendChild(actBtn);
    }

    nodePopover.append(header, actions);
    nodePopover.hidden = false;
  }

  const emptyState = document.createElement('div');
  emptyState.className = 'cat-tree-empty';
  emptyState.hidden = true;
  const emptyText = document.createElement('p');
  emptyText.textContent = 'Aucune catégorie ni activité ne correspond à votre recherche.';
  const resetFilterBtn = makeControlBtn('Réinitialiser le filtre', 'reset-filter');
  resetFilterBtn.onclick = () => {
    searchQuery = '';
    searchInput.value = '';
    updateTree();
  };
  emptyState.append(emptyText, resetFilterBtn);

  const svgSel = d3
    .select(stage)
    .append('svg')
    .attr('class', 'cat-tree-svg')
    .attr('role', 'tree')
    .attr('aria-label', 'Arbre des relations entre catégories et activités')
    .on('click', (event) => {
      if (event.target === svgSel.node()) closePopover();
    });

  const zoomLayer = svgSel.append('g').attr('class', 'cat-tree-zoom-layer');
  const linkGroup = zoomLayer.append('g').attr('class', 'cat-tree-links');
  const nodeGroup = zoomLayer.append('g').attr('class', 'cat-tree-nodes');

  stage.append(emptyState, nodePopover);

  // Legend row
  const legend = document.createElement('div');
  legend.className = 'cat-tree-legend';
  legend.innerHTML = `
    <span class="cat-tree-legend-item"><span class="legend-swatch legend-swatch--cat"></span>Catégorie / Sous-catégorie</span>
    <span class="cat-tree-legend-item" aria-hidden="true">·</span>
    <span class="cat-tree-legend-item"><span class="legend-swatch legend-swatch--act"></span>Activité (feuille)</span>
    <span class="cat-tree-legend-item" aria-hidden="true">·</span>
    <span class="cat-tree-legend-item">Cliquez sur un nœud pour replier ou déplier</span>
  `;

  wrapper.append(toolbar, summaryBar, stage, legend);
  container.appendChild(wrapper);

  // Setup Zoom behavior (explicit extent avoids SVGAnimatedLength.baseVal dependency in jsdom)
  let currentTransform = d3.zoomIdentity.translate(28, 180).scale(0.9);
  const zoomBehavior = d3
    .zoom()
    .extent(() => [[0, 0], [stage.clientWidth || 480, stage.clientHeight || 380]])
    .scaleExtent([0.35, 2.2])
    .on('zoom', (event) => {
      currentTransform = event.transform;
      zoomLayer.attr('transform', currentTransform.toString());
    });

  svgSel.call(zoomBehavior);

  // Track previous node positions for smooth animations
  const previousCoords = new Map();
  let lastRootTree = null;
  let lastRawTree = null;

  const getDuration = () => (prefersReducedMotion() ? 0 : animationDuration);

  function computeInitialCollapsed(rawTree) {
    if (initializedDefaultCollapse) return;
    initializedDefaultCollapse = true;
    // Collapse session sub-leaves under activities by default so Category -> Activity leaves are crystal clear
    const activityIds = collectNodeIds(rawTree, n => n.type === TREE_NODE_TYPES.ACTIVITY && n.children?.length > 0);
    activityIds.forEach(id => collapsedIds.add(id));
  }

  function buildVisibleHierarchy(rawTree) {
    const filtered = searchQuery ? filterTreeByQuery(rawTree, searchQuery) : rawTree;
    const isSearching = Boolean(searchQuery.trim());

    const rootHierarchy = d3.hierarchy(filtered, d => {
      if (!d.children || d.children.length === 0) return null;
      // When searching, auto-expand matching branches so results are immediately visible
      if (!isSearching && collapsedIds.has(d.id)) return null;
      return d.children;
    });

    // Attach total child count even when collapsed
    rootHierarchy.each(d => {
      d.totalRawChildren = Array.isArray(d.data.children) ? d.data.children.length : 0;
      d.isCollapsed = !isSearching && collapsedIds.has(d.data.id) && d.totalRawChildren > 0;
    });

    return rootHierarchy;
  }

  function updateSummary(rawTree) {
    const metrics = computeTreeMetrics(rawTree);
    summaryBar.replaceChildren();
    const parts = [
      `${metrics.categoriesCount} catégorie${metrics.categoriesCount > 1 ? 's' : ''}`,
      `${metrics.activitiesCount} activité${metrics.activitiesCount > 1 ? 's' : ''}`,
      rawTree.formattedDuration ? `Total : ${rawTree.formattedDuration}` : null,
    ].filter(Boolean);

    parts.forEach((text, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '·';
        summaryBar.appendChild(sep);
      }
      const span = document.createElement('span');
      span.textContent = text;
      summaryBar.appendChild(span);
    });
  }

  function fitViewport(rootNode, animate = false) {
    const stageWidth = stage.clientWidth || (typeof window !== 'undefined' ? Math.min(window.innerWidth - 56, 520) : 480);
    const stageHeight = stage.clientHeight || 380;

    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;

    rootNode.each(d => {
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
      if (d.y > maxY) maxY = d.y;
    });

    if (!Number.isFinite(minX)) {
      minX = -80;
      maxX = 80;
    }

    const treeSpanX = Math.max(120, maxX - minX + 90);
    const treeSpanY = Math.max(240, maxY + 240);

    const scaleX = (stageWidth - 28) / treeSpanY;
    const scaleY = (stageHeight - 28) / treeSpanX;
    const fittedScale = Math.max(0.46, Math.min(1.0, Math.min(scaleX, scaleY)));

    const midX = (minX + maxX) / 2;
    const tx = 20;
    const ty = stageHeight / 2 - midX * fittedScale;

    const targetTransform = d3.zoomIdentity.translate(tx, ty).scale(fittedScale);
    currentTransform = targetTransform;

    const dur = animate ? getDuration() : 0;
    if (dur > 0) {
      svgSel.transition().duration(dur).ease(d3.easeCubicOut).call(zoomBehavior.transform, targetTransform);
    } else {
      svgSel.call(zoomBehavior.transform, targetTransform);
    }
  }

  function updateTree(sourceNode = null, shouldRefit = false) {
    const rawTree = buildCategoryActivityTree(currentData);
    lastRawTree = rawTree;
    computeInitialCollapsed(rawTree);
    updateSummary(rawTree);

    const rootHierarchy = buildVisibleHierarchy(rawTree);
    const hasNodes = (rootHierarchy.children && rootHierarchy.children.length > 0);
    emptyState.hidden = hasNodes;
    svgSel.style('display', hasNodes ? 'block' : 'none');

    if (!hasNodes) return;

    const treeLayout = d3.tree().nodeSize([ROW_SPACING_X, DEPTH_SPACING_Y]);
    treeLayout(rootHierarchy);

    // Compute dynamic stage height within sensible bounds
    let minX = Infinity;
    let maxX = -Infinity;
    rootHierarchy.each(d => {
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
    });
    const desiredHeight = Math.max(340, Math.min(560, (maxX - minX) + 120));
    stage.style.height = `${desiredHeight}px`;

    if (shouldRefit || !lastRootTree) {
      fitViewport(rootHierarchy, false);
    }

    const dur = getDuration();
    const linkGenerator = d3
      .linkHorizontal()
      .x(d => d.y)
      .y(d => d.x);

    const originCoord = sourceNode
      ? { x: sourceNode.x, y: sourceNode.y }
      : { x: rootHierarchy.x, y: rootHierarchy.y };

    // Resolve old position helper
    const getStartPos = (d) => {
      const parentId = d.parent?.data?.id;
      if (sourceNode && parentId === sourceNode.data.id) {
        return { x: sourceNode.x0 ?? sourceNode.x, y: sourceNode.y0 ?? sourceNode.y };
      }
      if (previousCoords.has(d.data.id)) {
        return previousCoords.get(d.data.id);
      }
      if (d.parent && previousCoords.has(d.parent.data.id)) {
        return previousCoords.get(d.parent.data.id);
      }
      return originCoord;
    };

    const getEndPos = (d) => {
      if (sourceNode) return { x: sourceNode.x, y: sourceNode.y };
      if (d.parent && rootHierarchy.descendants().some(n => n.data.id === d.parent.data.id)) {
        const currentParent = rootHierarchy.descendants().find(n => n.data.id === d.parent.data.id);
        return { x: currentParent.x, y: currentParent.y };
      }
      return originCoord;
    };

    // ==================== LINKS ====================
    const links = rootHierarchy.links();
    const linkSel = linkGroup
      .selectAll('path.tree-link')
      .data(links, d => `${d.source.data.id}-->${d.target.data.id}`);

    const linkEnter = linkSel
      .enter()
      .append('path')
      .attr('class', 'tree-link')
      .attr('fill', 'none')
      .attr('stroke', d => d.target.data.color || '#948C7E')
      .attr('stroke-width', d => (d.target.data.type === TREE_NODE_TYPES.ACTIVITY ? 1.75 : 2.25))
      .attr('stroke-opacity', 0)
      .attr('d', d => {
        const start = getStartPos(d.target);
        const pWidth = NODE_DIMENSIONS[d.source.data.type]?.width || 180;
        const o = { x: start.x, y: start.y + pWidth / 2 };
        return linkGenerator({ source: o, target: o });
      });

    const linkMerge = linkEnter.merge(linkSel);
    const linkTargetD = (d) => {
      const srcWidth = NODE_DIMENSIONS[d.source.data.type]?.width || 180;
      return linkGenerator({
        source: { x: d.source.x, y: d.source.y + srcWidth },
        target: { x: d.target.x, y: d.target.y },
      });
    };

    if (dur > 0) {
      linkMerge
        .transition()
        .duration(dur)
        .ease(d3.easeCubicOut)
        .attr('stroke', d => d.target.data.color || '#948C7E')
        .attr('stroke-opacity', d => (d.target.data.type === TREE_NODE_TYPES.SESSION ? 0.32 : 0.48))
        .attr('d', linkTargetD);
    } else {
      linkMerge
        .attr('stroke', d => d.target.data.color || '#948C7E')
        .attr('stroke-opacity', d => (d.target.data.type === TREE_NODE_TYPES.SESSION ? 0.32 : 0.48))
        .attr('d', linkTargetD);
    }

    const linkExit = linkSel.exit().classed('is-exiting', true);
    if (dur > 0) {
      linkExit
        .transition()
        .duration(dur)
        .ease(d3.easeCubicOut)
        .attr('stroke-opacity', 0)
        .attr('d', d => {
          const end = getEndPos(d.target);
          const o = { x: end.x, y: end.y + 80 };
          return linkGenerator({ source: o, target: o });
        })
        .remove();
    } else {
      linkExit.remove();
    }

    // ==================== NODES ====================
    const nodes = rootHierarchy.descendants();
    const nodeSel = nodeGroup
      .selectAll('g.tree-node:not(.is-exiting)')
      .data(nodes, d => d.data.id);

    const nodeEnter = nodeSel
      .enter()
      .append('g')
      .attr('class', d => `tree-node tree-node--${d.data.type}`)
      .attr('data-node-id', d => d.data.id)
      .attr('data-node-type', d => d.data.type)
      .attr('role', 'treeitem')
      .attr('aria-expanded', d => (d.totalRawChildren > 0 ? String(!d.isCollapsed) : null))
      .attr('transform', d => {
        const start = getStartPos(d);
        return `translate(${start.y},${start.x}) scale(0.88)`;
      })
      .style('opacity', 0)
      .style('cursor', d => (d.totalRawChildren > 0 || d.data.type === TREE_NODE_TYPES.ACTIVITY ? 'pointer' : 'default'));

    // Build card visuals inside entering nodes
    nodeEnter.each(function renderNodeCard(d) {
      const g = d3.select(this);
      const dims = NODE_DIMENSIONS[d.data.type] || NODE_DIMENSIONS[TREE_NODE_TYPES.CATEGORY];
      const halfH = dims.height / 2;

      const title = g.append('title');
      title.text(buildNodeTooltip(d));

      // Main card background
      const rect = g
        .append('rect')
        .attr('class', 'tree-node-card')
        .attr('x', 0)
        .attr('y', -halfH)
        .attr('width', dims.width)
        .attr('height', dims.height)
        .attr('rx', dims.rx);

      if (d.data.type === TREE_NODE_TYPES.ROOT) {
        rect.attr('fill', '#232821').attr('stroke', '#B3833C').attr('stroke-width', 1.5);
      } else if (d.data.type === TREE_NODE_TYPES.CATEGORY) {
        rect
          .attr('fill', '#FFFFFF')
          .attr('stroke', d.data.color || '#948C7E')
          .attr('stroke-width', 1.5);

        g.append('circle')
          .attr('class', 'tree-node-dot')
          .attr('cx', 14)
          .attr('cy', -4)
          .attr('r', 5)
          .attr('fill', d.data.color || '#948C7E');
      } else if (d.data.type === TREE_NODE_TYPES.ACTIVITY) {
        rect
          .attr('fill', '#FCF9F2')
          .attr('stroke', d.data.color || '#948C7E')
          .attr('stroke-width', 1.25)
          .attr('stroke-dasharray', '4 2.5');

        g.append('circle')
          .attr('class', 'tree-node-dot')
          .attr('cx', 13)
          .attr('cy', -4)
          .attr('r', 4.5)
          .attr('fill', d.data.color || '#948C7E');
      } else {
        // SESSION sub-leaf
        rect
          .attr('fill', '#FFFFFF')
          .attr('stroke', '#DDD5C2')
          .attr('stroke-width', 1);
      }

      // Primary label
      const labelX = d.data.type === TREE_NODE_TYPES.ROOT ? 14 : d.data.type === TREE_NODE_TYPES.SESSION ? 12 : 26;
      const labelY = d.data.type === TREE_NODE_TYPES.SESSION ? 4 : -2;
      const maxChars = d.data.type === TREE_NODE_TYPES.ACTIVITY ? 18 : d.data.type === TREE_NODE_TYPES.SESSION ? 26 : 19;

      g.append('text')
        .attr('class', 'tree-node-label')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('font-size', d.data.type === TREE_NODE_TYPES.SESSION ? '11.5px' : '13px')
        .attr('font-weight', d.data.type === TREE_NODE_TYPES.CATEGORY || d.data.type === TREE_NODE_TYPES.ROOT ? '600' : '500')
        .attr('fill', d.data.type === TREE_NODE_TYPES.ROOT ? '#FBF8F1' : '#232821')
        .text(truncateLabel(d.data.label, maxChars));

      // Secondary metadata line
      if (d.data.type !== TREE_NODE_TYPES.SESSION) {
        g.append('text')
          .attr('class', 'tree-node-meta')
          .attr('x', labelX)
          .attr('y', 13)
          .attr('font-size', '11px')
          .attr('fill', d.data.type === TREE_NODE_TYPES.ROOT ? '#DFB674' : '#53594F')
          .text(buildNodeMetaText(d));
      }

      // Quick-add (+) button on Root and Category nodes
      const isCreatableNode = canCreate && (
        d.data.type === TREE_NODE_TYPES.ROOT
        || (d.data.type === TREE_NODE_TYPES.CATEGORY && d.data.categoryId !== null)
      );

      if (isCreatableNode) {
        const isRoot = d.data.type === TREE_NODE_TYPES.ROOT;
        const addGroup = g
          .append('g')
          .attr('class', 'tree-node-add-btn')
          .attr('data-action', 'node-add')
          .attr('transform', `translate(${dims.width - 26}, 0)`)
          .attr('role', 'button')
          .attr('aria-label', isRoot ? 'Ajouter une catégorie ou activité' : `Ajouter dans ${d.data.label}`)
          .style('cursor', 'pointer')
          .on('click', (event) => {
            event.stopPropagation();
            openNodeCreatePopover(d);
          });

        addGroup
          .append('circle')
          .attr('r', 12)
          .attr('fill', isRoot ? '#B3833C' : (d.data.color || '#232821'))
          .attr('fill-opacity', isRoot ? 0.28 : 0.12)
          .attr('stroke', isRoot ? '#DFB674' : (d.data.color || '#232821'))
          .attr('stroke-width', 1);

        addGroup
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', '14px')
          .attr('font-weight', '700')
          .attr('fill', isRoot ? '#FBF8F1' : '#232821')
          .text('+');
      }

      // Play button on Activity leaves
      if (d.data.type === TREE_NODE_TYPES.ACTIVITY && typeof onStartActivity === 'function') {
        const playGroup = g
          .append('g')
          .attr('class', 'tree-node-play-btn')
          .attr('data-action', 'start-activity')
          .attr('transform', `translate(${dims.width - 22}, 0)`)
          .attr('role', 'button')
          .attr('aria-label', `Démarrer ${d.data.label}`)
          .style('cursor', 'pointer')
          .on('click', (event) => {
            event.stopPropagation();
            onStartActivity(d.data.label, d.data.categoryId);
          });

        playGroup
          .append('circle')
          .attr('r', 12)
          .attr('fill', d.data.color || '#232821')
          .attr('fill-opacity', 0.14)
          .attr('stroke', d.data.color || '#232821')
          .attr('stroke-width', 1);

        playGroup
          .append('path')
          .attr('d', 'M -3 -4.5 L 5 0 L -3 4.5 Z')
          .attr('fill', '#232821');
      }

      // Collapse / Expand badge on nodes that have children (categories, root, and activities with sessions)
      if (d.totalRawChildren > 0) {
        const toggleGroup = g
          .append('g')
          .attr('class', 'tree-node-toggle')
          .attr('transform', `translate(${dims.width}, 0)`);

        toggleGroup
          .append('circle')
          .attr('class', 'tree-node-toggle-circle')
          .attr('r', 11);

        toggleGroup
          .append('text')
          .attr('class', 'tree-node-toggle-symbol')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', '11px')
          .attr('font-weight', '700');
      }
    });

    // Click handler for collapsing/expanding branches & leaves
    const nodeMerge = nodeEnter.merge(nodeSel);

    nodeMerge
      .attr('aria-expanded', d => (d.totalRawChildren > 0 ? String(!d.isCollapsed) : null))
      .classed('is-collapsed', d => d.isCollapsed)
      .on('click', (event, d) => {
        if (event.defaultPrevented) return;
        if (d.totalRawChildren > 0) {
          if (collapsedIds.has(d.data.id)) {
            collapsedIds.delete(d.data.id);
          } else {
            collapsedIds.add(d.data.id);
          }
          d.x0 = d.x;
          d.y0 = d.y;
          updateTree(d, false);
          return;
        }
        if (d.data.type === TREE_NODE_TYPES.CATEGORY && typeof onSelectCategory === 'function') {
          onSelectCategory(d.data.categoryId);
        }
      });

    // Update dynamic text & toggle indicators on all active nodes
    nodeMerge.each(function updateNodeVisuals(d) {
      const g = d3.select(this);
      if (d.data.type !== TREE_NODE_TYPES.SESSION) {
        g.select('.tree-node-meta').text(buildNodeMetaText(d));
      }
      g.select('title').text(buildNodeTooltip(d));

      if (d.totalRawChildren > 0) {
        const badgeColor = d.data.color || '#232821';
        g.select('.tree-node-toggle-circle')
          .attr('fill', d.isCollapsed ? badgeColor : '#FCF9F2')
          .attr('stroke', badgeColor)
          .attr('stroke-width', 1.5);

        g.select('.tree-node-toggle-symbol')
          .attr('fill', d.isCollapsed ? '#FFFFFF' : '#232821')
          .text(d.isCollapsed ? `+${d.totalRawChildren}` : '−');
      }
    });

    if (dur > 0) {
      nodeMerge
        .transition()
        .duration(dur)
        .ease(d3.easeCubicOut)
        .attr('transform', d => `translate(${d.y},${d.x}) scale(1)`)
        .style('opacity', 1);
    } else {
      nodeMerge
        .attr('transform', d => `translate(${d.y},${d.x}) scale(1)`)
        .style('opacity', 1);
    }

    // Exit animation
    const nodeExit = nodeSel.exit().classed('is-exiting', true);
    if (dur > 0) {
      nodeExit
        .transition()
        .duration(dur)
        .ease(d3.easeCubicOut)
        .attr('transform', d => {
          const end = getEndPos(d);
          return `translate(${end.y},${end.x}) scale(0.85)`;
        })
        .style('opacity', 0)
        .remove();
    } else {
      nodeExit.remove();
    }

    // Save coordinates for next transition
    previousCoords.clear();
    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
      previousCoords.set(d.data.id, { x: d.x, y: d.y });
    });
    lastRootTree = rootHierarchy;
  }

  // Wire toolbar events
  searchInput.addEventListener('input', (event) => {
    searchQuery = event.target.value;
    updateTree(null, true);
  });

  expandAllBtn.onclick = () => {
    collapsedIds.clear();
    updateTree(null, true);
  };

  collapseLeavesBtn.onclick = () => {
    if (!lastRawTree) return;
    collapsedIds.clear();
    // Collapse session leaves under activities AND collapse categories that contain activities
    const visit = (node) => {
      if (node.type === TREE_NODE_TYPES.ACTIVITY && node.children?.length > 0) {
        collapsedIds.add(node.id);
      }
      if (node.type === TREE_NODE_TYPES.CATEGORY) {
        const hasActivityChild = (node.children || []).some(c => c.type === TREE_NODE_TYPES.ACTIVITY);
        const hasSubcategoryChild = (node.children || []).some(c => c.type === TREE_NODE_TYPES.CATEGORY);
        if (hasActivityChild && !hasSubcategoryChild) {
          collapsedIds.add(node.id);
        } else if (hasActivityChild) {
          collapsedIds.add(node.id);
        }
      }
      for (const child of node.children || []) visit(child);
    };
    visit(lastRawTree);
    updateTree(null, true);
  };

  collapseAllBtn.onclick = () => {
    if (!lastRawTree) return;
    const branchIds = collectNodeIds(
      lastRawTree,
      n => n.type !== TREE_NODE_TYPES.ROOT && n.children?.length > 0
    );
    collapsedIds.clear();
    branchIds.forEach(id => collapsedIds.add(id));
    updateTree(null, true);
  };

  zoomInBtn.onclick = () => {
    const dur = getDuration();
    if (dur > 0) {
      svgSel.transition().duration(180).call(zoomBehavior.scaleBy, 1.25);
    } else {
      svgSel.call(zoomBehavior.scaleBy, 1.25);
    }
  };

  zoomOutBtn.onclick = () => {
    const dur = getDuration();
    if (dur > 0) {
      svgSel.transition().duration(180).call(zoomBehavior.scaleBy, 0.8);
    } else {
      svgSel.call(zoomBehavior.scaleBy, 0.8);
    }
  };

  zoomResetBtn.onclick = () => {
    if (lastRootTree) fitViewport(lastRootTree, true);
  };

  // Initial render
  updateTree(null, true);

  return {
    update(nextData = {}) {
      currentData = { ...currentData, ...nextData };
      updateTree(null, false);
    },
    expandAll() {
      expandAllBtn.click();
    },
    collapseLeaves() {
      collapseLeavesBtn.click();
    },
    collapseAll() {
      collapseAllBtn.click();
    },
    resetZoom() {
      zoomResetBtn.click();
    },
    destroy() {
      closePopover();
      svgSel.on('.zoom', null);
      container.replaceChildren();
    },
  };
}

function makeControlBtn(label, actionName, title = label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small secondary cat-tree-btn';
  btn.dataset.treeAction = actionName;
  btn.textContent = label;
  btn.title = title;
  return btn;
}

function buildNodeMetaText(d) {
  const data = d.data;
  if (data.type === TREE_NODE_TYPES.ROOT) {
    return `${data.formattedDuration} · ${data.activityCount} act.`;
  }
  if (data.type === TREE_NODE_TYPES.CATEGORY) {
    if (data.totalMins > 0) {
      return `${data.formattedDuration} · ${data.activityCount} act.`;
    }
    return data.activityCount > 0
      ? `${data.activityCount} activité${data.activityCount > 1 ? 's' : ''}`
      : 'Aucune activité';
  }
  if (data.type === TREE_NODE_TYPES.ACTIVITY) {
    if (data.sessionCount > 0) {
      return `${data.sessionCount}× · ${data.formattedDuration}`;
    }
    return 'Activité enregistrée';
  }
  return '';
}

function buildNodeTooltip(d) {
  const data = d.data;
  if (data.type === TREE_NODE_TYPES.ROOT) {
    return `${data.label} — ${data.formattedDuration} (${data.activityCount} activités)`;
  }
  if (data.type === TREE_NODE_TYPES.CATEGORY) {
    return `${data.label} — ${data.formattedDuration} · ${data.activityCount} activité(s)`;
  }
  if (data.type === TREE_NODE_TYPES.ACTIVITY) {
    return `${data.label} — ${data.sessionCount} session(s), ${data.formattedDuration}`;
  }
  return data.label;
}
