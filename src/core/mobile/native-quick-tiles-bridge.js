/**
 * Capacitor Native Bridge for Android Quick Settings Timer Tiles (`QuickTimerTiles`).
 * Uses @capacitor/core `registerPlugin` with a safe Web fallback so browsers/PWA/tests
 * work identically without runtime errors.
 */

import { registerPlugin } from '@capacitor/core';
import { getCapacitorPlatform, isCapacitorNative } from './pwa-install.js';
import { QUICK_TILE_MAX_SLOTS, createDefaultQuickTilesConfig } from './quick-tiles.js';

function createWebFallbackPlugin(win = typeof window !== 'undefined' ? window : null) {
  let memoryConfig = createDefaultQuickTilesConfig();
  let memoryTimer = null;
  let memoryTimerUpdatedAt = 0;

  return {
    async getCapabilities() {
      const isNative = isCapacitorNative(win);
      const platform = getCapacitorPlatform(win);
      return {
        supported: false,
        platform,
        isNative,
        apiLevel: 0,
        maxSlots: QUICK_TILE_MAX_SLOTS,
        supportsRequestAddTileService: false,
        isDeviceLocked: false,
        allowOnLockScreen: memoryConfig.allowOnLockScreen,
        pickerRequiresUnlockOnLockedScreen: true,
      };
    },

    async syncConfiguration({ config } = {}) {
      if (config && typeof config === 'object') {
        memoryConfig = config;
      }
      return { synced: true, nativeApplied: false };
    },

    async syncActiveTimer({ activeTimer = null, updatedAt = Date.now() } = {}) {
      if (Number(updatedAt) >= memoryTimerUpdatedAt) {
        memoryTimer = activeTimer;
        memoryTimerUpdatedAt = Number(updatedAt) || Date.now();
      }
      return { synced: true, nativeApplied: false };
    },

    async getPendingSyncSnapshot() {
      return {
        activeTimer: memoryTimer,
        activeTimerUpdatedAt: memoryTimerUpdatedAt,
        pendingEntries: [],
        lastMutationTs: memoryTimerUpdatedAt,
        pendingLaunchAction: null,
      };
    },

    async acknowledgePendingEntries({ entryIds = [] } = {}) {
      return { acknowledgedCount: Array.isArray(entryIds) ? entryIds.length : 0 };
    },

    async requestAddTile() {
      return {
        status: 'unsupported',
        message: 'L’ajout direct de tuiles Réglages rapides est disponible sur l’application Android (Android 13+).',
      };
    },

    async refreshTiles() {
      return { refreshed: false };
    },

    async addListener() {
      return { remove: async () => {} };
    },
  };
}

let defaultRegisteredPlugin = null;

function getDefaultRegisteredPlugin() {
  if (!defaultRegisteredPlugin) {
    defaultRegisteredPlugin = registerPlugin('QuickTimerTiles', {
      web: () => Promise.resolve(createWebFallbackPlugin()),
    });
  }
  return defaultRegisteredPlugin;
}

/**
 * Creates a clean bridge adapter for UI and app lifecycle hooks.
 */
export function createQuickTilesBridge({
  plugin = null,
  win = typeof window !== 'undefined' ? window : null,
} = {}) {
  const isNativeAndroid = isCapacitorNative(win) && getCapacitorPlatform(win) === 'android';
  const target = plugin || (isNativeAndroid ? getDefaultRegisteredPlugin() : createWebFallbackPlugin(win));

  return {
    isNativeAndroid,

    async getCapabilities() {
      try {
        return await target.getCapabilities();
      } catch {
        return {
          supported: false,
          platform: getCapacitorPlatform(win),
          isNative: isCapacitorNative(win),
          apiLevel: 0,
          maxSlots: QUICK_TILE_MAX_SLOTS,
          supportsRequestAddTileService: false,
          isDeviceLocked: false,
          allowOnLockScreen: true,
          pickerRequiresUnlockOnLockedScreen: true,
        };
      }
    },

    async syncConfiguration(payload) {
      try {
        return await target.syncConfiguration(payload);
      } catch {
        return { synced: false, nativeApplied: false };
      }
    },

    async syncActiveTimer(payload) {
      try {
        return await target.syncActiveTimer(payload);
      } catch {
        return { synced: false, nativeApplied: false };
      }
    },

    async getPendingSyncSnapshot() {
      try {
        return await target.getPendingSyncSnapshot();
      } catch {
        return {
          activeTimer: null,
          activeTimerUpdatedAt: 0,
          pendingEntries: [],
          lastMutationTs: 0,
          pendingLaunchAction: null,
        };
      }
    },

    async acknowledgePendingEntries(entryIds) {
      if (!Array.isArray(entryIds) || !entryIds.length) {
        return { acknowledgedCount: 0 };
      }
      try {
        return await target.acknowledgePendingEntries({ entryIds });
      } catch {
        return { acknowledgedCount: 0 };
      }
    },

    async requestAddTile(slot) {
      try {
        return await target.requestAddTile({ slot: Number(slot) });
      } catch (err) {
        return { status: 'error', message: err?.message || 'Impossible de demander l’ajout de la tuile.' };
      }
    },

    async refreshTiles() {
      try {
        return await target.refreshTiles();
      } catch {
        return { refreshed: false };
      }
    },

    async addListener(eventName, handler) {
      if (typeof target.addListener !== 'function') {
        return { remove: async () => {} };
      }
      try {
        return await target.addListener(eventName, handler);
      } catch {
        return { remove: async () => {} };
      }
    },
  };
}
