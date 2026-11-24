/**
 * UI State — Pure functional helpers for normalizing, updating, and persisting
 * session-level UI state (active route, filters, period, collapsed tree nodes).
 */

import { DEFAULT_ROUTE, VALID_ROUTES } from './route-manager.js';

export const VALID_PERIODS = Object.freeze(['today', '7', '30', 'month', 'all', 'custom']);
export const VALID_ENTRY_MODES = Object.freeze(['timer', 'manual']);
export const VALID_MAP_POINT_TYPES = Object.freeze(['all', 'start', 'end']);
export const VALID_SYNC_TABS = Object.freeze(['drive', 'p2p']);
export const VALID_CATEGORY_FILTERS = Object.freeze(['all', 'roots', 'children']);

export const DEFAULT_UI_STATE = Object.freeze({
  tab: DEFAULT_ROUTE,
  period: '7',
  customStart: null,
  customEnd: null,
  shortcutCategoryFilter: 'all',
  entryFormMode: 'timer',
  mapCategoryFilter: 'all',
  mapPointTypeFilter: 'all',
  mapShowRoutePath: true,
  syncPanelTab: 'drive',
  collapsedTreeIds: null,
  treeSearchQuery: '',
  collapsedCategoryIds: null,
  categorySearchQuery: '',
  categoryFilter: 'all',
  categoryColorFilter: null,
});

/**
 * Normalizes text for accent-insensitive, case-insensitive search matching.
 * Pure function: string -> string
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalizes an optional array of collapsed node IDs (`null` means "not yet customized; use default collapsed").
 * Pure function: (unknown, Set<string>?) -> string[] | null
 */
function normalizeCollapsedIds(rawIds, excludeIds = []) {
  if (rawIds === null || rawIds === undefined) return null;
  if (!Array.isArray(rawIds)) return null;
  const excluded = new Set(excludeIds);
  const unique = [];
  const seen = new Set();
  for (const id of rawIds) {
    if (typeof id !== 'string' || !id || excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/**
 * Normalizes persisted or partial UI state into a safe canonical object.
 * Pure function: (raw) -> UIState
 */
export function normalizeUiState(raw = null) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const tab = VALID_ROUTES.includes(src.tab) ? src.tab : DEFAULT_UI_STATE.tab;
  const period = VALID_PERIODS.includes(src.period) ? src.period : DEFAULT_UI_STATE.period;
  const customStart = typeof src.customStart === 'string' && src.customStart ? src.customStart : null;
  const customEnd = typeof src.customEnd === 'string' && src.customEnd ? src.customEnd : null;
  const shortcutCategoryFilter = typeof src.shortcutCategoryFilter === 'string' && src.shortcutCategoryFilter
    ? src.shortcutCategoryFilter
    : DEFAULT_UI_STATE.shortcutCategoryFilter;
  const entryFormMode = VALID_ENTRY_MODES.includes(src.entryFormMode)
    ? src.entryFormMode
    : DEFAULT_UI_STATE.entryFormMode;
  const mapCategoryFilter = typeof src.mapCategoryFilter === 'string' && src.mapCategoryFilter
    ? src.mapCategoryFilter
    : DEFAULT_UI_STATE.mapCategoryFilter;
  const mapPointTypeFilter = VALID_MAP_POINT_TYPES.includes(src.mapPointTypeFilter)
    ? src.mapPointTypeFilter
    : DEFAULT_UI_STATE.mapPointTypeFilter;
  const mapShowRoutePath = typeof src.mapShowRoutePath === 'boolean'
    ? src.mapShowRoutePath
    : DEFAULT_UI_STATE.mapShowRoutePath;
  const syncPanelTab = VALID_SYNC_TABS.includes(src.syncPanelTab)
    ? src.syncPanelTab
    : DEFAULT_UI_STATE.syncPanelTab;

  const collapsedTreeIds = normalizeCollapsedIds(src.collapsedTreeIds, ['__root__']);
  const treeSearchQuery = typeof src.treeSearchQuery === 'string' ? src.treeSearchQuery : '';
  const collapsedCategoryIds = normalizeCollapsedIds(src.collapsedCategoryIds);
  const categorySearchQuery = typeof src.categorySearchQuery === 'string' ? src.categorySearchQuery : '';
  const categoryFilter = VALID_CATEGORY_FILTERS.includes(src.categoryFilter)
    ? src.categoryFilter
    : DEFAULT_UI_STATE.categoryFilter;
  const categoryColorFilter = typeof src.categoryColorFilter === 'string' && src.categoryColorFilter
    ? src.categoryColorFilter
    : null;

  return {
    tab,
    period,
    customStart,
    customEnd,
    shortcutCategoryFilter,
    entryFormMode,
    mapCategoryFilter,
    mapPointTypeFilter,
    mapShowRoutePath,
    syncPanelTab,
    collapsedTreeIds,
    treeSearchQuery,
    collapsedCategoryIds,
    categorySearchQuery,
    categoryFilter,
    categoryColorFilter,
  };
}

/**
 * Merges a UI state patch cleanly with an existing UI state object.
 * Pure function: (prev, patch) -> UIState
 */
export function mergeUiState(prev = null, patch = null) {
  const base = normalizeUiState(prev);
  if (!patch || typeof patch !== 'object') return base;
  return normalizeUiState({ ...base, ...patch });
}
