import { getRoots, getChildren, getDescendants, formatCategoryPath } from '../../core/category-tree.js';
import { addCategory, updateCategory, deleteCategory } from '../../state/category-actions.js';
import { CATEGORY_PALETTE, DEFAULT_CATEGORY_COLOR, createCategoryBadge } from '../../core/category-palette.js';
import { trackEvent } from '../../core/analytics/analytics.js';
import { categoryCreatedPayload, categoryDeletedPayload } from '../../core/analytics/events.js';
import { getBehaviorTracking } from '../../core/behavior/index.js';

export function createCategoryManager({ state, persist: _persist, rerender }) {
  let searchQuery = '';
  let activeFilter = 'all'; // 'all' | 'roots' | 'children'
  let activeColorFilter = null;
  const collapsedNodes = new Set();

  function render() {
    const fragment = document.createDocumentFragment();

    // 1. Header Card with Title & Quick Stats
    fragment.appendChild(renderHeaderCard());

    // 2. Main Tree & List Card
    fragment.appendChild(renderTreeCard());

    return fragment;
  }

  function renderHeaderCard() {
    const card = document.createElement('section');
    card.className = 'card category-manager-header';

    const topRow = document.createElement('div');
    topRow.className = 'category-manager-header__top';

    const titleGroup = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = 'Gestion des catégories';
    const subtitle = document.createElement('p');
    subtitle.className = 'muted';
    subtitle.textContent = 'Créez, modifiez et organisez vos catégories avec des étiquettes colorées pour catégoriser vos activités.';
    titleGroup.append(title, subtitle);

    const addRootBtn = document.createElement('button');
    addRootBtn.type = 'button';
    addRootBtn.className = 'btn category-add-btn';
    addRootBtn.dataset.behaviorTarget = 'category-add-root';
    addRootBtn.innerHTML = `<span class="btn-icon">+</span> Nouvelle catégorie racine`;
    addRootBtn.onclick = () => {
      openCategoryModal({ mode: 'create', parentId: null });
    };

    topRow.append(titleGroup, addRootBtn);
    card.appendChild(topRow);

    // Stats Grid
    const rootsCount = getRoots(state.categories).length;
    const totalCount = state.categories.length;
    const subCount = totalCount - rootsCount;
    const entriesWithCat = state.entries.filter(e => Boolean(e.categoryId)).length;

    const statsGrid = document.createElement('div');
    statsGrid.className = 'category-stats-grid';

    statsGrid.append(
      createStatPill('Total catégories', totalCount),
      createStatPill('Catégories racines', rootsCount),
      createStatPill('Sous-catégories', subCount),
      createStatPill('Entrées classées', entriesWithCat)
    );

    card.appendChild(statsGrid);
    return card;
  }

  function createStatPill(label, value) {
    const pill = document.createElement('div');
    pill.className = 'category-stat-pill';
    const lbl = document.createElement('span');
    lbl.className = 'category-stat-pill__label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'category-stat-pill__value';
    val.textContent = String(value);
    pill.append(lbl, val);
    return pill;
  }

  function renderTreeCard() {
    const card = document.createElement('section');
    card.className = 'card category-manager-content';

    // Search and Filter Bar
    const filterBar = document.createElement('div');
    filterBar.className = 'category-filter-bar';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'category-search-input-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'category-search-input';
    searchInput.placeholder = 'Rechercher une catégorie…';
    searchInput.value = searchQuery;
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderCategoryList(treeContainer);
    });
    searchWrap.appendChild(searchInput);

    const filterGroup = document.createElement('div');
    filterGroup.className = 'category-filter-chips';

    const filters = [
      { id: 'all', label: 'Toutes' },
      { id: 'roots', label: 'Racines' },
      { id: 'children', label: 'Sous-catégories' },
    ];

    filters.forEach(f => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `btn small ${activeFilter === f.id ? 'active' : 'secondary'}`;
      chip.textContent = f.label;
      chip.onclick = () => {
        activeFilter = f.id;
        rerender();
      };
      filterGroup.appendChild(chip);
    });

    filterBar.append(searchWrap, filterGroup);
    card.appendChild(filterBar);

    // Color Swatch Filter Row
    const colorFilterBar = document.createElement('div');
    colorFilterBar.className = 'category-color-filter-bar';

    const colorFilterLabel = document.createElement('span');
    colorFilterLabel.className = 'muted text-xs';
    colorFilterLabel.textContent = 'Filtrer par couleur :';
    colorFilterBar.appendChild(colorFilterLabel);

    const swatchesContainer = document.createElement('div');
    swatchesContainer.className = 'category-color-filter-swatches';

    const allColorsBtn = document.createElement('button');
    allColorsBtn.type = 'button';
    allColorsBtn.className = `category-color-swatch-btn ${!activeColorFilter ? 'is-selected' : ''}`;
    allColorsBtn.title = 'Toutes les couleurs';
    allColorsBtn.textContent = '×';
    allColorsBtn.onclick = () => {
      activeColorFilter = null;
      rerender();
    };
    swatchesContainer.appendChild(allColorsBtn);

    // Get unique colors used in current categories
    const usedColors = [...new Set(state.categories.map(c => c.color || DEFAULT_CATEGORY_COLOR))];
    usedColors.forEach(color => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = `category-color-swatch-btn ${activeColorFilter === color ? 'is-selected' : ''}`;
      swatch.style.backgroundColor = color;
      swatch.title = `Filtrer par ${color}`;
      swatch.onclick = () => {
        activeColorFilter = activeColorFilter === color ? null : color;
        rerender();
      };
      swatchesContainer.appendChild(swatch);
    });

    colorFilterBar.appendChild(swatchesContainer);

    // Tree actions (Expand all / Collapse all)
    const treeActions = document.createElement('div');
    treeActions.className = 'category-tree-toolbar-actions';

    const expandAllBtn = document.createElement('button');
    expandAllBtn.type = 'button';
    expandAllBtn.className = 'btn small secondary';
    expandAllBtn.innerHTML = '▾ Tout déplier';
    expandAllBtn.title = 'Déplier toutes les branches de l’arbre';
    expandAllBtn.onclick = () => {
      collapsedNodes.clear();
      rerender();
    };

    const collapseAllBtn = document.createElement('button');
    collapseAllBtn.type = 'button';
    collapseAllBtn.className = 'btn small secondary';
    collapseAllBtn.innerHTML = '▸ Tout replier';
    collapseAllBtn.title = 'Replier toutes les branches de l’arbre';
    collapseAllBtn.onclick = () => {
      collapsedNodes.clear();
      state.categories.forEach(c => {
        if (getChildren(state.categories, c.id).length > 0) {
          collapsedNodes.add(c.id);
        }
      });
      rerender();
    };

    treeActions.append(expandAllBtn, collapseAllBtn);
    colorFilterBar.appendChild(treeActions);
    card.appendChild(colorFilterBar);

    // Tree container
    const treeContainer = document.createElement('div');
    treeContainer.className = 'category-tree-container';
    renderCategoryList(treeContainer);
    card.appendChild(treeContainer);

    return card;
  }

  function countCategoryUsage(categoryId) {
    const descendants = getDescendants(state.categories, categoryId);
    const allIds = new Set([categoryId, ...descendants.map(d => d.id)]);
    const entryCount = state.entries.filter(e => allIds.has(e.categoryId)).length;
    const activityCount = state.activities.filter(a => allIds.has(a.categoryId)).length;
    return { entryCount, activityCount };
  }

  function matchesFilters(category) {
    if (activeFilter === 'roots' && category.parentId !== null) return false;
    if (activeFilter === 'children' && category.parentId === null) return false;
    if (activeColorFilter && (category.color || DEFAULT_CATEGORY_COLOR) !== activeColorFilter) return false;

    if (searchQuery) {
      const name = category.label.toLowerCase();
      const path = formatCategoryPath(state.categories, category.id).toLowerCase();
      if (!name.includes(searchQuery) && !path.includes(searchQuery)) return false;
    }
    return true;
  }

  function renderCategoryList(container) {
    container.replaceChildren();

    const allCategories = state.categories;
    if (!allCategories.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Aucune catégorie trouvée.';
      container.appendChild(empty);
      return;
    }

    // If searching or filtering by flat criteria, show matching list
    if (searchQuery || activeColorFilter || activeFilter !== 'all') {
      const matching = allCategories.filter(matchesFilters);
      if (!matching.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Aucune catégorie ne correspond aux filtres sélectionnés.';
        container.appendChild(empty);
        return;
      }

      const list = document.createElement('div');
      list.className = 'category-flat-list';
      matching.forEach(cat => {
        list.appendChild(renderCategoryRow(cat, 0, false));
      });
      container.appendChild(list);
      return;
    }

    // Otherwise render hierarchical tree
    const rootCategories = getRoots(allCategories);
    const tree = document.createElement('div');
    tree.className = 'category-tree-view';

    rootCategories.forEach(rootCat => {
      tree.appendChild(renderTreeNode(rootCat, 0));
    });

    container.appendChild(tree);
  }

  function renderTreeNode(category, depth = 0) {
    const nodeWrap = document.createElement('div');
    nodeWrap.className = `category-tree-node depth-${depth}`;
    nodeWrap.dataset.categoryId = category.id;

    const children = getChildren(state.categories, category.id);
    const hasChildren = children.length > 0;
    const isCollapsed = collapsedNodes.has(category.id);

    // Row element
    const row = renderCategoryRow(category, depth, hasChildren, isCollapsed, () => {
      if (collapsedNodes.has(category.id)) {
        collapsedNodes.delete(category.id);
      } else {
        collapsedNodes.add(category.id);
      }
      rerender();
    });
    nodeWrap.appendChild(row);

    // Children wrapper
    if (hasChildren && !isCollapsed) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'category-tree-children';
      children.forEach(child => {
        childrenWrap.appendChild(renderTreeNode(child, depth + 1));
      });
      nodeWrap.appendChild(childrenWrap);
    }

    return nodeWrap;
  }

  function renderCategoryRow(category, depth = 0, hasChildren = false, isCollapsed = false, onToggle = null) {
    const row = document.createElement('div');
    row.className = 'category-item-row';
    row.dataset.categoryId = category.id;

    // Left info
    const left = document.createElement('div');
    left.className = 'category-item-row__left';

    // Expand/Collapse chevron if children exist
    if (hasChildren && onToggle) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'category-tree-toggle-btn';
      toggleBtn.innerHTML = isCollapsed ? '▸' : '▾';
      toggleBtn.title = isCollapsed ? 'Déplier' : 'Replier';
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        onToggle();
      };
      left.appendChild(toggleBtn);
    } else if (depth > 0) {
      const indentSpacer = document.createElement('span');
      indentSpacer.className = 'category-tree-indent-spacer';
      indentSpacer.textContent = '└';
      left.appendChild(indentSpacer);
    }

    // Color-coded label badge
    const badge = createCategoryBadge(category, state.categories, {
      showPath: depth > 0,
      size: 'normal',
      className: 'category-item-row__badge',
    });
    left.appendChild(badge);

    // Usage counts
    const { entryCount, activityCount } = countCategoryUsage(category.id);
    if (entryCount > 0 || activityCount > 0) {
      const usagePill = document.createElement('span');
      usagePill.className = 'category-usage-badge';
      usagePill.textContent = `${entryCount} entrée${entryCount > 1 ? 's' : ''}`;
      usagePill.title = `${entryCount} entrées de temps et ${activityCount} activités enregistrées`;
      left.appendChild(usagePill);
    }

    if (category.builtin) {
      const builtinTag = document.createElement('span');
      builtinTag.className = 'category-builtin-tag';
      builtinTag.textContent = 'Par défaut';
      left.appendChild(builtinTag);
    }

    // Right actions
    const actions = document.createElement('div');
    actions.className = 'category-item-row__actions';

    // 1. Add Subcategory button
    const addChildBtn = document.createElement('button');
    addChildBtn.type = 'button';
    addChildBtn.className = 'btn small secondary';
    addChildBtn.dataset.behaviorTarget = 'category-add-child';
    addChildBtn.textContent = '+ Sous-catégorie';
    addChildBtn.title = `Ajouter une sous-catégorie dans "${category.label}"`;
    addChildBtn.onclick = (e) => {
      e.stopPropagation();
      openCategoryModal({ mode: 'create', parentId: category.id });
    };

    // 2. Edit button
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn small secondary';
    editBtn.dataset.behaviorTarget = 'category-edit';
    editBtn.textContent = 'Modifier';
    editBtn.title = `Modifier "${category.label}"`;
    editBtn.onclick = (e) => {
      e.stopPropagation();
      openCategoryModal({ mode: 'edit', categoryId: category.id });
    };

    // 3. Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn small danger';
    deleteBtn.dataset.behaviorTarget = 'category-delete';
    deleteBtn.textContent = 'Supprimer';
    deleteBtn.title = `Supprimer "${category.label}"`;
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      openDeleteConfirmModal(category.id);
    };

    actions.append(addChildBtn, editBtn, deleteBtn);
    row.append(left, actions);
    return row;
  }

  function openCategoryModal({ mode, categoryId = null, parentId = null }) {
    const existing = categoryId ? state.categories.find(c => c.id === categoryId) : null;
    const parentCategory = parentId ? state.categories.find(c => c.id === parentId) : null;

    let initialColor = existing?.color || (parentCategory?.color || DEFAULT_CATEGORY_COLOR);
    let initialLabel = existing?.label || '';
    let initialParentId = existing ? existing.parentId : parentId;

    state.modal = {
      type: 'custom-category-editor',
      mode,
      categoryId,
      label: initialLabel,
      color: initialColor,
      parentId: initialParentId,
    };
    state.error = null;
    rerender();
  }

  function openDeleteConfirmModal(categoryId) {
    const category = state.categories.find(c => c.id === categoryId);
    if (!category) return;

    const descendants = getDescendants(state.categories, categoryId);
    const { entryCount, activityCount } = countCategoryUsage(categoryId);

    state.modal = {
      type: 'custom-category-delete-confirm',
      categoryId,
      category,
      descendants,
      entryCount,
      activityCount,
    };
    state.error = null;
    rerender();
  }

  return {
    render,
    openCategoryModal,
    openDeleteConfirmModal,
  };
}

