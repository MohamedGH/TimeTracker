import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';
import { createStateManager } from '../src/core/state-manager.js';
import {
  collectAvailableTileActivities,
  normalizeQuickTilesConfig,
  suggestFavoriteQuickTiles,
  assignActivityToQuickTile,
  clearQuickTileSlot,
  toggleQuickTileSlotEnabled,
  setAllowOnLockScreen,
  applyTileTapTransition,
  reconcileNativeTimerSnapshot,
  createQuickTilesBridge,
} from '../src/core/mobile/index.js';
import { createUI } from '../src/ui.js';

function createBaseState(overrides = {}) {
  return {
    entries: [],
    activities: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    activeTimer: null,
    timerUpdatedAt: 0,
    quickTilesConfig: undefined,
    authUser: null,
    tab: 'entry',
    period: '7',
    shortcutCategoryFilter: 'all',
    deviceType: 'mobile',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    ...overrides,
  };
}

/**
 * In-memory Android QuickTimerRepository simulator for end-to-end integration tests:
 * reproduces lock-screen taps, force-close & restart, atomic tile switches, and pending entry ack.
 */
function createSimulatedAndroidTileBridge({
  apiLevel = 34,
  isDeviceLocked = true,
  initialSnapshot = null,
} = {}) {
  let config = { allowOnLockScreen: true, slots: [] };
  let activeTimer = initialSnapshot?.activeTimer || null;
  let activeTimerUpdatedAt = initialSnapshot?.activeTimerUpdatedAt || 0;
  let pendingEntries = Array.isArray(initialSnapshot?.pendingEntries)
    ? [...initialSnapshot.pendingEntries]
    : [];
  let pendingLaunchAction = initialSnapshot?.pendingLaunchAction || null;
  const listeners = new Map();

  const plugin = {
    getCapabilities: vi.fn(async () => ({
      supported: true,
      platform: 'android',
      isNative: true,
      apiLevel,
      maxSlots: 6,
      supportsRequestAddTileService: apiLevel >= 33,
      isDeviceLocked,
      allowOnLockScreen: config.allowOnLockScreen,
      pickerRequiresUnlockOnLockedScreen: true,
    })),
    syncConfiguration: vi.fn(async ({ config: nextCfg } = {}) => {
      if (nextCfg) config = nextCfg;
      return { synced: true, nativeApplied: true };
    }),
    syncActiveTimer: vi.fn(async ({ activeTimer: timer, updatedAt } = {}) => {
      if ((updatedAt || 0) >= activeTimerUpdatedAt) {
        activeTimer = timer || null;
        activeTimerUpdatedAt = updatedAt || Date.now();
      }
      return { synced: true, nativeApplied: true };
    }),
    getPendingSyncSnapshot: vi.fn(async () => ({
      activeTimer,
      activeTimerUpdatedAt,
      pendingEntries: [...pendingEntries],
      lastMutationTs: activeTimerUpdatedAt,
      pendingLaunchAction,
    })),
    acknowledgePendingEntries: vi.fn(async ({ entryIds = [] } = {}) => {
      const ackSet = new Set(entryIds);
      const before = pendingEntries.length;
      pendingEntries = pendingEntries.filter(e => !ackSet.has(e.id));
      return { acknowledgedCount: before - pendingEntries.length };
    }),
    requestAddTile: vi.fn(async () => ({ status: 'added', resultCode: 2 })),
    refreshTiles: vi.fn(async () => ({ refreshed: true })),
    addListener: vi.fn(async (eventName, fn) => {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(fn);
      return {
        remove: async () => listeners.get(eventName)?.delete(fn),
      };
    }),
  };

  function emit(eventName, payload = {}) {
    listeners.get(eventName)?.forEach(fn => fn(payload));
  }

  function simulateNativeTileTap(slotNumber, nowMs = Date.now(), { locked = isDeviceLocked } = {}) {
    const slot = (config.slots || []).find(s => s.slot === slotNumber);
    if (!slot?.activity) {
      pendingLaunchAction = 'open_quick_tiles_config';
      emit('openQuickTilesConfig', { slot: slotNumber });
      return { action: 'open_config' };
    }
    if (locked && !config.allowOnLockScreen) {
      return { action: 'unlock_required' };
    }
    const transition = applyTileTapTransition({
      activeTimer,
      nowMs,
      tileActivity: slot.activity,
      tileCategoryId: slot.categoryId,
      entryId: `native-${slotNumber}-${nowMs}`,
    });
    activeTimer = transition.activeTimer;
    activeTimerUpdatedAt = transition.transitionTs;
    if (transition.producedEntry) {
      pendingEntries.push(transition.producedEntry);
    }
    emit('nativeTimerStateChanged', { activeTimerUpdatedAt });
    return transition;
  }

  return {
    plugin,
    factory: () => createQuickTilesBridge({
      plugin,
      win: {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'android',
        },
      },
    }),
    simulateNativeTileTap,
    clearLaunchAction: () => { pendingLaunchAction = null; },
    getInternalState: () => ({ config, activeTimer, activeTimerUpdatedAt, pendingEntries }),
  };
}

