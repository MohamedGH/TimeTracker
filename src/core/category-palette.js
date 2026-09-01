/**
 * Curated color palette and utility helpers for color-coded category labels.
 */

export const CATEGORY_PALETTE = [
  { name: 'Ardoise', hex: '#4A5A75', group: 'Bleu / Gris' },
  { name: 'Lavande', hex: '#5B4E7E', group: 'Violet' },
  { name: 'Ambre', hex: '#C98A3D', group: 'Jaune / Ocre' },
  { name: 'Sauge', hex: '#5C7A5E', group: 'Vert' },
  { name: 'Rose Baie', hex: '#B5697A', group: 'Rose / Rouge' },
  { name: 'Acier', hex: '#8B93A1', group: 'Gris' },
  { name: 'Émeraude', hex: '#3F7068', group: 'Teal' },
  { name: 'Sable', hex: '#948C7E', group: 'Terre' },
  { name: 'Rubis', hex: '#C0392B', group: 'Rouge' },
  { name: 'Corail', hex: '#D35400', group: 'Orange' },
  { name: 'Océan', hex: '#2980B9', group: 'Bleu' },
  { name: 'Forêt', hex: '#27AE60', group: 'Vert vif' },
  { name: 'Améthyste', hex: '#8E44AD', group: 'Pourpre' },
  { name: 'Anthracite', hex: '#34495E', group: 'Sombre' },
  { name: 'Ocre Doré', hex: '#B3833C', group: 'Doré' },
  { name: 'Turquoise', hex: '#16A085', group: 'Cyan' },
];

export const DEFAULT_CATEGORY_COLOR = '#5C7A5E';

/**
 * Resolves the color of a category by object or categoryId.
 */
export function getCategoryColor(categoryOrId, categories = []) {
  if (!categoryOrId) return '#8B93A1';
  if (typeof categoryOrId === 'object') {
    return categoryOrId.color || '#5C7A5E';
  }
  const found = categories.find(c => c.id === categoryOrId);
  return found?.color || '#5C7A5E';
}

/**
 * Returns RGB hex components as [r, g, b].
 */
export function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [92, 122, 94];
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  if (clean.length !== 6) return [92, 122, 94];
  const num = parseInt(clean, 16);
  if (isNaN(num)) return [92, 122, 94];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Generates an accessible CSS background with opacity from a hex color.
 */
export function hexToRgba(hex, alpha = 0.14) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Determines whether text on a solid color should be light (#fff) or dark (#111).
 */
export function getContrastYIQ(hex) {
  const [r, g, b] = hexToRgb(hex);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 140) ? '#1E241E' : '#FFFFFF';
}

/**
 * Creates a DOM node for a color-coded category label badge.
 * Options:
 * - showPath: boolean (whether to render parent breadcrumb)
 * - size: 'normal' | 'small' | 'large'
 * - interactive: boolean
 */
export function createCategoryBadge(categoryOrId, categories = [], options = {}) {
  const { showPath = false, size = 'normal', interactive = false, className = '' } = options;
  const badge = document.createElement('span');
  badge.className = `category-badge category-badge--${size} ${interactive ? 'is-interactive' : ''} ${className}`.trim();

  if (!categoryOrId) {
    badge.classList.add('category-badge--empty');
    badge.innerHTML = `<span class="category-badge__dot"></span><span class="category-badge__label">Sans catégorie</span>`;
    return badge;
  }

  const category = typeof categoryOrId === 'object'
    ? categoryOrId
    : categories.find(c => c.id === categoryOrId);

  if (!category) {
    badge.classList.add('category-badge--empty');
    badge.innerHTML = `<span class="category-badge__dot"></span><span class="category-badge__label">Sans catégorie</span>`;
    return badge;
  }

  const color = category.color || DEFAULT_CATEGORY_COLOR;
  badge.dataset.categoryId = category.id;
  badge.style.setProperty('--badge-color', color);
  badge.style.setProperty('--badge-bg', hexToRgba(color, 0.12));
  badge.style.setProperty('--badge-border', hexToRgba(color, 0.35));

  const dot = document.createElement('span');
  dot.className = 'category-badge__dot';
  dot.style.backgroundColor = color;

  const textWrap = document.createElement('span');
  textWrap.className = 'category-badge__label';

  if (showPath && category.parentId) {
    const ancestors = [];
    let cur = categories.find(c => c.id === category.parentId);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      ancestors.unshift(cur);
      cur = cur.parentId ? categories.find(c => c.id === cur.parentId) : null;
    }
    if (ancestors.length) {
      const pathSpan = document.createElement('span');
      pathSpan.className = 'category-badge__path';
      pathSpan.textContent = ancestors.map(a => a.label).join(' › ') + ' › ';
      textWrap.appendChild(pathSpan);
    }
  }

  const nameSpan = document.createElement('strong');
  nameSpan.className = 'category-badge__name';
  nameSpan.textContent = category.label;
  textWrap.appendChild(nameSpan);

  badge.append(dot, textWrap);
  return badge;
}
