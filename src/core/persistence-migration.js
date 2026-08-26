import { getValue, setValue, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage.js';
import { migrateCategoryTree } from './category-tree.js';
import { migrateEntriesToCategoryTree } from './category-migration.js';
import { migrateSavedActivities } from './saved-activities.js';

export async function migratePersistedData() {
  const version = await getValue(STORAGE_KEYS.schemaVersion, 1);
  if (Number(version) >= STORAGE_SCHEMA_VERSION) return { migrated: false, version };

  const [legacyCategories, legacySubcategories, entries, activities] = await Promise.all([
    getValue(STORAGE_KEYS.categories, []), getValue(STORAGE_KEYS.subcategories, []),
    getValue(STORAGE_KEYS.entries, []), getValue(STORAGE_KEYS.activities, []),
  ]);
  const oldCategories = Array.isArray(legacyCategories) ? legacyCategories : [];
  const oldSubcategories = Array.isArray(legacySubcategories) ? legacySubcategories : [];
  const categories = migrateCategoryTree(oldCategories, oldSubcategories);
  const migratedEntries = migrateEntriesToCategoryTree(Array.isArray(entries) ? entries : [], categories, oldSubcategories);
  const migratedActivities = migrateSavedActivities(Array.isArray(activities) ? activities : [], categories, oldSubcategories);

  await Promise.all([
    setValue(STORAGE_KEYS.categories, categories),
    setValue(STORAGE_KEYS.entries, migratedEntries),
    setValue(STORAGE_KEYS.activities, migratedActivities),
    setValue(STORAGE_KEYS.schemaVersion, STORAGE_SCHEMA_VERSION),
  ]);
  return { migrated: true, version: STORAGE_SCHEMA_VERSION, categories, entries: migratedEntries, activities: migratedActivities };
}