/**
 * Renders the category create/edit modal dialog.
 */
export function renderCategoryEditorModal({ state, modal, persist, rerender }) {
  const isEdit = modal.mode === 'edit';
  const existingCategory = isEdit ? state.categories.find(c => c.id === modal.categoryId) : null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      state.modal = null;
      rerender();
    }
  };

  const box = document.createElement('div');
  box.className = 'modal-box category-editor-modal';

  const head = document.createElement('div');
  head.className = 'modal-head';

  let titleText = isEdit
    ? `Modifier la catégorie`
    : modal.parentId
      ? `Nouvelle sous-catégorie`
      : `Nouvelle catégorie`;

  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = titleText;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => {
    state.modal = null;
    rerender();
  };

  head.append(title, closeBtn);
  box.appendChild(head);

  const form = document.createElement('form');
  form.className = 'category-editor-form';
  form.dataset.behaviorForm = 'category-form';

  let currentColor = modal.color || DEFAULT_CATEGORY_COLOR;
  let currentLabel = modal.label || '';
  let currentParentId = modal.parentId || null;

  // Live Badge Preview
  const previewWrap = document.createElement('div');
  previewWrap.className = 'category-preview-container';
  const previewTitle = document.createElement('span');
  previewTitle.className = 'category-preview-title';
  previewTitle.textContent = 'Aperçu de l’étiquette :';
  previewWrap.appendChild(previewTitle);

  const previewBadge = createCategoryBadge(
    { id: 'preview', label: currentLabel || 'Exemple de catégorie', color: currentColor, parentId: currentParentId },
    state.categories,
    { showPath: Boolean(currentParentId) }
  );
  previewWrap.appendChild(previewBadge);
  form.appendChild(previewWrap);

  function updatePreview() {
    previewBadge.replaceWith(
      createCategoryBadge(
        {
          id: 'preview',
          label: nameInput.value.trim() || 'Exemple de catégorie',
          color: currentColor,
          parentId: parentSelect.value || null,
        },
        state.categories,
        { showPath: Boolean(parentSelect.value) }
      )
    );
  }

  // 1. Name Field
  const nameField = document.createElement('div');
  nameField.className = 'field';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Nom de la catégorie *';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.maxLength = 60;
  nameInput.placeholder = 'Ex. Développement, Réunions, Sport…';
  nameInput.value = currentLabel;
  nameInput.dataset.behaviorField = 'name';
  nameInput.addEventListener('input', () => updatePreview());
  nameField.append(nameLabel, nameInput);
  form.appendChild(nameField);

  // 2. Parent Category Field
  const parentField = document.createElement('div');
  parentField.className = 'field';
  const parentLabel = document.createElement('label');
  parentLabel.textContent = 'Catégorie parente';
  const parentSelect = document.createElement('select');
  parentSelect.dataset.behaviorField = 'parent';

  const rootOption = document.createElement('option');
  rootOption.value = '';
  rootOption.textContent = '— Aucune (Catégorie racine) —';
  parentSelect.appendChild(rootOption);

  // Filter candidates to avoid cycles if editing
  const invalidParentIds = new Set();
  if (isEdit && existingCategory) {
    invalidParentIds.add(existingCategory.id);
    getDescendants(state.categories, existingCategory.id).forEach(d => invalidParentIds.add(d.id));
  }

  state.categories
    .filter(c => !invalidParentIds.has(c.id))
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = formatCategoryPath(state.categories, c.id);
      if (c.id === currentParentId) opt.selected = true;
      parentSelect.appendChild(opt);
    });

  parentSelect.addEventListener('change', () => updatePreview());
  parentField.append(parentLabel, parentSelect);
  form.appendChild(parentField);

  // 3. Color Picker Palette & Custom HEX
  const colorField = document.createElement('div');
  colorField.className = 'field category-color-selection-field';
  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Couleur de l’étiquette';

  const paletteWrap = document.createElement('div');
  paletteWrap.className = 'category-palette-picker';

  const swatchGrid = document.createElement('div');
  swatchGrid.className = 'category-palette-grid';

  const customHexWrap = document.createElement('div');
  customHexWrap.className = 'category-custom-color-row';

  const customColorInput = document.createElement('input');
  customColorInput.type = 'color';
  customColorInput.className = 'category-color-input-native';
  customColorInput.value = currentColor;

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'category-color-hex-input';
  hexInput.value = currentColor.toUpperCase();
  hexInput.maxLength = 7;

  function selectColor(hex) {
    currentColor = hex;
    customColorInput.value = hex;
    hexInput.value = hex.toUpperCase();
    swatchGrid.querySelectorAll('.palette-swatch-button').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.color.toLowerCase() === hex.toLowerCase());
    });
    updatePreview();
  }

  CATEGORY_PALETTE.forEach(item => {
    const swatchBtn = document.createElement('button');
    swatchBtn.type = 'button';
    swatchBtn.className = `palette-swatch-button ${currentColor.toLowerCase() === item.hex.toLowerCase() ? 'is-active' : ''}`;
    swatchBtn.dataset.color = item.hex;
    swatchBtn.style.backgroundColor = item.hex;
    swatchBtn.title = `${item.name} (${item.hex})`;
    swatchBtn.onclick = () => selectColor(item.hex);
    swatchGrid.appendChild(swatchBtn);
  });

  customColorInput.addEventListener('input', (e) => {
    selectColor(e.target.value);
  });

  hexInput.addEventListener('change', (e) => {
    let val = e.target.value.trim();
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      selectColor(val);
    }
  });

  const customLabel = document.createElement('span');
  customLabel.className = 'muted text-xs';
  customLabel.textContent = 'Personnalisée :';

  customHexWrap.append(customLabel, customColorInput, hexInput);
  paletteWrap.append(swatchGrid, customHexWrap);
  colorField.append(colorLabel, paletteWrap);
  form.appendChild(colorField);

  // Submit & Cancel Buttons
  const actionsRow = document.createElement('div');
  actionsRow.className = 'action-row modal-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn';
  saveBtn.dataset.behaviorTarget = 'category-save';
  saveBtn.textContent = isEdit ? 'Enregistrer les modifications' : 'Créer la catégorie';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn secondary';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.onclick = () => {
    state.modal = null;
    rerender();
  };

  actionsRow.append(saveBtn, cancelBtn);
  form.appendChild(actionsRow);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const labelVal = nameInput.value.trim();
    if (!labelVal) {
      showModalError(box, 'Veuillez saisir un nom de catégorie.');
      return;
    }

    const parentIdVal = parentSelect.value || null;
    const colorVal = currentColor || DEFAULT_CATEGORY_COLOR;

    try {
      if (isEdit) {
        state.categories = updateCategory(state.categories, modal.categoryId, {
          label: labelVal,
          color: colorVal,
          parentId: parentIdVal,
        });
        trackEvent('category_renamed');
      } else {
        const id = generateCategoryId(labelVal, state.categories);
        state.categories = addCategory(state.categories, {
          id,
          label: labelVal,
          color: colorVal,
          parentId: parentIdVal,
          builtin: false,
        });
        trackEvent('category_created', categoryCreatedPayload({ depth: parentIdVal ? 1 : 0 }));
      }

      state.modal = null;
      state.error = null;
      await persist();
      getBehaviorTracking()?.tracker.trackFormResult('category-form', 'success', { object: 'category' });
      rerender();
    } catch (err) {
      showModalError(box, err.message || 'Impossible d’enregistrer la catégorie.');
      getBehaviorTracking()?.tracker.trackFormResult('category-form', 'error', { object: 'category', code: 'save-failed' });
    }
  };

  box.appendChild(form);
  overlay.appendChild(box);
  return overlay;
}

