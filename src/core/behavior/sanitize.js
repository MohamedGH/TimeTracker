/**
 * Sanitization shared by the whole behavior pipeline.
 *
 * Hard rule: nothing derived from a form field's *value*, free user text
 * (activity names, category labels, notes), passwords, tokens, or banking
 * data ever reaches a semantic event. Callers must only ever pass
 * structural identifiers (a `data-behavior-target` id, a field *role* like
 * "activity" or "date", a domain object *type* like "time_entry") — never
 * the content typed into a field.
 */

const DENYLISTED_KEYS = new Set([
  'value', 'values', 'password', 'token', 'secret', 'apikey', 'api_key',
  'email', 'iban', 'card', 'cardnumber', 'cvv', 'ssn', 'text', 'content',
  'note', 'notes', 'comment', 'query', 'raw', 'html',
]);

const MAX_STRING_LENGTH = 80;
const MAX_METADATA_KEYS = 12;

/** Strict allowlist pattern for identifiers (targets, contexts, object types, field roles). */
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function isSafeIdentifier(value) {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

/** Clamps a free identifier to something id-shaped, or returns null if it can't be made safe. */
export function toSafeIdentifier(value) {
  if (value === null || value === undefined) return null;
  const asString = String(value).trim().slice(0, 64);
  return isSafeIdentifier(asString) ? asString : null;
}

/** Sanitizes a flat metadata object: structural values only, denylisted/free-text keys dropped. */
export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  const entries = Object.entries(metadata).slice(0, MAX_METADATA_KEYS * 4); // cap work even on huge input
  const result = {};
  let count = 0;
  for (const [key, value] of entries) {
    if (count >= MAX_METADATA_KEYS) break;
    if (DENYLISTED_KEYS.has(key.toLowerCase())) continue;
    const safeValue = sanitizeValue(value);
    if (safeValue === undefined) continue;
    result[key] = safeValue;
    count += 1;
  }
  return result;
}

function sanitizeValue(value) {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // Only identifier-shaped strings are kept; anything else (which would
    // typically be free text) is dropped rather than truncated-and-kept, to
    // avoid leaking partial user content.
    return isSafeIdentifier(value) ? value.slice(0, MAX_STRING_LENGTH) : undefined;
  }
  return undefined; // objects/arrays/functions: dropped
}
