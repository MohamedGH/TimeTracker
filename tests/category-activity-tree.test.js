import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as d3 from 'd3';
import { renderCategoryActivityTree } from '../src/charts/category-activity-tree.js';

describe('category-activity-tree (D3 animated collapsible tree)', () => {
  const categories = [
    { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
    { id: 'dev', label: 'Développement', color: '#2980B9', parentId: 'travail', builtin: false },
    { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null, builtin: true },
  ];

  const activities = [
    { id: 'act-1', label: 'Code Frontend', categoryId: 'dev' },
    { id: 'act-2', label: 'Course à pied', categoryId: 'sport' },
  ];

  const entries = [
    { id: 'e-1', activity: 'Code Frontend', categoryId: 'dev', date: '2026-11-14', start: '09:00', end: '10:30', mins: 90 },
    { id: 'e-2', activity: 'Revue PR', categoryId: 'travail', date: '2026-11-14', start: '11:00', end: '11:30', mins: 30 },
  ];

  let container;

  beforeEach(() => {
    document.body.replaceChildren();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  function activeNodes(rootEl) {
    return [...rootEl.querySelectorAll('g.tree-node:not(.is-exiting)')];
  }

  it('renders root and top-level categories collapsed by default, and reveals subcategories/activities when expanded', () => {
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
    });

    let nodes = activeNodes(container);
    let ids = nodes.map(n => n.dataset.nodeId);

    // Default collapsed: root + top-level categories only
    expect(ids).toContain('__root__');
    expect(ids).toContain('category:travail');
    expect(ids).toContain('category:sport');
    expect(ids).not.toContain('category:dev');
    expect(ids).not.toContain('activity:act-1');
    expect(ids).not.toContain('activity:act-2');
    expect(container.querySelector('.cat-tree-empty').hidden).toBe(true);

    // Expanding all reveals categories, subcategories, activities, and sessions
    tree.expandAll();
    nodes = activeNodes(container);
    ids = nodes.map(n => n.dataset.nodeId);
    expect(ids).toContain('category:dev');
    expect(ids).toContain('activity:act-1'); // Code Frontend
    expect(ids).toContain('activity:act-2'); // Course à pied
    expect(ids).toContain('activity:travail:revue pr');

    // Replier feuilles hides activities/sessions while keeping categories
    tree.collapseLeaves();
    nodes = activeNodes(container);
    expect(nodes.some(n => n.dataset.nodeType === 'session')).toBe(false);

    tree.destroy();
  });

  it('expands and collapses category leaves and branches when clicked', () => {
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
    });

    // Expand all first so both Travail and Sport start expanded
    tree.expandAll();
    const travailNode = container.querySelector('g.tree-node[data-node-id="category:travail"]');
    expect(travailNode).toBeTruthy();

    // Collapse Travail -> hides Dev, Code Frontend, and Revue PR
    travailNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    let ids = activeNodes(container).map(n => n.dataset.nodeId);
    expect(ids).toContain('category:travail');
    expect(ids).not.toContain('category:dev');
    expect(ids).not.toContain('activity:act-1');
    expect(ids).not.toContain('activity:travail:revue pr');
    // Sport stays expanded
    expect(ids).toContain('activity:act-2');

    // Re-expand Travail -> restores Dev and activity leaves
    container.querySelector('g.tree-node[data-node-id="category:travail"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ids = activeNodes(container).map(n => n.dataset.nodeId);
    expect(ids).toContain('category:dev');
    expect(ids).toContain('activity:act-1');

    tree.destroy();
  });

  it('expands and collapses session sub-leaves under an activity node when clicked', () => {
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
    });

    // Expand categories while leaving session leaves collapsed
    container.querySelector('g.tree-node[data-node-id="category:travail"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    container.querySelector('g.tree-node[data-node-id="category:dev"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const actNode = container.querySelector('g.tree-node[data-node-id="activity:act-1"]');
    expect(actNode).toBeTruthy();
    expect(actNode.getAttribute('aria-expanded')).toBe('false');

    // Click activity node -> expands session leaf
    actNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activeNodes(container).some(n => n.dataset.nodeType === 'session')).toBe(true);
    expect(container.querySelector('g.tree-node[data-node-id="activity:act-1"]').getAttribute('aria-expanded')).toBe('true');

    // Click again -> collapses session leaf
    container.querySelector('g.tree-node[data-node-id="activity:act-1"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activeNodes(container).some(n => n.dataset.nodeType === 'session')).toBe(false);

    tree.destroy();
  });

  it('supports toolbar actions: collapseLeaves, collapseAll (without showing empty state), expandAll', () => {
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
    });

    tree.expandAll();
    tree.collapseLeaves();
    let ids = activeNodes(container).map(n => n.dataset.nodeId);
    expect(ids).toContain('category:travail');
    expect(ids).toContain('category:sport');
    expect(ids).not.toContain('activity:act-1');
    expect(ids).not.toContain('activity:act-2');
    expect(container.querySelector('.cat-tree-empty').hidden).toBe(true);

    tree.collapseAll();
    ids = activeNodes(container).map(n => n.dataset.nodeId);
    expect(ids).toContain('__root__');
    expect(ids).toContain('category:travail');
    expect(ids).toContain('category:sport');
    expect(ids).not.toContain('category:dev');
    // Must NEVER display empty search message or hide SVG after clicking Tout replier
    expect(container.querySelector('.cat-tree-empty').hidden).toBe(true);
    expect(container.querySelector('.cat-tree-svg').style.display).not.toBe('none');

    // Even collapsing root manually keeps SVG visible (no false search empty state)
    container.querySelector('g.tree-node[data-node-id="__root__"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.cat-tree-empty').hidden).toBe(true);
    expect(container.querySelector('.cat-tree-svg').style.display).not.toBe('none');

    tree.expandAll();
    ids = activeNodes(container).map(n => n.dataset.nodeId);
    expect(ids).toContain('activity:act-1');
    expect(ids).toContain('activity:act-2');
    expect(activeNodes(container).some(n => n.dataset.nodeType === 'session')).toBe(true);

    tree.destroy();
  });

  it('filters tree nodes on search input and shows empty state when unmatched', () => {
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
    });

    const search = container.querySelector('.cat-tree-search');
    search.value = 'Course';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const ids = activeNodes(container).map(n => n.dataset.nodeId);
    expect(ids).toContain('category:sport');
    expect(ids).toContain('activity:act-2');
    expect(ids).not.toContain('category:travail');

    search.value = 'xyznomatch';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelector('.cat-tree-empty').hidden).toBe(false);

    // Reset filter button restores nodes
    container.querySelector('[data-tree-action="reset-filter"]').click();
    expect(container.querySelector('.cat-tree-empty').hidden).toBe(true);
    expect(activeNodes(container).length).toBeGreaterThan(2);

    tree.destroy();
  });

  it('proposes matching category/activity suggestions while typing in the search filter and applies selection', () => {
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
    });

    const search = container.querySelector('.cat-tree-search');
    const suggestionsBox = container.querySelector('.cat-tree-search-suggestions');
    expect(suggestionsBox.hidden).toBe(true);

    // Accent-insensitive partial query "dev" proposes "Développement"
    search.value = 'dev';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(suggestionsBox.hidden).toBe(false);
    const items = [...suggestionsBox.querySelectorAll('.cat-tree-search-suggestion')];
    expect(items.some(el => el.textContent.includes('Développement'))).toBe(true);

    // Selecting a suggestion fills input, hides suggestions, and filters tree
    const devSuggestion = items.find(el => el.textContent.includes('Développement'));
    devSuggestion.click();
    expect(search.value).toBe('Développement');
    expect(suggestionsBox.hidden).toBe(true);
    const ids = activeNodes(container).map(n => n.dataset.nodeId);
    expect(ids).toContain('category:dev');
    expect(ids).not.toContain('category:sport');

    tree.destroy();
  });

  it('triggers onStartActivity when clicking the play button on an activity leaf without collapsing', () => {
    const onStartActivity = vi.fn();
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
      onStartActivity,
    });

    tree.expandAll();
    const playBtn = container.querySelector('g.tree-node[data-node-id="activity:act-1"] [data-action="start-activity"]');
    expect(playBtn).toBeTruthy();
    playBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onStartActivity).toHaveBeenCalledTimes(1);
    expect(onStartActivity).toHaveBeenCalledWith('Code Frontend', 'dev');

    tree.destroy();
  });

  it('supports adding categories and activities from toolbar buttons directly from the graph', () => {
    const onAddCategory = vi.fn();
    const onAddActivity = vi.fn();
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
      onAddCategory,
      onAddActivity,
    });

    container.querySelector('[data-tree-action="add-category"]').click();
    expect(onAddCategory).toHaveBeenCalledWith(null);

    container.querySelector('[data-tree-action="add-activity"]').click();
    expect(onAddActivity).toHaveBeenCalledWith(null);

    tree.destroy();
  });

  it('opens contextual creation popover on category and root nodes to add subcategory or activity', () => {
    const onAddCategory = vi.fn();
    const onAddActivity = vi.fn();
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
      onAddCategory,
      onAddActivity,
    });

    tree.expandAll();

    // Click '+' on category:dev node
    const devAddBtn = container.querySelector('g.tree-node[data-node-id="category:dev"] [data-action="node-add"]');
    expect(devAddBtn).toBeTruthy();
    devAddBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const popover = container.querySelector('.cat-tree-node-popover');
    expect(popover.hidden).toBe(false);
    // Node must remain expanded (click did not toggle collapse)
    expect(activeNodes(container).some(n => n.dataset.nodeId === 'activity:act-1')).toBe(true);

    // Click "+ Sous-catégorie"
    popover.querySelector('[data-tree-popover-action="add-category"]').click();
    expect(onAddCategory).toHaveBeenCalledWith('dev');
    expect(popover.hidden).toBe(true);

    // Re-open on category:dev and click "+ Activité"
    devAddBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    popover.querySelector('[data-tree-popover-action="add-activity"]').click();
    expect(onAddActivity).toHaveBeenCalledWith('dev');
    expect(popover.hidden).toBe(true);

    // Click '+' on root node
    const rootAddBtn = container.querySelector('g.tree-node[data-node-id="__root__"] [data-action="node-add"]');
    rootAddBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    popover.querySelector('[data-tree-popover-action="add-category"]').click();
    expect(onAddCategory).toHaveBeenLastCalledWith(null);

    tree.destroy();
  });

  it('allows editing categories and activities directly from tree nodes and popover', () => {
    const onEditCategory = vi.fn();
    const onEditActivity = vi.fn();
    const onAddCategory = vi.fn();
    const onAddActivity = vi.fn();

    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
      onAddCategory,
      onAddActivity,
      onEditCategory,
      onEditActivity,
    });

    // Expand categories while keeping session sub-leaves collapsed
    container.querySelector('g.tree-node[data-node-id="category:travail"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    container.querySelector('g.tree-node[data-node-id="category:dev"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // 1. Direct edit button on Category node
    const editCatBtn = container.querySelector('g.tree-node[data-node-id="category:dev"] [data-action="edit-category"]');
    expect(editCatBtn).toBeTruthy();
    editCatBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onEditCategory).toHaveBeenCalledWith('dev');
    // Node must remain expanded
    expect(activeNodes(container).some(n => n.dataset.nodeId === 'activity:act-1')).toBe(true);

    // 2. Edit category from contextual popover
    const devAddBtn = container.querySelector('g.tree-node[data-node-id="category:dev"] [data-action="node-add"]');
    devAddBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const popover = container.querySelector('.cat-tree-node-popover');
    popover.querySelector('[data-tree-popover-action="edit-category"]').click();
    expect(onEditCategory).toHaveBeenCalledTimes(2);
    expect(onEditCategory).toHaveBeenLastCalledWith('dev');
    expect(popover.hidden).toBe(true);

    // 3. Direct edit button on saved Activity leaf node
    const editSavedActBtn = container.querySelector('g.tree-node[data-node-id="activity:act-1"] [data-action="edit-activity"]');
    expect(editSavedActBtn).toBeTruthy();
    editSavedActBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onEditActivity).toHaveBeenCalledWith({
      activityId: 'act-1',
      label: 'Code Frontend',
      categoryId: 'dev',
    });
    // Session sub-leaves must stay collapsed
    expect(activeNodes(container).some(n => n.dataset.nodeType === 'session')).toBe(false);

    // 4. Direct edit button on entry-derived Activity leaf node
    const editEntryActBtn = container.querySelector('g.tree-node[data-node-id="activity:travail:revue pr"] [data-action="edit-activity"]');
    expect(editEntryActBtn).toBeTruthy();
    editEntryActBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onEditActivity).toHaveBeenLastCalledWith({
      activityId: null,
      label: 'Revue PR',
      categoryId: 'travail',
    });

    tree.destroy();
  });

  function simulateD3Drag(sourceEl, targetEl) {
    const win = sourceEl.ownerDocument.defaultView || window;
    const sourceDatum = d3.select(sourceEl).datum();
    const targetDatum = d3.select(targetEl).datum();
    const widthByType = { root: 196, category: 226, activity: 236 };
    const srcW = widthByType[sourceDatum.data.type] || 226;
    const tgtW = widthByType[targetDatum.data.type] || 226;

    const deltaX = (targetDatum.y + tgtW / 2) - (sourceDatum.y + srcW / 2);
    const deltaY = targetDatum.x - sourceDatum.x;

    const makeMouseEvent = (type, clientX, clientY) => {
      const ev = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      });
      Object.defineProperty(ev, 'view', { value: win, configurable: true });
      return ev;
    };

    sourceEl.dispatchEvent(makeMouseEvent('mousedown', 100, 100));
    win.dispatchEvent(makeMouseEvent('mousemove', 100 + deltaX, 100 + deltaY));
    win.dispatchEvent(makeMouseEvent('mouseup', 100 + deltaX, 100 + deltaY));
  }

  it('supports drag-and-drop of categories and activities directly in the D3 tree', () => {
    const onMoveCategory = vi.fn();
    const onMoveActivity = vi.fn();

    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
      onMoveCategory,
      onMoveActivity,
    });

    tree.expandAll();

    const devNode = container.querySelector('g.tree-node[data-node-id="category:dev"]');
    const sportNode = container.querySelector('g.tree-node[data-node-id="category:sport"]');
    const travailNode = container.querySelector('g.tree-node[data-node-id="category:travail"]');
    const rootNode = container.querySelector('g.tree-node[data-node-id="__root__"]');
    const frontendNode = container.querySelector('g.tree-node[data-node-id="activity:act-1"]');

    expect(devNode.dataset.draggable).toBe('true');
    expect(frontendNode.dataset.draggable).toBe('true');
    expect(rootNode.dataset.draggable).toBe('false');

    // 1. Drag category 'dev' onto 'sport'
    simulateD3Drag(devNode, sportNode);
    expect(onMoveCategory).toHaveBeenCalledTimes(1);
    expect(onMoveCategory).toHaveBeenCalledWith('dev', 'sport');

    // 2. Drag subcategory 'dev' onto Root -> promotes to root (null)
    simulateD3Drag(devNode, rootNode);
    expect(onMoveCategory).toHaveBeenCalledTimes(2);
    expect(onMoveCategory).toHaveBeenLastCalledWith('dev', null);

    // 3. Prevent cyclic drag: dragging 'travail' onto its child 'dev' does NOT invoke onMoveCategory
    simulateD3Drag(travailNode, devNode);
    expect(onMoveCategory).toHaveBeenCalledTimes(2);

    // 4. Drag activity 'Code Frontend' onto 'sport'
    simulateD3Drag(frontendNode, sportNode);
    expect(onMoveActivity).toHaveBeenCalledTimes(1);
    expect(onMoveActivity).toHaveBeenCalledWith({
      activityId: 'act-1',
      label: 'Code Frontend',
      oldCategoryId: 'dev',
      newCategoryId: 'sport',
    });

    tree.destroy();
  });

  it('ignores wheel/zoom until stage has focus and releases focus on Escape or outside click', () => {
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
    });

    const stage = container.querySelector('.cat-tree-stage');
    const svg = container.querySelector('.cat-tree-svg');
    const zoomLayer = container.querySelector('.cat-tree-zoom-layer');
    expect(stage.dataset.chartFocused).toBe('false');
    expect(stage.classList.contains('is-focused')).toBe(false);

    const initialTransform = zoomLayer.getAttribute('transform');

    // 1. Wheel over unfocused SVG must NOT zoom and must allow default page scrolling
    const wheelUnfocused = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
    });
    svg.dispatchEvent(wheelUnfocused);
    expect(wheelUnfocused.defaultPrevented).toBe(false);
    expect(zoomLayer.getAttribute('transform')).toBe(initialTransform);

    // 2. Clicking/focusing stage enables wheel zoom
    stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(stage.dataset.chartFocused).toBe('true');
    expect(stage.classList.contains('is-focused')).toBe(true);

    const wheelFocused = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
    });
    svg.dispatchEvent(wheelFocused);
    expect(wheelFocused.defaultPrevented).toBe(true);
    expect(zoomLayer.getAttribute('transform')).not.toBe(initialTransform);

    // 3. Pressing Escape releases focus and stops subsequent wheel zooming
    const transformAfterZoom = zoomLayer.getAttribute('transform');
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stage.dataset.chartFocused).toBe('false');
    expect(stage.classList.contains('is-focused')).toBe(false);

    const wheelAfterEscape = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
    });
    svg.dispatchEvent(wheelAfterEscape);
    expect(wheelAfterEscape.defaultPrevented).toBe(false);
    expect(zoomLayer.getAttribute('transform')).toBe(transformAfterZoom);

    // 4. Re-focus then click outside -> focus released
    stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(stage.dataset.chartFocused).toBe('true');
    const outsideEl = document.createElement('div');
    document.body.appendChild(outsideEl);
    outsideEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(stage.dataset.chartFocused).toBe('false');

    tree.destroy();
  });

  it('prevents edit-activity pointerdown/mousedown/click from bubbling to SVG zoom or focusing chart, and blocks D3 while modal is open', () => {
    const onEditActivity = vi.fn();
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
      onEditActivity,
    });

    tree.expandAll();

    const stage = container.querySelector('.cat-tree-stage');
    const svg = container.querySelector('.cat-tree-svg');
    const zoomLayer = container.querySelector('.cat-tree-zoom-layer');
    const editBtn = container.querySelector('g.tree-node[data-node-id="activity:act-1"] [data-action="edit-activity"]');

    const svgMouseDownSpy = vi.fn();
    const svgClickSpy = vi.fn();
    svg.addEventListener('mousedown', svgMouseDownSpy);
    svg.addEventListener('click', svgClickSpy);

    editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onEditActivity).toHaveBeenCalledTimes(1);
    expect(svgMouseDownSpy).not.toHaveBeenCalled();
    expect(svgClickSpy).not.toHaveBeenCalled();
    expect(stage.dataset.chartFocused).toBe('false');

    // Simulate an open modal in the document -> wheel/clicks on chart must be ignored
    stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(stage.dataset.chartFocused).toBe('true');

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    document.body.appendChild(modalOverlay);

    const transformBefore = zoomLayer.getAttribute('transform');
    const wheelWithModal = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 });
    svg.dispatchEvent(wheelWithModal);
    expect(wheelWithModal.defaultPrevented).toBe(false);
    expect(zoomLayer.getAttribute('transform')).toBe(transformBefore);

    tree.destroy();
  });

  it('opens quick-add modal centered with backdrop, isolates D3 interactions while open, and closes on backdrop click or Escape', () => {
    const onAddCategory = vi.fn();
    const onAddActivity = vi.fn();
    const tree = renderCategoryActivityTree({
      container,
      categories,
      activities,
      entries,
      animationDuration: 0,
      onAddCategory,
      onAddActivity,
    });

    tree.expandAll();

    const stage = container.querySelector('.cat-tree-stage');
    const svg = container.querySelector('.cat-tree-svg');
    const zoomLayer = container.querySelector('.cat-tree-zoom-layer');
    const backdrop = container.querySelector('.cat-tree-popover-backdrop');
    const popover = container.querySelector('.cat-tree-node-popover');

    expect(backdrop).toBeTruthy();
    expect(backdrop.hidden).toBe(true);
    expect(popover.getAttribute('aria-modal')).toBe('true');

    // Focus chart first, then click '+' on category:dev
    stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(stage.dataset.chartFocused).toBe('true');

    const devAddBtn = container.querySelector('g.tree-node[data-node-id="category:dev"] [data-action="node-add"]');
    devAddBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(popover.hidden).toBe(false);
    expect(backdrop.hidden).toBe(false);
    expect(stage.dataset.chartFocused).toBe('false');

    // Wheel over SVG must NOT zoom while quick-add dialog is open
    const transformBefore = zoomLayer.getAttribute('transform');
    const wheelWhileOpen = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 });
    svg.dispatchEvent(wheelWhileOpen);
    expect(wheelWhileOpen.defaultPrevented).toBe(false);
    expect(zoomLayer.getAttribute('transform')).toBe(transformBefore);

    // Backdrop click closes dialog
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(popover.hidden).toBe(true);
    expect(backdrop.hidden).toBe(true);

    // Re-open and close with Escape
    devAddBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(popover.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover.hidden).toBe(true);
    expect(backdrop.hidden).toBe(true);

    tree.destroy();
  });
});



