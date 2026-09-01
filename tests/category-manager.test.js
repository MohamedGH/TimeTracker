import { describe, it, expect } from 'vitest';
import { addCategory, updateCategory, deleteCategory } from '../src/state/category-actions.js';
import {
  CATEGORY_PALETTE,
  DEFAULT_CATEGORY_COLOR,
  getCategoryColor,
  hexToRgb,
  hexToRgba,
  getContrastYIQ,
  createCategoryBadge,
} from '../src/core/category-palette.js';

describe('Category Actions & Mutations', () => {
  const initialCategories = [
    { id: 'work', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
    { id: 'dev', label: 'Développement', color: '#2980B9', parentId: 'work', builtin: false },
    { id: 'life', label: 'Personnel', color: '#5C7A5E', parentId: null, builtin: true },
  ];

  it('adds a new category with color and parent', () => {
    const next = addCategory(initialCategories, {
      id: 'sport',
      label: 'Sport',
      color: '#E67E22',
      parentId: 'life',
    });
    expect(next.length).toBe(4);
    const added = next.find(c => c.id === 'sport');
    expect(added).toEqual({
      id: 'sport',
      label: 'Sport',
      color: '#E67E22',
      parentId: 'life',
      builtin: false,
    });
  });

  it('updates an existing category label, color, and parent', () => {
    const updated = updateCategory(initialCategories, 'dev', {
      label: 'Code & Dev',
      color: '#8E44AD',
      parentId: null,
    });
    const dev = updated.find(c => c.id === 'dev');
    expect(dev.label).toBe('Code & Dev');
    expect(dev.color).toBe('#8E44AD');
    expect(dev.parentId).toBeNull();
  });

  it('throws when updating to empty label', () => {
    expect(() => {
      updateCategory(initialCategories, 'dev', { label: '   ' });
    }).toThrow('Le nom de la catégorie ne peut pas être vide.');
  });

  it('prevents cyclic hierarchy changes in updateCategory', () => {
    expect(() => {
      updateCategory(initialCategories, 'work', { parentId: 'dev' });
    }).toThrow('Déplacement impossible : il créerait une boucle.');
  });

  it('deletes a category and cascades subcategories when cascade: true', () => {
    const remaining = deleteCategory(initialCategories, 'work', { cascade: true });
    expect(remaining.map(c => c.id)).toEqual(['life']);
  });
});

describe('Category Palette & Color Helpers', () => {
  it('provides curated accessible colors', () => {
    expect(CATEGORY_PALETTE.length).toBeGreaterThanOrEqual(10);
    expect(CATEGORY_PALETTE[0]).toHaveProperty('hex');
    expect(CATEGORY_PALETTE[0]).toHaveProperty('name');
  });

  it('resolves color for category object or id', () => {
    const list = [{ id: 'test', label: 'Test', color: '#123456' }];
    expect(getCategoryColor(list[0])).toBe('#123456');
    expect(getCategoryColor('test', list)).toBe('#123456');
    expect(getCategoryColor('unknown', list)).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('converts hex to RGB and RGBA correctly', () => {
    expect(hexToRgb('#4A5A75')).toEqual([74, 90, 117]);
    expect(hexToRgba('#4A5A75', 0.5)).toBe('rgba(74, 90, 117, 0.5)');
  });

  it('determines contrast YIQ correctly for dark and light colors', () => {
    expect(getContrastYIQ('#000000')).toBe('#FFFFFF');
    expect(getContrastYIQ('#FFFFFF')).toBe('#1E241E');
  });

  it('creates DOM category badge elements with color properties', () => {
    const list = [
      { id: 'parent', label: 'Projets', color: '#5B4E7E', parentId: null },
      { id: 'child', label: 'Frontend', color: '#2980B9', parentId: 'parent' },
    ];
    const badge = createCategoryBadge(list[1], list, { showPath: true });
    expect(badge.className).toContain('category-badge');
    expect(badge.dataset.categoryId).toBe('child');
    expect(badge.textContent).toContain('Frontend');
    expect(badge.textContent).toContain('Projets');
  });

  it('hides duplicate outer label when installCategorySelectors enhances category fields', async () => {
    const { installCategorySelectors } = await import('../src/category-selector.js');
    const container = document.createElement('div');
    const field = document.createElement('div');
    field.className = 'field';
    const outerLabel = document.createElement('label');
    outerLabel.textContent = 'Catégorie';
    const select = document.createElement('select');
    const opt1 = document.createElement('option');
    opt1.value = 'cat1';
    opt1.textContent = 'Travail';
    const opt2 = document.createElement('option');
    opt2.value = 'cat2';
    opt2.textContent = 'Travail > Dev';
    select.append(opt1, opt2);
    field.append(outerLabel, select);
    container.appendChild(field);
    document.body.appendChild(container);

    const cleanup = installCategorySelectors(container);
    expect(outerLabel.style.display).toBe('none');
    expect(select.style.display).toBe('none');
    const categoryLabels = [...field.querySelectorAll('.category-selector-chain label')].map(l => l.textContent);
    expect(categoryLabels).toEqual(['Catégorie', 'Sous-catégorie']);
    const allVisibleLabels = [...field.querySelectorAll('label')].filter(l => l.style.display !== 'none');
    // Ensure the outer label is hidden so there is only 1 'Catégorie' label
    expect(allVisibleLabels.filter(l => l.textContent === 'Catégorie').length).toBe(1);

    cleanup();
    container.remove();
  });

  it('supports collapsible subcategories and collapsible tree trail in installCategorySelectors', async () => {
    const { installCategorySelectors } = await import('../src/category-selector.js');
    const container = document.createElement('div');
    const field = document.createElement('div');
    field.className = 'field';
    const select = document.createElement('select');
    const opt1 = document.createElement('option');
    opt1.value = 'cat1';
    opt1.textContent = 'Travail';
    const opt2 = document.createElement('option');
    opt2.value = 'cat2';
    opt2.textContent = 'Travail > Dev';
    select.append(opt1, opt2);
    field.appendChild(select);
    container.appendChild(field);
    document.body.appendChild(container);

    const cleanup = installCategorySelectors(container);
    
    // Select root
    const rootSelect = field.querySelector('.category-level--root select');
    rootSelect.value = 'Travail';
    rootSelect.dispatchEvent(new Event('change'));

    // Verify subcategory level has collapse button
    const collapseToggle = field.querySelector('.category-level-collapse-toggle');
    expect(collapseToggle).toBeTruthy();
    expect(collapseToggle.textContent).toContain('Replier');

    // Click collapse button
    collapseToggle.click();
    expect(field.querySelector('.category-level--child').classList.contains('is-collapsed')).toBe(true);

    // Verify trail collapse toggle
    const trailToggle = field.querySelector('.category-tree-trail__toggle');
    expect(trailToggle).toBeTruthy();
    trailToggle.click();
    expect(field.querySelector('.category-tree-trail').classList.contains('is-collapsed')).toBe(true);

    cleanup();
    container.remove();
  });
});
