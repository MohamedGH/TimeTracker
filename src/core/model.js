import { migrateCategoryTree } from './category-tree.js';
import { migrateEntriesToCategoryId } from './entry-migration.js';
import { isValidCoordinates, normalizeLocation } from './geo/geo-location.js';

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
  return String(value ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function isValidEntry(entry) {
  return Boolean(entry && typeof entry.id === 'string' && typeof entry.activity === 'string' &&
    (entry.categoryId === null || typeof entry.categoryId === 'string') && typeof entry.date === 'string' &&
    typeof entry.start === 'string' && typeof entry.end === 'string' && Number.isFinite(entry.mins) &&
    (entry.viaTimer === undefined || typeof entry.viaTimer === 'boolean') &&
    (entry.startLocation === undefined || entry.startLocation === null || isValidCoordinates(entry.startLocation)) &&
    (entry.endLocation === undefined || entry.endLocation === null || isValidCoordinates(entry.endLocation)) &&
    (entry.location === undefined || entry.location === null || isValidCoordinates(entry.location)));
}

export function normalizeEntries(value, categories = [], legacySubCategories = []) {
  if (!Array.isArray(value)) return [];
  return migrateEntriesToCategoryId(value, categories, legacySubCategories)
    .filter(isValidEntry)
    .map(entry => {
      const normalizedStart = normalizeLocation(entry.startLocation ?? entry.location);
      const normalizedEnd = normalizeLocation(entry.endLocation);
      const { location: _rawLocation, startLocation: _rawStart, endLocation: _rawEnd, ...rest } = entry;
      return {
        ...rest,
        activity: entry.activity.trim(),
        categoryId: entry.categoryId ?? null,
        mins: Math.max(0, Number(entry.mins)),
        ...(typeof entry.viaTimer === 'boolean' ? { viaTimer: entry.viaTimer } : {}),
        ...(normalizedStart ? { startLocation: normalizedStart } : {}),
        ...(normalizedEnd ? { endLocation: normalizedEnd } : {}),
      };
    });
}

export function normalizeList(value) { return Array.isArray(value) ? value : []; }

export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Format de sauvegarde invalide.');
  const legacyCategories = normalizeList(data.customCategories);
  const legacySubCategories = normalizeList(data.subCategories);
  const suppliedCategories = Array.isArray(data.categories) ? data.categories : legacyCategories;
  const categories = migrateCategoryTree([...DEFAULT_CATEGORIES, ...suppliedCategories],
    Array.isArray(data.categories) ? [] : legacySubCategories);
  return {
    version: Math.max(2, Number(data.version) || 1),
    entries: normalizeEntries(data.entries, categories, legacySubCategories),
    savedActivities: normalizeList(data.savedActivities),
    categories,
    activityTemplates: normalizeList(data.activityTemplates),
  };
}