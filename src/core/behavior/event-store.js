/**
 * Event Store: the persistence layer for semantic events. Append-only by
 * design (events are facts about what happened, never edited). Backed by
 * the app's existing IndexedDB adapter (src/core/storage.js) — no UI code
 * should ever talk to IndexedDB directly here either.
 */

import {
  appendBehaviorEvent,
  listBehaviorEvents,
  countBehaviorEvents,
  pruneBehaviorEvents,
  clearBehaviorEvents,
} from '../storage.js';
import { isSemanticEvent } from './semantic-event.js';

const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_PRUNE_EVERY_N_APPENDS = 25;

export function createEventStore({ maxEvents = DEFAULT_MAX_EVENTS, pruneEveryNAppends = DEFAULT_PRUNE_EVERY_N_APPENDS } = {}) {
  let appendsSincePrune = 0;

  return {
    async append(event) {
      if (!isSemanticEvent(event)) throw new Error('Événement sémantique invalide.');
      await appendBehaviorEvent(event);

      // Best-effort, amortized: checking/pruning on every single append
      // would mean a full store transaction per event. Doing it every N
      // appends keeps the store bounded without that overhead.
      appendsSincePrune += 1;
      if (appendsSincePrune >= pruneEveryNAppends) {
        appendsSincePrune = 0;
        pruneBehaviorEvents(maxEvents).catch(() => {});
      }
      return event;
    },

    async listBySession(sessionId, { limit = null } = {}) {
      return listBehaviorEvents({ sessionId, limit });
    },

    async listAll({ limit = null } = {}) {
      return listBehaviorEvents({ limit });
    },

    async count() {
      return countBehaviorEvents();
    },

    async clear() {
      return clearBehaviorEvents();
    },
  };
}
