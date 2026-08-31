const DB_NAME = 'carnet-du-temps';
const STORE_NAME = 'kv';
const BEHAVIOR_STORE_NAME = 'behavior-events';
const DB_VERSION = 3;

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
      if (!db.objectStoreNames.contains(BEHAVIOR_STORE_NAME)) {
        const behaviorStore = db.createObjectStore(BEHAVIOR_STORE_NAME, { keyPath: 'id' });
        behaviorStore.createIndex('bySession', 'sessionId', { unique: false });
        behaviorStore.createIndex('byTimestamp', 'timestamp', { unique: false });
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

/**
 * Append-only store for behavior/semantic events (src/core/behavior).
 * Deliberately separate from the single-key `kv` store above: events are
 * inserted one at a time and queried by session/time range, never read or
 * replaced as a single blob.
 */
export async function appendBehaviorEvent(event) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BEHAVIOR_STORE_NAME, 'readwrite');
    tx.objectStore(BEHAVIOR_STORE_NAME).put(event);
    tx.oncomplete = () => resolve(event);
    tx.onerror = () => reject(tx.error || new Error('Écriture d’un événement comportemental impossible.'));
  });
}

export async function listBehaviorEvents({ sessionId = null, limit = null } = {}) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BEHAVIOR_STORE_NAME, 'readonly');
    const store = tx.objectStore(BEHAVIOR_STORE_NAME);
    const source = sessionId ? store.index('bySession').openCursor(IDBKeyRange.only(sessionId)) : store.openCursor();
    const results = [];
    source.onsuccess = () => {
      const cursor = source.result;
      if (cursor && (!limit || results.length < limit)) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results.sort((a, b) => a.timestamp - b.timestamp));
      }
    };
    source.onerror = () => reject(source.error || new Error('Lecture des événements comportementaux impossible.'));
  });
}

export async function countBehaviorEvents() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BEHAVIOR_STORE_NAME, 'readonly');
    const request = tx.objectStore(BEHAVIOR_STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Comptage des événements comportementaux impossible.'));
  });
}

/** Keeps only the most recent `maxEvents` behavior events (unbounded local growth guard). */
export async function pruneBehaviorEvents(maxEvents) {
  const db = await openDatabase();
  const total = await countBehaviorEvents();
  if (total <= maxEvents) return 0;

  const toDelete = total - maxEvents;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BEHAVIOR_STORE_NAME, 'readwrite');
    const index = tx.objectStore(BEHAVIOR_STORE_NAME).index('byTimestamp');
    const request = index.openCursor();
    let deleted = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && deleted < toDelete) {
        cursor.delete();
        deleted += 1;
        cursor.continue();
      } else {
        resolve(deleted);
      }
    };
    request.onerror = () => reject(request.error || new Error('Purge des événements comportementaux impossible.'));
  });
}

export async function clearBehaviorEvents() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BEHAVIOR_STORE_NAME, 'readwrite');
    tx.objectStore(BEHAVIOR_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Effacement des événements comportementaux impossible.'));
  });
}