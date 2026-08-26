import { getValue, setValue, removeValue, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage.js';
import { migrateCategoryTree } from './category-tree.js';
import { migrateEntriesToCategoryTree } from './category-migration.ts';
import { migrateSavedActivities } from './saved-activities.js';

/** One-way migration of persisted data to the canonical schema. */
export async function migratePersistedData() {
  const version = await getValue(STORAGE_KEYS.schemaVersion, 1);
  if (Number(version) >= STORAGE_SCHEMA_VERSION) return { migrated: false, version };

  const [legacyCategories, legacySubcategories, entries, activities] = await Promise.all([
    getValue(STORAGE_KEYS.categories, []),
    getValue(STORAGE_KEYS.subcategories, []),
    getValue(STORAGE_KEYS.entries, []),
    getValue(STORAGE_KEYS.activities, []),
  ]);

  const customCategories = Array.isArray(legacyCategories) ? legacyCategories : [];
  const subcategories = Array.isArray(legacySubcategories) ? legacySubcategories : [];
  const categories = migrateCategoryTree(customCategories, subcategories);
  const migratedEntries = migrateEntriesToCategoryTree(
    Array.isArray(entries) ? entries : [], customCategories, subcategories,
  );
  const migratedActivities = migrateSavedActivities(
    Array.isArray(activities) ? activities : [], categories, subcategories,
  );

  await Promise.all([
    setValue(STORAGE_KEYS.categories, categories),
    setValue(STORAGE_KEYS.entries, migratedEntries),
    setValue(STORAGE_KEYS.activities, migratedActivities),
    setValue(STORAGE_KEYS.schemaVersion, STORAGE_SCHEMA_VERSION),
  ]);

  // Legacy storage is no longer part of the runtime schema. Remove it only
  // after the canonical data has been written successfully.
  await removeValue(STORAGE_KEYS.subcategories);

  return { migrated: true, version: STORAGE_SCHEMA_VERSION, categories, entries: migratedEntries, activities: migratedActivities };
}