describe('Quick Settings Tiles domain & reconciliation', () => {
  it('collects only real activities from TimeTracker without inventing hardcoded activities', () => {
    expect(collectAvailableTileActivities({ activities: [], entries: [], categories: DEFAULT_CATEGORIES })).toEqual([]);

    const available = collectAvailableTileActivities({
      activities: [
        { id: 'a1', label: 'Deep Work', categoryId: 'travail', useCount: 5 },
        { id: 'a2', label: 'Course à pied', categoryId: 'sport', useCount: 2 },
      ],
      entries: [
        { id: 'e1', activity: 'Lecture', categoryId: 'etude', date: '2026-11-17', start: '18:00', end: '18:45', mins: 45 },
      ],
      categories: DEFAULT_CATEGORIES,
    });

    expect(available.map(a => a.activity)).toEqual(['Deep Work', 'Course à pied', 'Lecture']);
    expect(available[0].categoryLabel).toBe('Travail');
    expect(available[2].isSaved).toBe(false);
  });

  it('starts, stops, and atomically switches activities across independent tiles without overlap or duplicates', () => {
    const t0 = new Date(2026, 10, 18, 9, 0, 0).getTime();
    const t1 = new Date(2026, 10, 18, 10, 15, 0).getTime();
    const t2 = new Date(2026, 10, 18, 11, 0, 0).getTime();

    // 1. Start Travail from tile #1
    const s1 = applyTileTapTransition({
      activeTimer: null,
      nowMs: t0,
      tileActivity: 'Travail',
      tileCategoryId: 'travail',
    });
    expect(s1.action).toBe('started');
    expect(s1.producedEntry).toBeNull();
    expect(s1.activeTimer.activity).toBe('Travail');
    expect(s1.activeTimer.startTime).toBe('09:00');

    // 2. Tap Étude on tile #2 while Travail is active -> atomic transition at t1
    const s2 = applyTileTapTransition({
      activeTimer: s1.activeTimer,
      nowMs: t1,
      tileActivity: 'Étude',
      tileCategoryId: 'etude',
      entryId: 'entry-work-1',
    });
    expect(s2.action).toBe('switched');
    expect(s2.producedEntry).toMatchObject({
      id: 'entry-work-1',
      activity: 'Travail',
      categoryId: 'travail',
      start: '09:00',
      end: '10:15',
      mins: 75,
      viaTimer: true,
    });
    expect(s2.activeTimer).toMatchObject({
      activity: 'Étude',
      categoryId: 'etude',
      startTs: t1,
      startTime: '10:15',
    });

    // 3. Tap Étude again on tile #2 -> stops active timer cleanly
    const s3 = applyTileTapTransition({
      activeTimer: s2.activeTimer,
      nowMs: t2,
      tileActivity: 'Étude',
      tileCategoryId: 'etude',
      entryId: 'entry-study-2',
    });
    expect(s3.action).toBe('stopped');
    expect(s3.activeTimer).toBeNull();
    expect(s3.producedEntry).toMatchObject({
      id: 'entry-study-2',
      activity: 'Étude',
      categoryId: 'etude',
      start: '10:15',
      end: '11:00',
      mins: 45,
      viaTimer: true,
    });
  });

  it('handles cross-midnight durations and process restart timestamps accurately', () => {
    const tStart = new Date(2026, 10, 18, 23, 40, 0).getTime();
    const tEnd = new Date(2026, 10, 19, 0, 25, 0).getTime();

    const started = applyTileTapTransition({
      activeTimer: null,
      nowMs: tStart,
      tileActivity: 'Sommeil',
      tileCategoryId: 'sommeil',
    });

    const stopped = applyTileTapTransition({
      activeTimer: started.activeTimer,
      nowMs: tEnd,
      tileActivity: 'Sommeil',
      tileCategoryId: 'sommeil',
      entryId: 'midnight-entry',
    });

    expect(stopped.producedEntry).toMatchObject({
      date: '2026-11-18',
      start: '23:40',
      endDate: '2026-11-19',
      end: '00:25',
      mins: 45,
      viaTimer: true,
    });
  });

  it('reconciles native pending entries & active timer into TimeTracker without duplicates', () => {
    const tStart = new Date(2026, 10, 18, 14, 0, 0).getTime();
    const tSwitch = new Date(2026, 10, 18, 14, 30, 0).getTime();

    const baseState = {
      entries: [
        {
          id: 'already-imported',
          activity: 'Travail',
          categoryId: 'travail',
          date: '2026-11-18',
          start: '08:00',
          end: '09:00',
          mins: 60,
          viaTimer: true,
        },
      ],
      activities: [
        { id: 'act-work', label: 'Travail', categoryId: 'travail', useCount: 1, lastUsedAt: null },
        { id: 'act-sport', label: 'Sport', categoryId: 'sport', useCount: 2, lastUsedAt: null },
      ],
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
      activeTimer: null,
      timerUpdatedAt: 1000,
    };

    const nativeSnapshot = {
      activeTimer: {
        activity: 'Sport',
        categoryId: 'sport',
        startTs: tSwitch,
        startTime: '14:30',
        date: '2026-11-18',
      },
      activeTimerUpdatedAt: tSwitch,
      pendingEntries: [
        {
          id: 'already-imported', // Duplicate guard test
          activity: 'Travail',
          categoryId: 'travail',
          date: '2026-11-18',
          start: '08:00',
          end: '09:00',
          mins: 60,
          viaTimer: true,
        },
        {
          id: 'native-new-1',
          activity: 'Travail',
          categoryId: 'travail',
          date: '2026-11-18',
          start: '14:00',
          end: '14:30',
          endDate: '2026-11-18',
          mins: 30,
          viaTimer: true,
          startTs: tStart,
          endTs: tSwitch,
        },
      ],
    };

    const reconciled = reconcileNativeTimerSnapshot({ state: baseState, nativeSnapshot });
    expect(reconciled.changed).toBe(true);
    expect(reconciled.entries).toHaveLength(2);
    expect(reconciled.entries[0]).toMatchObject({
      id: 'native-new-1',
      activity: 'Travail',
      mins: 30,
      viaTimer: true,
    });
    expect(reconciled.activeTimer).toMatchObject({
      activity: 'Sport',
      categoryId: 'sport',
      startTs: tSwitch,
    });
    expect(reconciled.importedEntryIds).toEqual(['already-imported', 'native-new-1']);

    // Re-running reconciliation on same snapshot causes zero duplicates
    const secondPass = reconcileNativeTimerSnapshot({
      state: { ...baseState, ...reconciled },
      nativeSnapshot,
    });
    expect(secondPass.changed).toBe(false);
    expect(secondPass.entries).toHaveLength(2);
  });

  it('persists quickTilesConfig & reconciles via StateManager', async () => {
    const persistFn = vi.fn().mockResolvedValue(undefined);
    const sm = createStateManager({
      initialState: {
        activities: [{ id: 'a1', label: 'Travail', categoryId: 'travail', useCount: 3 }],
      },
      persistFn,
    });

    const suggested = suggestFavoriteQuickTiles(sm.getState(), 4);
    const nextConfig = setAllowOnLockScreen(
      assignActivityToQuickTile(
        toggleQuickTileSlotEnabled(normalizeQuickTilesConfig({ slots: suggested }), 5, true),
        1,
        { activity: 'Travail', categoryId: 'travail', categoryLabel: 'Travail' },
      ),
      true,
    );

    sm.actions.setQuickTilesConfig(nextConfig);
    expect(sm.getState().quickTilesConfig.slots[0].activity).toBe('Travail');
    expect(sm.getState().quickTilesConfig.slots[4].enabled).toBe(true);
    expect(persistFn).toHaveBeenCalledTimes(1);

    const cleared = clearQuickTileSlot(sm.getState().quickTilesConfig, 1);
    expect(cleared.slots[0].activity).toBeNull();
  });
});

