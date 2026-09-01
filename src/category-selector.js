/**
 * Replaces a flat category select with cascading selectors and collapsible tree views.
 * The canonical select remains in the DOM and keeps the value expected by the UI.
 * Each level exposes only the children of the category selected at the previous level,
 * with collapsible branches and an interactive collapsible tree hierarchy.
 */
export function installCategorySelectors(root) {
  if (!root) return () => {};
  const enhance = () => {
    root.querySelectorAll('select').forEach(enhanceSelect);
  };

  function enhanceSelect(select) {
    if (select.dataset.categorySelectorEnhanced === '1' || select.dataset.categorySelectorGenerated === '1') return;
    const options = [...select.options]
      .filter(option => option.value)
      .map(option => ({
        id: option.value,
        path: option.textContent.split(' > ').map(part => part.trim()).filter(Boolean),
      }));
    if (!options.length) return;

    select.dataset.categorySelectorEnhanced = '1';
    select.style.display = 'none';

    // Hide any outer container label to prevent duplicate "Catégorie" labels
    if (select.parentNode) {
      const parentLabel = select.parentNode.querySelector(':scope > label');
      if (parentLabel) {
        parentLabel.style.display = 'none';
      }
    }

    const container = document.createElement('div');
    container.className = 'category-selector-chain';
    select.parentNode.insertBefore(container, select);

    const pathForId = id => options.find(option => option.id === id)?.path || [];
    const idForPath = path => options.find(option => option.path.length === path.length && option.path.every((part, i) => part === path[i]))?.id || '';
    const childrenFor = parentPath => {
      const result = [];
      for (const option of options) {
        if (option.path.length !== parentPath.length + 1) continue;
        if (!option.path.slice(0, parentPath.length).every((part, i) => part === parentPath[i])) continue;
        const label = option.path[parentPath.length];
        if (!result.some(item => item.label === label)) result.push({ label, id: option.id });
      }
      return result;
    };

    const currentPath = () => pathForId(select.value);
    const collapsedLevels = new Set();
    let isTreeTrailCollapsed = false;

    function renderChain(targetPath = currentPath()) {
      container.replaceChildren();

      let parentPath = [];
      let depth = 0;
      const selectedPath = Array.isArray(targetPath) ? targetPath : [];

      while (true) {
        const currentDepth = depth;
        const children = childrenFor(parentPath);
        if (!children.length) break;

        const isChildLevel = currentDepth > 0;
        const isLevelCollapsed = collapsedLevels.has(currentDepth);

        const field = document.createElement('div');
        field.className = `field category-level category-level--depth-${currentDepth} ${isChildLevel ? 'category-level--child' : 'category-level--root'} ${isLevelCollapsed ? 'is-collapsed' : ''}`;
        
        const labelRow = document.createElement('div');
        labelRow.className = 'category-level-label-row';

        const fieldLabel = document.createElement('label');
        fieldLabel.textContent = currentDepth === 0 ? 'Catégorie' : 'Sous-catégorie';
        labelRow.appendChild(fieldLabel);

        if (isChildLevel) {
          const collapseBtn = document.createElement('button');
          collapseBtn.type = 'button';
          collapseBtn.className = 'category-level-collapse-toggle';
          collapseBtn.setAttribute('aria-label', isLevelCollapsed ? 'Déplier la sous-catégorie' : 'Replier la sous-catégorie');
          collapseBtn.title = isLevelCollapsed ? 'Déplier la sous-catégorie' : 'Replier la sous-catégorie';
          collapseBtn.innerHTML = isLevelCollapsed 
            ? `<span class="collapse-icon">▸</span><span class="collapse-text">Déplier</span>`
            : `<span class="collapse-icon">▾</span><span class="collapse-text">Replier</span>`;
          collapseBtn.onclick = (e) => {
            e.preventDefault();
            if (collapsedLevels.has(currentDepth)) {
              collapsedLevels.delete(currentDepth);
            } else {
              collapsedLevels.add(currentDepth);
            }
            renderChain(targetPath);
          };
          labelRow.appendChild(collapseBtn);
        }

        field.appendChild(labelRow);

        const selectWrapper = document.createElement('div');
        selectWrapper.className = `category-select-wrapper ${isLevelCollapsed ? 'is-hidden' : ''}`;

        const visible = document.createElement('select');
        visible.dataset.categorySelectorGenerated = '1';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = currentDepth === 0 ? 'Choisir une catégorie' : 'Choisir une sous-catégorie';
        visible.appendChild(placeholder);

        for (const child of children) {
          const option = document.createElement('option');
          option.value = child.label;
          option.textContent = child.label;
          visible.appendChild(option);
        }

        const wanted = selectedPath[currentDepth];
        if (wanted && children.some(child => child.label === wanted)) visible.value = wanted;

        selectWrapper.appendChild(visible);
        field.appendChild(selectWrapper);
        container.appendChild(field);

        visible.addEventListener('change', () => {
          const fields = [...container.querySelectorAll('.category-level select')];
          const index = fields.indexOf(visible);
          const path = fields.slice(0, index + 1).map(fieldSelect => fieldSelect.value).filter(Boolean);
          const id = idForPath(path);

          select.value = id;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          renderChain(path);
        });

        const chosen = visible.value;
        if (!chosen) break;
        parentPath = [...parentPath, chosen];
        depth += 1;
      }

      // If a path is selected, render a collapsible tree hierarchy trail
      if (parentPath.length > 0) {
        const trail = document.createElement('div');
        trail.className = `category-tree-trail ${isTreeTrailCollapsed ? 'is-collapsed' : ''}`;

        const headerRow = document.createElement('div');
        headerRow.className = 'category-tree-trail__header';

        const trailTitle = document.createElement('span');
        trailTitle.className = 'category-tree-trail__label';
        trailTitle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3L8 21"/><path d="M16 3l-2 18"/></svg> Arborescence active`;

        const trailToggle = document.createElement('button');
        trailToggle.type = 'button';
        trailToggle.className = 'category-tree-trail__toggle';
        trailToggle.innerHTML = isTreeTrailCollapsed 
          ? `<span class="trail-icon">▸</span> <span>Déplier l'arbre</span>`
          : `<span class="trail-icon">▾</span> <span>Replier</span>`;
        trailToggle.onclick = (e) => {
          e.preventDefault();
          isTreeTrailCollapsed = !isTreeTrailCollapsed;
          renderChain(targetPath);
        };

        headerRow.append(trailTitle, trailToggle);
        trail.appendChild(headerRow);

        if (!isTreeTrailCollapsed) {
          const nodesWrap = document.createElement('div');
          nodesWrap.className = 'category-tree-trail__nodes';

          parentPath.forEach((segment, idx) => {
            if (idx > 0) {
              const sep = document.createElement('span');
              sep.className = 'category-tree-sep';
              sep.textContent = '↳';
              nodesWrap.appendChild(sep);
            }

            const pill = document.createElement('button');
            pill.type = 'button';
            const isLeaf = idx === parentPath.length - 1;
            pill.className = `category-tree-node-pill ${isLeaf ? 'is-leaf' : ''}`;
            pill.textContent = segment;
            pill.title = `Sélectionner jusqu'à : ${parentPath.slice(0, idx + 1).join(' > ')}`;
            pill.onclick = (e) => {
              e.preventDefault();
              const subPath = parentPath.slice(0, idx + 1);
              const id = idForPath(subPath);
              select.value = id;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              renderChain(subPath);
            };
            nodesWrap.appendChild(pill);
          });

          trail.appendChild(nodesWrap);
        }

        container.appendChild(trail);
      }
    }

    renderChain();
  }

  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
