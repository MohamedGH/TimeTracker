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
import { normalizeUiState } from './core/ui-state.js';

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
    storedUiState,
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
    getValue(STORAGE_KEYS.uiState, null),
  ]);

  const categories = mergeCategories(
    DEFAULT_CATEGORIES,
    migrateCategoryTree(storedCategories, []),
    storedTombstones?.categories || null,
  ).map(c => stampItem(c, 1));
  const categoryIds = new Set(categories.map(category => category.id));
  // Repair data produced by older migration builds. Categories must never be
  // displayed as saved activities.
  const normalizedActivities = Array.isArray(activities)
    ? activities
        .filter(activity => {
          if (!activity?.id) return false;
          if (activity.builtin === true) return false;
          const label = String(activity.label || activity.name || activity.activity || '').trim();
          if (!label) return false;
          if (categoryIds.has(activity.id)) return false;
          const name = label.toLowerCase();
          if (name === 'sans catégorie') return false;
          return true;
        })
        .map(a => {
          const content = typeof a.content === 'string' ? a.content.trim() : '';
          const startContent = typeof a.startContent === 'string' ? a.startContent.trim() : '';
          const endContent = typeof a.endContent === 'string' ? a.endContent.trim() : '';
          return stampItem({
            id: a.id,
            label: String(a.label || a.name || a.activity || '').trim(),
            categoryId: a.categoryId ?? a.cat ?? null,
            useCount: Number.isFinite(a.useCount) ? Math.max(0, a.useCount) : 1,
            lastUsedAt: a.lastUsedAt || null,
            avgDurationMins: Number.isFinite(a.avgDurationMins) ? Math.max(0, a.avgDurationMins) : null,
            ...(content ? { content } : {}),
            ...(startContent ? { startContent } : {}),
            ...(endContent ? { endContent } : {}),
            ...(Number.isFinite(Number(a.updatedAt)) ? { updatedAt: Number(a.updatedAt) } : {}),
          }, 1);
        })
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
    entries: [...normalizedEntries],
    activities: normalizedActivities.map(a => ({ ...a })),
    categories: [...categories],
    templates: [...normalizedTemplates],
  };

  let persistQueue = Promise.resolve();

  const restoredUiState = normalizeUiState(storedUiState);

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
    tab: restoredUiState.tab,
    period: restoredUiState.period,
    shortcutCategoryFilter: restoredUiState.shortcutCategoryFilter,
    deviceType: detectDeviceType(),
    customStart: restoredUiState.customStart,
    customEnd: restoredUiState.customEnd,
    uiState: restoredUiState,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
  };

  function runPersistSerialized(task) {
    const next = persistQueue.then(task, task);
    persistQueue = next.catch(() => {});
    return next;
  }

  async function persist(targetState) {
    return runPersistSerialized(async () => {
      const smState = stateManager.getState();
      const s = targetState || smState;
      const nowMs = Date.now();

      const entryDiff = diffAndStampCollection(lastPersistedSnapshot.entries, s.entries, currentTombstones.entries, nowMs);
      const actDiff = diffAndStampCollection(lastPersistedSnapshot.activities, s.activities, currentTombstones.activities, nowMs);
      const catDiff = diffAndStampCollection(lastPersistedSnapshot.categories, s.categories, currentTombstones.categories, nowMs);
      const tplDiff = diffAndStampCollection(lastPersistedSnapshot.templates, s.activityTemplates || [], currentTombstones.templates, nowMs);

      s.entries = entryDiff.items;
      s.activities = actDiff.items;
      s.categories = catDiff.items;
      s.activityTemplates = tplDiff.items;

      const nextUiState = normalizeUiState({
        ...s.uiState,
        tab: s.tab,
        period: s.period,
        customStart: s.customStart,
        customEnd: s.customEnd,
        shortcutCategoryFilter: s.shortcutCategoryFilter,
      });
      s.uiState = nextUiState;

      if (smState && s !== smState) {
        smState.entries = s.entries;
        smState.activities = s.activities;
        smState.categories = s.categories;
        smState.activityTemplates = s.activityTemplates;
        smState.deletedItems = s.deletedItems;
        smState.activeTemplateRun = s.activeTemplateRun;
        smState.activeTimer = s.activeTimer;
        smState.timerUpdatedAt = s.timerUpdatedAt;
        smState.quickTilesConfig = s.quickTilesConfig;
        smState.geoTrackingEnabled = s.geoTrackingEnabled;
        smState.tab = s.tab;
        smState.period = s.period;
        smState.customStart = s.customStart;
        smState.customEnd = s.customEnd;
        smState.shortcutCategoryFilter = s.shortcutCategoryFilter;
        smState.uiState = nextUiState;
      }

      currentTombstones = {
        entries: entryDiff.tombstones,
        activities: actDiff.tombstones,
        categories: catDiff.tombstones,
        templates: tplDiff.tombstones,
      };

      lastPersistedSnapshot = {
        entries: [...s.entries],
        activities: s.activities.map(a => ({ ...a })),
        categories: [...s.categories],
        templates: [...s.activityTemplates],
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
        setValue(STORAGE_KEYS.uiState, nextUiState),
      ]);
    });
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
    return runPersistSerialized(async () => {
      const s = stateManager.getState();
      s.entries = Array.isArray(merged?.entries) ? merged.entries : s.entries;
      s.activities = Array.isArray(merged?.activities) ? merged.activities : s.activities;
      s.categories = Array.isArray(merged?.categories) ? merged.categories : s.categories;
      if (Array.isArray(merged?.templates)) {
        s.activityTemplates = normalizeTemplatesList(merged.templates, s.categories);
      }
      currentTombstones = normalizeTombstones(merged?.tombstones || currentTombstones);

      lastPersistedSnapshot = {
        entries: [...s.entries],
        activities: s.activities.map(a => ({ ...a })),
        categories: [...s.categories],
        templates: [...(s.activityTemplates || [])],
      };

      await Promise.all([
        setValue(STORAGE_KEYS.entries, s.entries),
        setValue(STORAGE_KEYS.activities, s.activities),
        setValue(STORAGE_KEYS.categories, s.categories),
        setValue(STORAGE_KEYS.activityTemplates, s.activityTemplates || []),
        setValue(STORAGE_KEYS.syncTombstones, currentTombstones),
      ]);
    });
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
    persist: (targetState) => persist(targetState || stateManager.getState()),
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
