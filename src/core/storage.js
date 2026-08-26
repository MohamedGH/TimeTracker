const DB_NAME = 'carnet-du-temps';
const STORE_NAME = 'kv';
const DB_VERSION = 2;

let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB indisponible dans ce navigateur.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossible d’ouvrir IndexedDB.'));
  });

  return databasePromise;
}

export async function getValue(key, fallback = null) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => reject(request.error || new Error(`Lecture impossible: ${key}`));
  });
}

export async function setValue(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error(`Écriture impossible: ${key}`));
  });
}

export async function removeValue(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error(`Suppression impossible: ${key}`));
  });
}

export async function clearAllData() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Impossible d’effacer toutes les données.'));
  });
}

export const STORAGE_KEYS = Object.freeze({
  entries: 'time-entries',
  activities: 'time-activities',
  categories: 'time-categories',
  // Legacy key kept readable for one-way migration.
  subcategories: 'time-subcategories',
  activeTimer: 'time-active-timer',
  schemaVersion: 'time-schema-version',
});

export const STORAGE_SCHEMA_VERSION = 2;

export async function loadCategoryData() {
  const [categories, legacySubcategories] = await Promise.all([
    getValue(STORAGE_KEYS.categories, []),
    getValue(STORAGE_KEYS.subcategories, []),
  ]);

  return {
    categories: Array.isArray(categories) ? categories : [],
    legacySubcategories: Array.isArray(legacySubcategories) ? legacySubcategories : [],
  };
}

export async function migrateCategoryStorage(migrate) {
  const current = await loadCategoryData();
  const migrated = migrate(current.categories, current.legacySubcategories);

  await setValue(STORAGE_KEYS.categories, migrated);
  await setValue(STORAGE_KEYS.schemaVersion, STORAGE_SCHEMA_VERSION);

  return migrated;
}