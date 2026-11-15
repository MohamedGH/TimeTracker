import { getValue, setValue, removeValue, STORAGE_KEYS } from './core/storage.js';
import { migratePersistedData } from './core/persistence-migration.js';
import { DEFAULT_CATEGORIES, normalizeEntries } from './core/model.js';
import { migrateCategoryTree } from './core/category-tree.js';
import { createStateManager } from './core/state-manager.js';
import { isSessionValid } from './core/auth/oidc.js';
import {
  diffAndStampCollection,
  emptyTombstones,
  normalizeTombstones,
  stampItem,
} from './core/sync/crdt-merge.js';

export async function createAppState() {
  await migratePersistedData();

  const [entries, activities, storedCategories, activeTimer, storedAuthSession, storedTombstones, storedSyncMeta] = await Promise.all([
    getValue(STORAGE_KEYS.entries, []),
    getValue(STORAGE_KEYS.activities, []),
    getValue(STORAGE_KEYS.categories, []),
    getValue(STORAGE_KEYS.activeTimer, null),
    getValue(STORAGE_KEYS.authSession, null),
    getValue(STORAGE_KEYS.syncTombstones, null),
    getValue(STORAGE_KEYS.syncMeta, null),
  ]);

  const categories = mergeCategories(DEFAULT_CATEGORIES, migrateCategoryTree(storedCategories, [])).map(c => stampItem(c, 1));
  const categoryIds = new Set(categories.map(category => category.id));
  const categoryLabels = new Set(categories.map(category => String(category.label || '').trim().toLowerCase()).filter(Boolean));

  // Repair data produced by older migration builds. Categories must never be
  // displayed as saved activities.
  const normalizedActivities = Array.isArray(activities)
    ? activities
        .filter(activity => {
          if (!activity?.id) return false;
          const label = String(activity.label || activity.name || activity.activity || '').trim();
          if (!label) return false;
          if (categoryIds.has(activity.id)) return false;
          const name = label.toLowerCase();
          if (name === 'sans catégorie') return false;
          if (categoryLabels.has(name)) return false;
          return true;
        })
        .map(a => stampItem({
          id: a.id,
          label: String(a.label || a.name || a.activity || '').trim(),
          categoryId: a.categoryId ?? a.cat ?? null,
          useCount: Number.isFinite(a.useCount) ? Math.max(0, a.useCount) : 1,
          lastUsedAt: a.lastUsedAt || null,
          avgDurationMins: Number.isFinite(a.avgDurationMins) ? Math.max(0, a.avgDurationMins) : null,
          ...(Number.isFinite(Number(a.updatedAt)) ? { updatedAt: Number(a.updatedAt) } : {}),
        }, 1))
    : [];

  const normalizedEntries = normalizeEntries(entries, categories, []).map(e => stampItem(e, 1));
  const restoredAuthUser = isSessionValid(storedAuthSession) ? storedAuthSession.user : null;

  let currentTombstones = storedTombstones ? normalizeTombstones(storedTombstones) : emptyTombstones();
  let currentSyncMeta = {
    deviceId: storedSyncMeta?.deviceId || `dev_${crypto.randomUUID().slice(0, 8)}`,
    lastDriveSyncAt: storedSyncMeta?.lastDriveSyncAt || null,
    driveAutoSync: Boolean(storedSyncMeta?.driveAutoSync),
    lastP2pSyncAt: storedSyncMeta?.lastP2pSyncAt || null,
  };
  if (!storedSyncMeta?.deviceId) {
    await setValue(STORAGE_KEYS.syncMeta, currentSyncMeta);
  }

  let lastPersistedSnapshot = {
    entries: normalizedEntries,
    activities: normalizedActivities,
    categories,
  };

  const initialRawState = {
    entries: normalizedEntries,
    activities: normalizedActivities,
    categories,
    activeTimer: activeTimer || null,
    authUser: restoredAuthUser,
    tab: 'entry',
    period: '7',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
  };

  async function persist(targetState) {
    const s = targetState || stateManager.getState();
    const nowMs = Date.now();

    const entryDiff = diffAndStampCollection(lastPersistedSnapshot.entries, s.entries, currentTombstones.entries, nowMs);
    const actDiff = diffAndStampCollection(lastPersistedSnapshot.activities, s.activities, currentTombstones.activities, nowMs);
    const catDiff = diffAndStampCollection(lastPersistedSnapshot.categories, s.categories, currentTombstones.categories, nowMs);

    s.entries = entryDiff.items;
    s.activities = actDiff.items;
    s.categories = catDiff.items;

    currentTombstones = {
      entries: entryDiff.tombstones,
      activities: actDiff.tombstones,
      categories: catDiff.tombstones,
    };

    lastPersistedSnapshot = {
      entries: s.entries,
      activities: s.activities,
      categories: s.categories,
    };

    await Promise.all([
      setValue(STORAGE_KEYS.entries, s.entries),
      setValue(STORAGE_KEYS.activities, s.activities),
      setValue(STORAGE_KEYS.categories, s.categories),
      setValue(STORAGE_KEYS.activeTimer, s.activeTimer),
      setValue(STORAGE_KEYS.syncTombstones, currentTombstones),
    ]);
  }

  function getSyncPayload() {
    const s = stateManager.getState();
    return {
      entries: s.entries,
      activities: s.activities,
      categories: s.categories,
      tombstones: currentTombstones,
      deviceId: currentSyncMeta.deviceId,
    };
  }

  async function applyMergedSyncState(merged) {
    const s = stateManager.getState();
    s.entries = Array.isArray(merged?.entries) ? merged.entries : s.entries;
    s.activities = Array.isArray(merged?.activities) ? merged.activities : s.activities;
    s.categories = Array.isArray(merged?.categories) ? merged.categories : s.categories;
    currentTombstones = normalizeTombstones(merged?.tombstones || currentTombstones);

    lastPersistedSnapshot = {
      entries: s.entries,
      activities: s.activities,
      categories: s.categories,
    };

    await Promise.all([
      setValue(STORAGE_KEYS.entries, s.entries),
      setValue(STORAGE_KEYS.activities, s.activities),
      setValue(STORAGE_KEYS.categories, s.categories),
      setValue(STORAGE_KEYS.syncTombstones, currentTombstones),
    ]);
  }

  function getSyncMeta() {
    return { ...currentSyncMeta };
  }

  async function saveSyncMeta(patch = {}) {
    currentSyncMeta = { ...currentSyncMeta, ...patch };
    await setValue(STORAGE_KEYS.syncMeta, currentSyncMeta);
    return { ...currentSyncMeta };
  }

  async function saveAuthSession({ user, expiresAt = null } = {}) {
    if (!user?.id) {
      await removeValue(STORAGE_KEYS.authSession);
      return null;
    }
    const safeSession = {
      user,
      expiresAt: Number.isFinite(Number(expiresAt)) ? Number(expiresAt) : null,
    };
    await setValue(STORAGE_KEYS.authSession, safeSession);
    return safeSession;
  }

  async function clearAuthSession() {
    await removeValue(STORAGE_KEYS.authSession);
  }

  const stateManager = createStateManager({
    initialState: initialRawState,
    persistFn: persist,
  });

  return {
    stateManager,
    state: stateManager.getState(),
    persist: () => persist(stateManager.getState()),
    saveAuthSession,
    clearAuthSession,
    getSyncPayload,
    applyMergedSyncState,
    getSyncMeta,
    saveSyncMeta,
  };
}

function mergeCategories(defaults, stored) {
  const result = [];
  const seen = new Set();

  // Load stored categories first so custom colors and edits are preserved
  for (const category of (Array.isArray(stored) ? stored : [])) {
    if (!category?.id || seen.has(category.id)) continue;
    result.push({
      id: category.id,
      label: String(category.label || '').trim(),
      color: category.color || null,
      parentId: category.parentId ?? null,
      builtin: Boolean(category.builtin),
    });
    seen.add(category.id);
  }

  // Add any initial defaults if not yet present in storage
  for (const category of (Array.isArray(defaults) ? defaults : [])) {
    if (!category?.id || seen.has(category.id)) continue;
    result.push({
      id: category.id,
      label: String(category.label || '').trim(),
      color: category.color || null,
      parentId: category.parentId ?? null,
      builtin: Boolean(category.builtin),
    });
    seen.add(category.id);
  }

  return result;
}
