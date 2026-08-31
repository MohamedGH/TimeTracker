/**
 * Pseudonymous identifiers for behavior tracking.
 *
 * These ids are random, unrelated to any account or personal data, and
 * never leave the device (the behavior graph is built and stored locally,
 * see event-store.js). They exist purely to group events by "same person,
 * same visit" for sequence/pattern analysis.
 */

const USER_ID_KEY = 'time-tracker:behavior-user-id';
const SESSION_ID_KEY = 'time-tracker:behavior-session-id';
// A session is considered new after this much inactivity.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_STARTED_AT_KEY = 'time-tracker:behavior-session-started-at';

function safeStorage(storage) {
  try {
    if (typeof storage === 'undefined') return null;
    return storage;
  } catch {
    return null;
  }
}

function randomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function getUserId() {
  const store = safeStorage(typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!store) return randomId();
  try {
    let id = store.getItem(USER_ID_KEY);
    if (!id) {
      id = randomId();
      store.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

/**
 * Returns a session id, minting a new one if none exists yet or the
 * previous one has been idle for too long. Uses sessionStorage (per browser
 * tab) so unrelated tabs never share a session, with a localStorage-backed
 * idle timer to still rotate long-lived tabs.
 */
export function getSessionId(now = Date.now()) {
  const session = safeStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  if (!session) return randomId();

  try {
    const lastActivity = Number(session.getItem(SESSION_STARTED_AT_KEY)) || 0;
    let id = session.getItem(SESSION_ID_KEY);
    if (!id || now - lastActivity > SESSION_IDLE_TIMEOUT_MS) {
      id = randomId();
      session.setItem(SESSION_ID_KEY, id);
    }
    session.setItem(SESSION_STARTED_AT_KEY, String(now));
    return id;
  } catch {
    return randomId();
  }
}

export function resetIdentifiers() {
  try { localStorage?.removeItem(USER_ID_KEY); } catch { /* ignore */ }
  try {
    sessionStorage?.removeItem(SESSION_ID_KEY);
    sessionStorage?.removeItem(SESSION_STARTED_AT_KEY);
  } catch { /* ignore */ }
}
