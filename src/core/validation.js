/**
 * Runtime validation helpers for imported/persisted TimeTracker data.
 * Keep this module DOM-free so it can later be reused by Vue components.
 */

export function isString(value) {
  return typeof value === 'string';
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isTime(value) {
  return isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isDate(value) {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isTimeEntry(value) {
  return Boolean(
    value &&
    isString(value.id) &&
    isString(value.activity) &&
    isString(value.cat) &&
    isDate(value.date) &&
    isTime(value.start) &&
    isTime(value.end) &&
    isFiniteNumber(value.mins) &&
    value.mins >= 0
  );
}

export function isSavedActivity(value) {
  return Boolean(value && isString(value.id) && isString(value.label) && isString(value.cat));
}

export function isCategory(value) {
  return Boolean(value && isString(value.id) && isString(value.label) && isString(value.color));
}

export function isSubCategory(value) {
  return Boolean(value && isString(value.id) && isString(value.catId) && isString(value.label));
}

export function validateImportData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Format JSON invalide.');
  }

  const entries = value.entries ?? [];
  const savedActivities = value.savedActivities ?? [];
  const customCategories = value.customCategories ?? [];
  const subCategories = value.subCategories ?? [];

  if (!Array.isArray(entries) || !entries.every(isTimeEntry)) {
    throw new Error('Entrées de temps invalides.');
  }
  if (!Array.isArray(savedActivities) || !savedActivities.every(isSavedActivity)) {
    throw new Error('Activités enregistrées invalides.');
  }
  if (!Array.isArray(customCategories) || !customCategories.every(isCategory)) {
    throw new Error('Catégories personnalisées invalides.');
  }
  if (!Array.isArray(subCategories) || !subCategories.every(isSubCategory)) {
    throw new Error('Sous-catégories invalides.');
  }

  return { entries, savedActivities, customCategories, subCategories };
}
