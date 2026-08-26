/**
 * Replaces a flat category select with cascading selectors.
 * The canonical select remains in the DOM and keeps the value expected by the UI.
 * Each level exposes only the children of the category selected at the previous level.
 */
export function installCategorySelectors(root) {
  if (!root) return;
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

    function renderChain(targetPath = currentPath()) {
      container.replaceChildren();

      let parentPath = [];
      let depth = 0;
      const selectedPath = Array.isArray(targetPath) ? targetPath : [];

      while (true) {
        const children = childrenFor(parentPath);
        if (!children.length) break;

        const field = document.createElement('div');
        field.className = 'field category-level';
        const fieldLabel = document.createElement('label');
        fieldLabel.textContent = depth === 0 ? 'Catégorie' : 'Sous-catégorie';
        const visible = document.createElement('select');
        visible.dataset.categorySelectorGenerated = '1';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = depth === 0 ? 'Choisir une catégorie' : 'Choisir une sous-catégorie';
        visible.appendChild(placeholder);

        for (const child of children) {
          const option = document.createElement('option');
          option.value = child.label;
          option.textContent = child.label;
          visible.appendChild(option);
        }

        const wanted = selectedPath[depth];
        if (wanted && children.some(child => child.label === wanted)) visible.value = wanted;

        field.append(fieldLabel, visible);
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
    }

    renderChain();
  }

  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
