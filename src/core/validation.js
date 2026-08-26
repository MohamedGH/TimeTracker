/** Runtime validation for imported/persisted TimeTracker data. */
export function isString(value) { return typeof value === 'string'; }
export function isFiniteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
export function isTime(value) { return isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function isDate(value) {
  if (!isString(value) || !/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) return false;
  const [, year, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day);
}
export function isTimeEntry(value) { return Boolean(value && isString(value.id) && isString(value.activity) && (value.categoryId === null || isString(value.categoryId)) && isDate(value.date) && isTime(value.start) && isTime(value.end) && isFiniteNumber(value.mins) && value.mins >= 0); }
export function isSavedActivity(value) { return Boolean(value && isString(value.id) && isString(value.label) && (value.categoryId === null || isString(value.categoryId))); }
export function isCategory(value) { return Boolean(value && isString(value.id) && isString(value.label) && isString(value.color) && (value.parentId === null || value.parentId === undefined || isString(value.parentId))); }

export function validateImportData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Format JSON invalide.');
  const entries = value.entries ?? [];
  const savedActivities = value.savedActivities ?? [];
  const categories = value.categories ?? [];
  if (!Array.isArray(entries) || !entries.every(isTimeEntry)) throw new Error('Entrées de temps invalides.');
  if (!Array.isArray(savedActivities) || !savedActivities.every(isSavedActivity)) throw new Error('Activités enregistrées invalides.');
  if (!Array.isArray(categories) || !categories.every(isCategory)) throw new Error('Catégories invalides.');

  const ids = new Set(categories.map(category => category.id));
  if (categories.some(category => category.parentId && !ids.has(category.parentId))) throw new Error('Hiérarchie de catégories invalide.');
  if (entries.some(entry => entry.categoryId && !ids.has(entry.categoryId))) throw new Error('Catégorie d’une entrée introuvable.');
  if (savedActivities.some(activity => activity.categoryId && !ids.has(activity.categoryId))) throw new Error('Catégorie d’une activité enregistrée introuvable.');

  return { version: Math.max(2, Number(value.version) || 1), entries, savedActivities, categories };
}
