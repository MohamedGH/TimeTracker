import { describe, it, expect } from 'vitest';
import {
  encodeSignalToken,
  decodeSignalToken,
  chunkSyncPayload,
  createChunkReassembler,
  createP2PSyncManager,
} from '../src/core/sync/p2p-sync.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

function createFakeRtcPair() {
  const peers = [];
  class FakePeerConnection {
    constructor() {
      this.iceGatheringState = 'complete';
      this.localDescription = null;
      this.remoteDescription = null;
      this.ondatachannel = null;
      this._channel = null;
      this._partner = null;
      peers.push(this);
      if (peers.length === 2) {
        peers[0]._partner = peers[1];
        peers[1]._partner = peers[0];
      }
    }

    createDataChannel(label) {
      this._channel = {
        label,
        readyState: 'connecting',
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: (msg) => {
          this._partner?._channel?.onmessage?.({ data: msg });
        },
        close: () => {
          this._channel.readyState = 'closed';
        },
      };
      return this._channel;
    }

    async createOffer() {
      return { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };
    }

    async createAnswer() {
      return { type: 'answer', sdp: 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n' };
    }

    async setLocalDescription(desc) {
      this.localDescription = desc;
    }

    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
      if (desc.type === 'answer' && this._partner) {
        // Connect data channel symmetrically
        const remoteDc = {
          label: 'timetracker-sync',
          readyState: 'open',
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          send: (msg) => {
            this._channel?.onmessage?.({ data: msg });
          },
          close: () => {
            remoteDc.readyState = 'closed';
          },
        };
        this._partner._channel = remoteDc;
        this._partner.ondatachannel?.({ channel: remoteDc });
        remoteDc.onopen?.();
        this._channel.readyState = 'open';
        this._channel.onopen?.();
      }
    }

    close() {}
  }

  return () => new FakePeerConnection();
}

describe('WebRTC P2P direct sync', () => {
  it('encodes and decodes compact TT1 signaling tokens cleanly', () => {
    const token = encodeSignalToken({ type: 'offer', sdp: 'v=0\r\nsdp-body' });
    expect(token.startsWith('TT1:')).toBe(true);
    expect(decodeSignalToken(token)).toEqual({ type: 'offer', sdp: 'v=0\r\nsdp-body' });
    expect(() => decodeSignalToken('INVALID')).toThrow(/TT1:/);
  });

  it('chunks and reassembles large payloads reliably', () => {
    const largeEntries = Array.from({ length: 120 }, (_, i) => ({
      id: `e-${i}`,
      activity: `Activité numéro ${i}`,
      categoryId: 'travail',
      date: '2026-11-15',
      start: '09:00',
      end: '09:30',
      mins: 30,
      updatedAt: 1000 + i,
    }));

    const frames = chunkSyncPayload({ entries: largeEntries, categories: DEFAULT_CATEGORIES }, 500, 'tx-1');
    expect(frames.length).toBeGreaterThan(3);

    let reassembled = null;
    const receive = createChunkReassembler((payload) => {
      reassembled = payload;
    });

    // Deliver out-of-order frames
    for (const frame of [...frames].reverse()) {
      receive(frame);
    }

    expect(reassembled).toBeTruthy();
    expect(reassembled.entries).toHaveLength(120);
  });

  it('completes Offer/Answer handshake and converges both peers via CRDT merge', async () => {
    const rtcFactory = createFakeRtcPair();

    let stateA = {
      deviceId: 'peer-A',
      entries: [
        { id: 'e-a', activity: 'Dev', categoryId: 'travail', date: '2026-11-15', start: '09:00', end: '10:00', mins: 60, updatedAt: 100 },
      ],
      activities: [],
      categories: DEFAULT_CATEGORIES,
      tombstones: {},
    };

    let stateB = {
      deviceId: 'peer-B',
      entries: [
        { id: 'e-b', activity: 'Course', categoryId: 'sport', date: '2026-11-15', start: '18:00', end: '18:30', mins: 30, updatedAt: 200 },
      ],
      activities: [],
      categories: DEFAULT_CATEGORIES,
      tombstones: {},
    };

    const peerA = createP2PSyncManager({
      rtcFactory,
      getLocalPayload: () => stateA,
      applyMergedPayload: async (merged) => {
        stateA = { ...stateA, ...merged };
      },
    });

    const peerB = createP2PSyncManager({
      rtcFactory,
      getLocalPayload: () => stateB,
      applyMergedPayload: async (merged) => {
        stateB = { ...stateB, ...merged };
      },
    });

    const offer = await peerA.createOffer();
    const answer = await peerB.acceptOfferAndCreateAnswer(offer);
    await peerA.acceptAnswer(answer);

    // Wait briefly for async applyMergedPayload callbacks
    await new Promise(r => setTimeout(r, 20));

    expect(peerA.getSnapshot().isConnected).toBe(true);
    expect(peerB.getSnapshot().isConnected).toBe(true);
    expect(stateA.entries.map(e => e.id)).toEqual(['e-b', 'e-a']);
    expect(stateB.entries.map(e => e.id)).toEqual(['e-b', 'e-a']);

    peerA.disconnect();
    peerB.disconnect();
  });
});
