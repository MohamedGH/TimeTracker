import { validateImportData } from './validation.js';
import { migrateBackupToCategoryTree } from './category-migration.js';

export function buildExportPayload({ entries = [], savedActivities = [], categories = [], customCategories = [], subCategories = [] }) {
  const canonicalCategories = categories.length ? categories : [...customCategories, ...subCategories];
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    entries: entries.map(({ cat: _cat, sub: _sub, ...entry }) => ({ ...entry, categoryId: entry.categoryId ?? null })),
    savedActivities: savedActivities.map(({ cat: _cat, sub: _sub, subCategoryId: _subCategoryId, ...activity }) => ({ ...activity, categoryId: activity.categoryId ?? null })),
    categories: canonicalCategories,
  };
}

export function parseImportPayload(raw) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new Error('Le fichier JSON est invalide.'); }
  return validateImportData(migrateBackupToCategoryTree(parsed));
}
