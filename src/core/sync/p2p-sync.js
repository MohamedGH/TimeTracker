/**
 * Option 2: Serverless direct Peer-to-Peer synchronization over WebRTC DataChannel
 * (plus same-device BroadcastChannel support) using CRDT LWW + Tombstone merges.
 */

import {
  mergeSyncPayloads,
  parseSyncPayload,
  serializeSyncPayload,
} from './crdt-merge.js';

export const SIGNAL_PREFIX = 'TT1:';
export const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]);

const DEFAULT_CHUNK_SIZE = 14000;

export function encodeSignalToken(sessionDescription) {
  if (!sessionDescription?.type || !sessionDescription?.sdp) {
    throw new Error('Description SDP WebRTC invalide.');
  }
  const payload = JSON.stringify({
    t: sessionDescription.type,
    s: sessionDescription.sdp,
  });
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${SIGNAL_PREFIX}${b64url}`;
}

export function decodeSignalToken(rawToken) {
  const trimmed = String(rawToken || '').trim();
  if (!trimmed.startsWith(SIGNAL_PREFIX)) {
    throw new Error('Code de connexion P2P invalide (préfixe TT1: attendu).');
  }
  const segment = trimmed.slice(SIGNAL_PREFIX.length);
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const binary = atob(normalized + '='.repeat(padLen));
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed?.t || !parsed?.s) {
      throw new Error('Champs SDP manquants.');
    }
    return { type: parsed.t, sdp: parsed.s };
  } catch {
    throw new Error('Impossible de décoder le code de connexion P2P.');
  }
}

export function chunkSyncPayload(payload, chunkSize = DEFAULT_CHUNK_SIZE, transferId = `tx_${Date.now().toString(36)}`) {
  const json = JSON.stringify(payload);
  const total = Math.max(1, Math.ceil(json.length / chunkSize));
  const frames = [];
  for (let i = 0; i < total; i += 1) {
    frames.push(JSON.stringify({
      kind: 'sync-chunk',
      transferId,
      index: i,
      total,
      data: json.slice(i * chunkSize, (i + 1) * chunkSize),
    }));
  }
  return frames;
}

export function createChunkReassembler(onComplete) {
  const pending = new Map();

  return (rawMessage) => {
    let frame;
    try {
      frame = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
    } catch {
      return;
    }
    if (!frame || frame.kind !== 'sync-chunk' || !frame.transferId) return;

    let entry = pending.get(frame.transferId);
    if (!entry) {
      entry = { total: Number(frame.total) || 1, parts: new Array(Number(frame.total) || 1), received: 0 };
      pending.set(frame.transferId, entry);
    }

    if (entry.parts[frame.index] === undefined) {
      entry.parts[frame.index] = String(frame.data || '');
      entry.received += 1;
    }

    if (entry.received >= entry.total) {
      pending.delete(frame.transferId);
      const joined = entry.parts.join('');
      const parsed = parseSyncPayload(joined);
      onComplete(parsed);
    }
  };
}

function waitForIceGathering(pc, timeoutMs = 2500) {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener?.('icegatheringstatechange', onState);
      clearTimeout(timer);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener?.('icegatheringstatechange', onState);
  });
}

export function createP2PSyncManager({
  getLocalPayload,
  applyMergedPayload,
  onStateChange = () => {},
  rtcFactory = (config) => {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC (RTCPeerConnection) non supporté sur ce navigateur.');
    }
    return new RTCPeerConnection(config);
  },
  iceServers = DEFAULT_ICE_SERVERS,
  iceGatherTimeoutMs = 2500,
} = {}) {
  let pc = null;
  let channel = null;
  let status = 'idle'; // 'idle' | 'creating_offer' | 'awaiting_answer' | 'awaiting_connection' | 'connected' | 'error'
  let offerCode = '';
  let answerCode = '';
  let lastSyncedAt = null;
  let lastError = null;
  let sending = false;

  const emitState = () => {
    onStateChange(getSnapshot());
  };

  function getSnapshot() {
    return {
      status,
      offerCode,
      answerCode,
      lastSyncedAt,
      lastError,
      isConnected: status === 'connected' && channel?.readyState === 'open',
    };
  }

  function sendLocalPayload() {
    if (!channel || channel.readyState !== 'open' || sending) return false;
    sending = true;
    try {
      const localRaw = getLocalPayload();
      const serialized = serializeSyncPayload({
        entries: localRaw.entries,
        activities: localRaw.activities,
        categories: localRaw.categories,
        tombstones: localRaw.tombstones,
        deviceId: localRaw.deviceId || 'local',
      });
      const frames = chunkSyncPayload(serialized);
      for (const frame of frames) {
        channel.send(frame);
      }
      return true;
    } finally {
      sending = false;
    }
  }

  function attachDataChannel(dc) {
    channel = dc;
    const reassemble = createChunkReassembler(async (remotePayload) => {
      try {
        const localRaw = getLocalPayload();
        const merged = mergeSyncPayloads(localRaw, remotePayload);
        await applyMergedPayload(merged);
        lastSyncedAt = new Date().toISOString();
        lastError = null;
        emitState();
      } catch (err) {
        lastError = err?.message || 'Erreur lors de la fusion P2P.';
        status = 'error';
        emitState();
      }
    });

    dc.onopen = () => {
      status = 'connected';
      lastError = null;
      emitState();
      sendLocalPayload();
    };

    dc.onmessage = (event) => {
      reassemble(event.data);
    };

    dc.onclose = () => {
      if (status !== 'idle') {
        status = 'idle';
        emitState();
      }
    };

    dc.onerror = () => {
      lastError = 'Erreur sur le canal de données WebRTC.';
      status = 'error';
      emitState();
    };
  }

  function resetConnection() {
    try { channel?.close?.(); } catch { /* noop */ }
    try { pc?.close?.(); } catch { /* noop */ }
    pc = null;
    channel = null;
  }

  async function createOffer() {
    resetConnection();
    status = 'creating_offer';
    offerCode = '';
    answerCode = '';
    lastError = null;
    emitState();

    try {
      pc = rtcFactory({ iceServers });
      const dc = pc.createDataChannel('timetracker-sync', { ordered: true });
      attachDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, iceGatherTimeoutMs);

      offerCode = encodeSignalToken(pc.localDescription || offer);
      status = 'awaiting_answer';
      emitState();
      return offerCode;
    } catch (err) {
      lastError = err?.message || 'Impossible de créer l’invitation WebRTC.';
      status = 'error';
      emitState();
      throw err;
    }
  }

  async function acceptOfferAndCreateAnswer(rawOfferCode) {
    resetConnection();
    status = 'awaiting_connection';
    offerCode = '';
    answerCode = '';
    lastError = null;
    emitState();

    try {
      const remoteOffer = decodeSignalToken(rawOfferCode);
      if (remoteOffer.type !== 'offer') {
        throw new Error('Le code saisi n’est pas une invitation (offer) P2P valide.');
      }

      pc = rtcFactory({ iceServers });
      pc.ondatachannel = (event) => {
        if (event?.channel) attachDataChannel(event.channel);
      };

      await pc.setRemoteDescription(remoteOffer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, iceGatherTimeoutMs);

      answerCode = encodeSignalToken(pc.localDescription || answer);
      emitState();
      return answerCode;
    } catch (err) {
      lastError = err?.message || 'Impossible de traiter le code d’invitation P2P.';
      status = 'error';
      emitState();
      throw err;
    }
  }

  async function acceptAnswer(rawAnswerCode) {
    if (!pc) {
      throw new Error('Créez d’abord une invitation P2P sur cet appareil.');
    }
    try {
      const remoteAnswer = decodeSignalToken(rawAnswerCode);
      if (remoteAnswer.type !== 'answer') {
        throw new Error('Le code saisi n’est pas une réponse (answer) P2P valide.');
      }
      await pc.setRemoteDescription(remoteAnswer);
      status = channel?.readyState === 'open' ? 'connected' : 'awaiting_connection';
      lastError = null;
      emitState();
    } catch (err) {
      lastError = err?.message || 'Impossible d’appliquer la réponse P2P.';
      status = 'error';
      emitState();
      throw err;
    }
  }

  function syncNow() {
    const ok = sendLocalPayload();
    if (!ok) {
      throw new Error('Aucun pair WebRTC connecté actuellement.');
    }
    return true;
  }

  function disconnect() {
    resetConnection();
    status = 'idle';
    offerCode = '';
    answerCode = '';
    lastError = null;
    emitState();
  }

  return {
    getSnapshot,
    createOffer,
    acceptOfferAndCreateAnswer,
    acceptAnswer,
    syncNow,
    disconnect,
  };
}
