export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'travail', label: 'Travail', color: '#4A5A75' },
  { id: 'sommeil', label: 'Sommeil', color: '#5B4E7E' },
  { id: 'loisirs', label: 'Loisirs', color: '#C98A3D' },
  { id: 'sport', label: 'Sport', color: '#5C7A5E' },
  { id: 'social', label: 'Social', color: '#B5697A' },
  { id: 'transport', label: 'Transport', color: '#8B93A1' },
  { id: 'etude', label: 'Étude', color: '#3F7068' },
  { id: 'autre', label: 'Autre', color: '#948C7E' },
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

  return {
    entries: normalizeEntries(data.entries),
    savedActivities: normalizeList(data.savedActivities),
    customCategories: normalizeList(data.customCategories),
    subCategories: normalizeList(data.subCategories),
  };
}
