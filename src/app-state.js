import { getValue, setValue, removeValue, STORAGE_KEYS } from './core/storage.js';
import { migratePersistedData } from './core/persistence-migration.js';
import { DEFAULT_CATEGORIES, normalizeEntries } from './core/model.js';
import { migrateCategoryTree } from './core/category-tree.js';
import { createStateManager } from './core/state-manager.js';
import { detectDeviceType } from './core/device-navigation.js';
import { normalizeQuickTilesConfig } from './core/mobile/quick-tiles.js';
import { isSessionValid } from './core/auth/oidc.js';
import {
  diffAndStampCollection,
  emptyTombstones,
  normalizeTombstones,
  stampItem,
} from './core/sync/crdt-merge.js';
import {
  normalizeTemplatesList,
  normalizeActiveTemplateRun,
} from './state/template-actions.js';
import { normalizeTrashList } from './core/trash-manager.js';

export async function createAppState() {
  await migratePersistedData();

  const [
    entries,
    activities,
    storedCategories,
    storedTemplates,
    storedActiveTemplateRun,
    activeTimer,
    storedTimerUpdatedAt,
    storedQuickTilesConfig,
    storedGeoTrackingEnabled,
    storedAuthSession,
    storedTombstones,
    storedSyncMeta,
    storedTrash,
  ] = await Promise.all([
    getValue(STORAGE_KEYS.entries, []),
    getValue(STORAGE_KEYS.activities, []),
    getValue(STORAGE_KEYS.categories, []),
    getValue(STORAGE_KEYS.activityTemplates, []),
    getValue(STORAGE_KEYS.activeTemplateRun, null),
    getValue(STORAGE_KEYS.activeTimer, null),
    getValue(STORAGE_KEYS.timerUpdatedAt, 0),
    getValue(STORAGE_KEYS.quickTilesConfig, null),
    getValue(STORAGE_KEYS.geoTrackingEnabled, false),
    getValue(STORAGE_KEYS.authSession, null),
    getValue(STORAGE_KEYS.syncTombstones, null),
    getValue(STORAGE_KEYS.syncMeta, null),
    getValue(STORAGE_KEYS.trash, []),
  ]);

  const categories = mergeCategories(
    DEFAULT_CATEGORIES,
    migrateCategoryTree(storedCategories, []),
    storedTombstones?.categories || null,
  ).map(c => stampItem(c, 1));
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
  const normalizedTemplates = normalizeTemplatesList(storedTemplates, categories).map(t => stampItem(t, 1));
  const normalizedActiveTemplateRun = normalizeActiveTemplateRun(storedActiveTemplateRun);
  const normalizedQuickTilesConfig = normalizeQuickTilesConfig(storedQuickTilesConfig, {
    categories,
    activities: normalizedActivities,
    entries: normalizedEntries,
  });
  const initialTimerUpdatedAt = Number(storedTimerUpdatedAt) || Number(activeTimer?.startTs) || 0;
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
    templates: normalizedTemplates,
  };

  const initialRawState = {
    entries: normalizedEntries,
    activities: normalizedActivities,
    categories,
    activityTemplates: normalizedTemplates,
    deletedItems: normalizeTrashList(storedTrash),
    activeTemplateRun: normalizedActiveTemplateRun,
    activeTimer: activeTimer || null,
    timerUpdatedAt: initialTimerUpdatedAt,
    quickTilesConfig: normalizedQuickTilesConfig,
    geoTrackingEnabled: Boolean(storedGeoTrackingEnabled),
    authUser: restoredAuthUser,
    tab: 'entry',
    period: '7',
    shortcutCategoryFilter: 'all',
    deviceType: detectDeviceType(),
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
    const tplDiff = diffAndStampCollection(lastPersistedSnapshot.templates, s.activityTemplates || [], currentTombstones.templates, nowMs);

    s.entries = entryDiff.items;
    s.activities = actDiff.items;
    s.categories = catDiff.items;
    s.activityTemplates = tplDiff.items;

    currentTombstones = {
      entries: entryDiff.tombstones,
      activities: actDiff.tombstones,
      categories: catDiff.tombstones,
      templates: tplDiff.tombstones,
    };

    lastPersistedSnapshot = {
      entries: s.entries,
      activities: s.activities,
      categories: s.categories,
      templates: s.activityTemplates,
    };

    await Promise.all([
      setValue(STORAGE_KEYS.entries, s.entries),
      setValue(STORAGE_KEYS.activities, s.activities),
      setValue(STORAGE_KEYS.categories, s.categories),
      setValue(STORAGE_KEYS.activityTemplates, s.activityTemplates),
      setValue(STORAGE_KEYS.activeTemplateRun, s.activeTemplateRun || null),
      setValue(STORAGE_KEYS.activeTimer, s.activeTimer),
      setValue(STORAGE_KEYS.timerUpdatedAt, Number(s.timerUpdatedAt) || 0),
      setValue(STORAGE_KEYS.quickTilesConfig, s.quickTilesConfig || normalizedQuickTilesConfig),
      setValue(STORAGE_KEYS.geoTrackingEnabled, Boolean(s.geoTrackingEnabled)),
      setValue(STORAGE_KEYS.syncTombstones, currentTombstones),
      setValue(STORAGE_KEYS.trash, normalizeTrashList(s.deletedItems)),
    ]);
  }

  function getSyncPayload() {
    const s = stateManager.getState();
    return {
      entries: s.entries,
      activities: s.activities,
      categories: s.categories,
      templates: s.activityTemplates || [],
      tombstones: currentTombstones,
      deviceId: currentSyncMeta.deviceId,
    };
  }

  async function applyMergedSyncState(merged) {
    const s = stateManager.getState();
    s.entries = Array.isArray(merged?.entries) ? merged.entries : s.entries;
    s.activities = Array.isArray(merged?.activities) ? merged.activities : s.activities;
    s.categories = Array.isArray(merged?.categories) ? merged.categories : s.categories;
    if (Array.isArray(merged?.templates)) {
      s.activityTemplates = normalizeTemplatesList(merged.templates, s.categories);
    }
    currentTombstones = normalizeTombstones(merged?.tombstones || currentTombstones);

    lastPersistedSnapshot = {
      entries: s.entries,
      activities: s.activities,
      categories: s.categories,
      templates: s.activityTemplates || [],
    };

    await Promise.all([
      setValue(STORAGE_KEYS.entries, s.entries),
      setValue(STORAGE_KEYS.activities, s.activities),
      setValue(STORAGE_KEYS.categories, s.categories),
      setValue(STORAGE_KEYS.activityTemplates, s.activityTemplates || []),
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

function mergeCategories(defaults, stored, categoryTombstones = null) {
  const result = [];
  const seen = new Set();
  const hasStored = Array.isArray(stored) && stored.length > 0;
  const tombstones = categoryTombstones && typeof categoryTombstones === 'object' ? categoryTombstones : {};

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

  // Add any initial defaults if not yet present in storage and not explicitly deleted/merged
  for (const category of (Array.isArray(defaults) ? defaults : [])) {
    if (!category?.id || seen.has(category.id)) continue;
    if (hasStored && Number(tombstones[category.id]) > 0) continue;
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
