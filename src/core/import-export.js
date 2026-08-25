import { validateImportData } from './validation.js';

export function buildExportPayload({ entries, savedActivities, customCategories, subCategories }) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    savedActivities,
    customCategories,
    subCategories,
  };
}

export function parseImportPayload(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('Le fichier JSON est invalide.');
  }

  return validateImportData(parsed);
}
