import { describe, it, expect, vi } from 'vitest';
import {
  DRIVE_APPDATA_SCOPE,
  DRIVE_ENDPOINTS,
  syncWithGoogleDrive,
} from '../src/core/sync/drive-sync.js';
import { serializeSyncPayload } from '../src/core/sync/crdt-merge.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

describe('Google Drive appDataFolder sync', () => {
  it('uploads a new sync file into appDataFolder when none exists remotely', async () => {
    const authClient = {
      ensureAccessToken: vi.fn().mockResolvedValue('drive-tok-1'),
    };
    const fetchImpl = vi
      .fn()
      // 1. findDriveSyncFile -> empty
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ files: [] }),
      })
      // 2. uploadDriveSyncFile (POST)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'drive-file-1', modifiedTime: '2026-11-15T10:00:00Z' }),
      });

    const applyMergedPayload = vi.fn();
    const res = await syncWithGoogleDrive({
      authClient,
      fetchImpl,
      getLocalPayload: () => ({
        deviceId: 'dev-1',
        entries: [{ id: 'e1', activity: 'Code', categoryId: 'travail', date: '2026-11-15', start: '09:00', end: '10:00', mins: 60, updatedAt: 100 }],
        activities: [],
        categories: DEFAULT_CATEGORIES,
        tombstones: {},
      }),
      applyMergedPayload,
    });

    expect(authClient.ensureAccessToken).toHaveBeenCalledWith({
      scope: DRIVE_APPDATA_SCOPE,
      prompt: '',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`${DRIVE_ENDPOINTS.files}?spaces=appDataFolder`),
      expect.objectContaining({ headers: { Authorization: 'Bearer drive-tok-1' } })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`${DRIVE_ENDPOINTS.upload}?uploadType=multipart`),
      expect.objectContaining({ method: 'POST' })
    );
    expect(applyMergedPayload).not.toHaveBeenCalled();
    expect(res.hadRemote).toBe(false);
    expect(res.fileId).toBe('drive-file-1');
    expect(res.counts.entries).toBe(1);
  });

  it('downloads, CRDT-merges, applies locally, and patches existing Drive sync file', async () => {
    const authClient = {
      ensureAccessToken: vi.fn().mockResolvedValue('drive-tok-2'),
    };
    const remoteSerialized = serializeSyncPayload({
      deviceId: 'phone',
      entries: [
        { id: 'e-remote', activity: 'Lecture', categoryId: 'loisirs', date: '2026-11-15', start: '20:00', end: '20:30', mins: 30, updatedAt: 900 },
      ],
      activities: [],
      categories: DEFAULT_CATEGORIES,
    });

    const fetchImpl = vi
      .fn()
      // 1. findDriveSyncFile
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ files: [{ id: 'existing-file-9', name: 'timetracker-sync.json' }] }),
      })
      // 2. downloadDriveSyncFile
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(remoteSerialized),
      })
      // 3. uploadDriveSyncFile (PATCH)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'existing-file-9' }),
      });

    const applyMergedPayload = vi.fn().mockResolvedValue(undefined);
    const res = await syncWithGoogleDrive({
      authClient,
      fetchImpl,
      getLocalPayload: () => ({
        deviceId: 'desktop',
        entries: [
          { id: 'e-local', activity: 'Code', categoryId: 'travail', date: '2026-11-15', start: '09:00', end: '10:00', mins: 60, updatedAt: 500 },
        ],
        activities: [],
        categories: DEFAULT_CATEGORIES,
        tombstones: {},
      }),
      applyMergedPayload,
    });

    expect(res.hadRemote).toBe(true);
    expect(res.counts.entries).toBe(2);
    expect(applyMergedPayload).toHaveBeenCalledTimes(1);
    const mergedArg = applyMergedPayload.mock.calls[0][0];
    expect(mergedArg.entries.map(e => e.id).sort()).toEqual(['e-local', 'e-remote']);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(`${DRIVE_ENDPOINTS.upload}/existing-file-9?uploadType=multipart`),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});
