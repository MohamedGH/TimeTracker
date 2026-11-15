import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

function createBaseState(overrides = {}) {
  return {
    entries: [],
    activities: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    activeTimer: null,
    authUser: null,
    tab: 'entry',
    period: '7',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    ...overrides,
  };
}

describe('Multi-device sync UI integration (Drive & P2P)', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('triggers Google Drive sync and toggles auto-sync from UI', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    let meta = { deviceId: 'dev-1', lastDriveSyncAt: null, driveAutoSync: false, lastP2pSyncAt: null };
    const saveSyncMeta = vi.fn(async (patch) => {
      meta = { ...meta, ...patch };
      return meta;
    });
    const driveSyncFn = vi.fn().mockResolvedValue({
      syncedAt: '2026-11-15T12:00:00.000Z',
      fileId: 'drive-1',
      hadRemote: true,
      counts: { entries: 3, activities: 1, categories: 8 },
    });

    const ui = createUI({
      root,
      state: createBaseState(),
      persist: vi.fn().mockResolvedValue(undefined),
      getSyncMeta: () => meta,
      saveSyncMeta,
      driveSyncFn,
      authClient: { isConfigured: () => true, signOut: vi.fn() },
    });

    const syncBtn = root.querySelector('[data-behavior-target="sync-drive-run"]');
    expect(syncBtn).toBeTruthy();
    syncBtn.click();

    await vi.waitFor(() => {
      expect(driveSyncFn).toHaveBeenCalledTimes(1);
      expect(saveSyncMeta).toHaveBeenCalledWith({ lastDriveSyncAt: '2026-11-15T12:00:00.000Z' });
    });

    const autoCheck = root.querySelector('.sync-auto-toggle input[type="checkbox"]');
    autoCheck.checked = true;
    autoCheck.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(meta.driveAutoSync).toBe(true);
    });

    ui.destroy();
    root.remove();
  });

  it('switches to P2P Direct tab and executes offer creation flow', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    let snap = {
      status: 'idle',
      offerCode: '',
      answerCode: '',
      lastSyncedAt: null,
      lastError: null,
      isConnected: false,
    };
    let onStateChangeCb = () => {};

    const p2pManagerFactory = ({ onStateChange }) => {
      onStateChangeCb = onStateChange;
      return {
        getSnapshot: () => snap,
        createOffer: vi.fn(async () => {
          snap = { ...snap, status: 'awaiting_answer', offerCode: 'TT1:FAKE_OFFER' };
          onStateChangeCb(snap);
          return snap.offerCode;
        }),
        acceptOfferAndCreateAnswer: vi.fn(),
        acceptAnswer: vi.fn(),
        syncNow: vi.fn(),
        disconnect: vi.fn(),
      };
    };

    const ui = createUI({
      root,
      state: createBaseState(),
      persist: vi.fn().mockResolvedValue(undefined),
      p2pManagerFactory,
      authClient: { isConfigured: () => true, signOut: vi.fn() },
    });

    root.querySelector('[data-behavior-target="sync-tab-p2p"]').click();
    const createOfferBtn = root.querySelector('[data-behavior-target="p2p-create-offer"]');
    expect(createOfferBtn).toBeTruthy();
    createOfferBtn.click();

    await vi.waitFor(() => {
      expect(root.querySelector('.sync-token-textarea')?.value).toBe('TT1:FAKE_OFFER');
    });

    ui.destroy();
    root.remove();
  });
});
