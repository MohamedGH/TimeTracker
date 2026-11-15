/**
 * Option 1: Serverless multi-device persistence via Google Drive appDataFolder.
 * Uses the user's direct Google OAuth 2.0 access token (scope drive.appdata)
 * without any custom backend server.
 */

import {
  mergeSyncPayloads,
  parseSyncPayload,
  serializeSyncPayload,
} from './crdt-merge.js';

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DRIVE_SYNC_FILENAME = 'timetracker-sync.json';

export const DRIVE_ENDPOINTS = Object.freeze({
  files: 'https://www.googleapis.com/drive/v3/files',
  upload: 'https://www.googleapis.com/upload/drive/v3/files',
});

export function buildDriveMultipartBody({ metadata, contentJson, boundary }) {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    contentJson,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export async function findDriveSyncFile({ accessToken, fetchImpl = globalThis.fetch, fileName = DRIVE_SYNC_FILENAME }) {
  const query = encodeURIComponent(`name='${fileName}' and trashed=false`);
  const url = `${DRIVE_ENDPOINTS.files}?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&pageSize=1`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Impossible de consulter Google Drive appDataFolder (HTTP ${res.status}).`);
  }

  const data = await res.json();
  const files = Array.isArray(data?.files) ? data.files : [];
  return files[0] || null;
}

export async function downloadDriveSyncFile({ fileId, accessToken, fetchImpl = globalThis.fetch }) {
  const url = `${DRIVE_ENDPOINTS.files}/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Impossible de télécharger la sauvegarde Drive (HTTP ${res.status}).`);
  }

  const text = await res.text();
  return parseSyncPayload(text);
}

export async function uploadDriveSyncFile({
  payload,
  accessToken,
  existingFileId = null,
  fetchImpl = globalThis.fetch,
  fileName = DRIVE_SYNC_FILENAME,
}) {
  const boundary = `tt_sync_${Date.now().toString(36)}`;
  const metadata = existingFileId
    ? { name: fileName, mimeType: 'application/json' }
    : { name: fileName, parents: ['appDataFolder'], mimeType: 'application/json' };

  const body = buildDriveMultipartBody({
    metadata,
    contentJson: JSON.stringify(payload),
    boundary,
  });

  const url = existingFileId
    ? `${DRIVE_ENDPOINTS.upload}/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,modifiedTime`
    : `${DRIVE_ENDPOINTS.upload}?uploadType=multipart&fields=id,modifiedTime`;

  const res = await fetchImpl(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Impossible d’enregistrer la sauvegarde sur Google Drive (HTTP ${res.status}).`);
  }

  return res.json();
}

export async function syncWithGoogleDrive({
  authClient,
  getLocalPayload,
  applyMergedPayload,
  fetchImpl = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
  fileName = DRIVE_SYNC_FILENAME,
} = {}) {
  if (!authClient) {
    throw new Error('Client d’authentification Google indisponible.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('API fetch indisponible pour synchroniser avec Google Drive.');
  }

  const accessToken = await authClient.ensureAccessToken({
    scope: DRIVE_APPDATA_SCOPE,
    prompt: '',
  });

  const localRaw = getLocalPayload();
  const remoteFile = await findDriveSyncFile({ accessToken, fetchImpl, fileName });

  let merged;
  let hadRemote = false;

  if (remoteFile?.id) {
    const remoteRaw = await downloadDriveSyncFile({
      fileId: remoteFile.id,
      accessToken,
      fetchImpl,
    });
    merged = mergeSyncPayloads(localRaw, remoteRaw);
    hadRemote = true;
    await applyMergedPayload(merged);
  } else {
    merged = mergeSyncPayloads(localRaw, {
      entries: [],
      activities: [],
      categories: [],
      tombstones: {},
    });
  }

  const serialized = serializeSyncPayload({
    entries: merged.entries,
    activities: merged.activities,
    categories: merged.categories,
    tombstones: merged.tombstones,
    deviceId: localRaw.deviceId || 'local',
  });

  const uploaded = await uploadDriveSyncFile({
    payload: serialized,
    accessToken,
    existingFileId: remoteFile?.id || null,
    fetchImpl,
    fileName,
  });

  return {
    syncedAt: new Date().toISOString(),
    fileId: uploaded?.id || remoteFile?.id || null,
    hadRemote,
    counts: {
      entries: merged.entries.length,
      activities: merged.activities.length,
      categories: merged.categories.length,
    },
  };
}