/**
 * Renders the category delete confirmation modal dialog.
 */
export function renderCategoryDeleteConfirmModal({ state, modal, persist, rerender }) {
  const { category, descendants, entryCount, activityCount } = modal;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      state.modal = null;
      rerender();
    }
  };

  const box = document.createElement('div');
  box.className = 'modal-box category-delete-modal';

  const head = document.createElement('div');
  head.className = 'modal-head';

  const title = document.createElement('h2');
  title.className = 'card-title text-danger';
  title.textContent = 'Confirmer la suppression';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => {
    state.modal = null;
    rerender();
  };

  head.append(title, closeBtn);
  box.appendChild(head);

  const content = document.createElement('div');
  content.className = 'category-delete-content';

  const desc = document.createElement('p');
  desc.textContent = `Êtes-vous sûr de vouloir supprimer la catégorie suivante ?`;
  content.appendChild(desc);

  const badgeWrap = document.createElement('div');
  badgeWrap.className = 'category-delete-badge-wrap';
  badgeWrap.appendChild(createCategoryBadge(category, state.categories, { showPath: true, size: 'large' }));
  content.appendChild(badgeWrap);

  const impactList = document.createElement('div');
  impactList.className = 'category-delete-impact-list';

  if (descendants.length > 0) {
    const subNotice = document.createElement('div');
    subNotice.className = 'impact-item impact-warning';
    subNotice.innerHTML = `⚠️ <strong>${descendants.length} sous-catégorie${descendants.length > 1 ? 's' : ''}</strong> seront également supprimées en cascade (${descendants.map(d => d.label).join(', ')}).`;
    impactList.appendChild(subNotice);
  }

  if (entryCount > 0) {
    const entryNotice = document.createElement('div');
    entryNotice.className = 'impact-item';
    entryNotice.innerHTML = `⏱️ <strong>${entryCount} entrée${entryCount > 1 ? 's' : ''} de temps</strong> associée${entryCount > 1 ? 's' : ''} deviendront non catégorisées (vos données temporelles restent conservées).`;
    impactList.appendChild(entryNotice);
  }

  if (activityCount > 0) {
    const actNotice = document.createElement('div');
    actNotice.className = 'impact-item';
    actNotice.innerHTML = `📋 <strong>${activityCount} activité${activityCount > 1 ? 's' : ''} enregistrée${activityCount > 1 ? 's' : ''}</strong> seront dissociée${activityCount > 1 ? 's' : ''}.`;
    impactList.appendChild(actNotice);
  }

  content.appendChild(impactList);

  const actions = document.createElement('div');
  actions.className = 'action-row modal-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn danger';
  confirmBtn.dataset.behaviorTarget = 'category-delete-confirm';
  confirmBtn.textContent = 'Supprimer définitivement';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn secondary';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.onclick = () => {
    state.modal = null;
    rerender();
  };

  confirmBtn.onclick = async () => {
    const allIdsToDelete = new Set([category.id, ...descendants.map(d => d.id)]);
    state.categories = deleteCategory(state.categories, category.id, { cascade: true });
    state.entries = state.entries.map(e => allIdsToDelete.has(e.categoryId) ? { ...e, categoryId: null } : e);
    state.activities = state.activities.map(a => allIdsToDelete.has(a.categoryId) ? { ...a, categoryId: null } : a);

    if (state.activeTimer && allIdsToDelete.has(state.activeTimer.categoryId)) {
      state.activeTimer = { ...state.activeTimer, categoryId: null };
    }

    state.modal = null;
    await persist();
    trackEvent('category_deleted', categoryDeletedPayload({ cascade: true, descendantCount: descendants.length }));
    rerender();
  };

  actions.append(confirmBtn, cancelBtn);
  box.append(content, actions);
  overlay.appendChild(box);
  return overlay;
}

function showModalError(parent, message) {
  const old = parent.querySelector('.modal-error-box');
  old?.remove();
  const errorBox = document.createElement('div');
  errorBox.className = 'error modal-error-box';
  errorBox.textContent = message;
  const form = parent.querySelector('form') || parent;
  form.prepend(errorBox);
}

function generateCategoryId(text, categories) {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'category';

  let id = base;
  let counter = 2;
  while (categories.some(c => c.id === id)) {
    id = `${base}-${counter++}`;
  }
  return id;
}
