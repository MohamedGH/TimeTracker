import { migrateCategoryTree } from './category-tree.js';

export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
  { id: 'sommeil', label: 'Sommeil', color: '#5B4E7E', parentId: null, builtin: true },
  { id: 'loisirs', label: 'Loisirs', color: '#C98A3D', parentId: null, builtin: true },
  { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null, builtin: true },
  { id: 'social', label: 'Social', color: '#B5697A', parentId: null, builtin: true },
  { id: 'transport', label: 'Transport', color: '#8B93A1', parentId: null, builtin: true },
  { id: 'etude', label: 'Étude', color: '#3F7068', parentId: null, builtin: true },
  { id: 'autre', label: 'Autre', color: '#948C7E', parentId: null, builtin: true },
]);

export function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function isValidEntry(entry) {
  return Boolean(
    entry &&
    typeof entry.id === 'string' &&
    typeof entry.activity === 'string' &&
    typeof entry.cat === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.start === 'string' &&
    typeof entry.end === 'string' &&
    Number.isFinite(entry.mins),
  );
}

export function normalizeEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidEntry).map(entry => ({
    ...entry,
    activity: entry.activity.trim(),
    cat: entry.cat.trim(),
    sub: typeof entry.sub === 'string' ? entry.sub.trim() : '',
    mins: Math.max(0, Number(entry.mins)),
  }));
}

export function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Format de sauvegarde invalide.');
  }

  const legacyCategories = normalizeList(data.customCategories);
  const legacySubCategories = normalizeList(data.subCategories);
  const categoryTree = Array.isArray(data.categories)
    ? migrateCategoryTree(data.categories, [])
    : migrateCategoryTree(legacyCategories, legacySubCategories);

  return {
    version: Number(data.version) || 1,
    entries: normalizeEntries(data.entries),
    savedActivities: normalizeList(data.savedActivities),
    categories: categoryTree,
    // Kept during migration for backward compatibility with the legacy UI.
    customCategories: legacyCategories,
    subCategories: legacySubCategories,
  };
}
