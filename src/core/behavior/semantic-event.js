/**
 * Semantic Event: the unit consumed by the Event Store and Semantic Event
 * Graph. Raw DOM interactions are never stored as-is (see behavior-tracker.js);
 * they are always collapsed into one of these first.
 *
 * {
 *   id, type, action, target, context, object, timestamp,
 *   sessionId, userId, previousAction, timeSincePreviousAction,
 *   workflowId, metadata
 * }
 */

import { sanitizeMetadata, toSafeIdentifier } from './sanitize.js';

export const EVENT_TYPES = Object.freeze({
  INTERACTION: 'interaction',
  ERROR: 'error',
  LIFECYCLE: 'lifecycle',
});

function randomId() {
  try { return crypto.randomUUID(); } catch { return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

/**
 * @param {object} input
 * @returns {object} a sanitized, immutable-shaped semantic event.
 */
export function createSemanticEvent({
  type = EVENT_TYPES.INTERACTION,
  action,
  target = null,
  context = null,
  object = null,
  timestamp = Date.now(),
  sessionId,
  userId,
  previousAction = null,
  timeSincePreviousAction = null,
  workflowId = null,
  metadata = {},
} = {}) {
  const safeAction = toSafeIdentifier(action);
  if (!safeAction) throw new Error('Un événement sémantique doit avoir une action valide.');
  if (!sessionId || !userId) throw new Error('Un événement sémantique doit être rattaché à une session et un utilisateur.');

  return {
    id: randomId(),
    type: Object.values(EVENT_TYPES).includes(type) ? type : EVENT_TYPES.INTERACTION,
    action: safeAction,
    target: toSafeIdentifier(target),
    context: toSafeIdentifier(context),
    object: toSafeIdentifier(object),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    sessionId: String(sessionId),
    userId: String(userId),
    previousAction: toSafeIdentifier(previousAction),
    timeSincePreviousAction: Number.isFinite(timeSincePreviousAction) && timeSincePreviousAction >= 0
      ? Math.round(timeSincePreviousAction)
      : null,
    workflowId: toSafeIdentifier(workflowId),
    metadata: sanitizeMetadata(metadata),
  };
}

export function isSemanticEvent(value) {
  return Boolean(
    value && typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.action === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.userId === 'string' &&
    Number.isFinite(value.timestamp),
  );
}