describe('Quick Settings Tiles UI & Android lock-screen integration', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('configures tiles from real TimeTracker activities, syncs to Android, and handles lock-screen cycles after force close', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const sim = createSimulatedAndroidTileBridge({ apiLevel: 34, isDeviceLocked: true });
    const persist = vi.fn().mockResolvedValue(undefined);
    const state = createBaseState({
      activities: [
        { id: 'a-work', label: 'Travail', categoryId: 'travail', useCount: 8 },
        { id: 'a-study', label: 'Étude', categoryId: 'etude', useCount: 5 },
        { id: 'a-sport', label: 'Sport', categoryId: 'sport', useCount: 4 },
        { id: 'a-leisure', label: 'Loisirs', categoryId: 'loisirs', useCount: 3 },
      ],
    });

    const ui = createUI({
      root,
      state,
      persist,
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      quickTilesBridgeFactory: sim.factory,
    });

    // Wait for initial capability check & native sync
    await vi.waitFor(() => {
      expect(sim.plugin.getCapabilities).toHaveBeenCalled();
      expect(root.textContent).toContain('TileService Android actif');
    });

    // Click autofill from frequent real activities
    const autofillBtn = root.querySelector('[data-behavior-target="quick-tiles-autofill"]');
    expect(autofillBtn).toBeTruthy();
    autofillBtn.click();

    await vi.waitFor(() => {
      expect(state.quickTilesConfig.slots[0].activity).toBe('Travail');
      expect(state.quickTilesConfig.slots[1].activity).toBe('Étude');
      expect(state.quickTilesConfig.slots[2].activity).toBe('Sport');
      expect(state.quickTilesConfig.slots[3].activity).toBe('Loisirs');
    });

    // Android 13+ direct Add Tile button is rendered and triggers StatusBarManager request
    let addSlot1Btn = null;
    await vi.waitFor(() => {
      addSlot1Btn = root.querySelector('[data-quick-tile-slot-add="1"]');
      expect(addSlot1Btn).toBeTruthy();
    });
    addSlot1Btn.click();
    await vi.waitFor(() => {
      expect(sim.plugin.requestAddTile).toHaveBeenCalledWith({ slot: 1 });
    });

    // Simulate app killed (destroy UI) while lock-screen tiles are tapped multiple times!
    ui.destroy();
    root.remove();

    const t0 = new Date(2026, 10, 18, 16, 0, 0).getTime();
    const t1 = new Date(2026, 10, 18, 16, 40, 0).getTime();
    const t2 = new Date(2026, 10, 18, 17, 10, 0).getTime();

    // Locked phone: tap Tile #1 (Travail) -> Tile #3 (Sport) -> Tile #3 (Stop) -> Tile #2 (Étude running)
    expect(sim.simulateNativeTileTap(1, t0, { locked: true }).action).toBe('started');
    expect(sim.simulateNativeTileTap(3, t1, { locked: true }).action).toBe('switched');
    expect(sim.simulateNativeTileTap(3, t2, { locked: true }).action).toBe('stopped');
    expect(sim.simulateNativeTileTap(2, t2 + 60_000, { locked: true }).action).toBe('started');

    // Reopen app after force close: persisted entries + new UI reconcile from native repository
    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    const ui2 = createUI({
      root: root2,
      state,
      persist,
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      quickTilesBridgeFactory: sim.factory,
    });

    await vi.waitFor(() => {
      expect(state.entries).toHaveLength(2);
      expect(state.activeTimer?.activity).toBe('Étude');
      expect(sim.plugin.acknowledgePendingEntries).toHaveBeenCalled();
    });

    expect(state.entries[0]).toMatchObject({ activity: 'Sport', mins: 30, viaTimer: true });
    expect(state.entries[1]).toMatchObject({ activity: 'Travail', mins: 40, viaTimer: true });
    expect(sim.getInternalState().pendingEntries).toHaveLength(0);
    expect(root2.querySelector('[data-quick-tile-slot="2"] .quick-tile-active-badge')).toBeTruthy();

    ui2.destroy();
    root2.remove();
  });

  it('respects lock-screen restriction when user disables allowOnLockScreen', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const sim = createSimulatedAndroidTileBridge({ apiLevel: 34, isDeviceLocked: true });
    const state = createBaseState({
      activities: [{ id: 'a1', label: 'Travail', categoryId: 'travail', useCount: 1 }],
    });

    const ui = createUI({
      root,
      state,
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      quickTilesBridgeFactory: sim.factory,
    });

    await vi.waitFor(() => expect(sim.plugin.getCapabilities).toHaveBeenCalled());

    // Map tile 1 manually via select
    const select1 = root.querySelector('[data-quick-tile-slot-select="1"]');
    select1.value = 'a1';
    select1.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(sim.getInternalState().config.slots?.[0]?.activity).toBe('Travail');
    });

    // Disable lock-screen usage
    const lockToggle = root.querySelector('[data-quick-tiles-lockscreen]');
    lockToggle.checked = false;
    lockToggle.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(sim.getInternalState().config.allowOnLockScreen).toBe(false);
    });

    // Tap while locked -> requires unlock instead of starting silently
    const lockedRes = sim.simulateNativeTileTap(1, Date.now(), { locked: true });
    expect(lockedRes.action).toBe('unlock_required');
    expect(sim.getInternalState().activeTimer).toBeNull();

    // Tap after unlock -> starts normally
    const unlockedRes = sim.simulateNativeTileTap(1, Date.now(), { locked: false });
    expect(unlockedRes.action).toBe('started');

    ui.destroy();
    root.remove();
  });

  it('opens quick-tiles section on cold start when native snapshot holds pendingLaunchAction and queues concurrent reconciliations', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    window.location.hash = '#dashboard';

    const sim = createSimulatedAndroidTileBridge({
      apiLevel: 34,
      isDeviceLocked: false,
      initialSnapshot: {
        pendingLaunchAction: 'open_quick_tiles_config',
      },
    });
    const state = createBaseState({
      tab: 'dashboard',
      activities: [{ id: 'a1', label: 'Travail', categoryId: 'travail', useCount: 1 }],
    });

    const ui = createUI({
      root,
      state,
      persist: vi.fn().mockResolvedValue(undefined),
      authClient: { isConfigured: () => false, signOut: vi.fn() },
      quickTilesBridgeFactory: sim.factory,
    });

    await vi.waitFor(() => {
      expect(state.tab).toBe('entry');
      expect(root.querySelector('#quick-tiles-card')).toBeTruthy();
    });

    // Clear initial launch action and map slot 1
    sim.clearLaunchAction();
    const select1 = root.querySelector('[data-quick-tile-slot-select="1"]');
    select1.value = 'a1';
    select1.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(sim.getInternalState().config.slots?.[0]?.activity).toBe('Travail');
    });

    // Trigger overlapping native taps while reconcileFromNative runs concurrently
    const t0 = new Date(2026, 10, 18, 12, 0, 0).getTime();
    const t1 = t0 + 15 * 60_000;
    const p1 = ui.reconcileFromNative();
    sim.simulateNativeTileTap(1, t0, { locked: false });
    sim.simulateNativeTileTap(1, t1, { locked: false });
    const p2 = ui.reconcileFromNative();
    await Promise.all([p1, p2]);

    await vi.waitFor(() => {
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0]).toMatchObject({ activity: 'Travail', mins: 15, viaTimer: true });
      expect(state.activeTimer).toBeNull();
    });

    ui.destroy();
    root.remove();
  });
});
