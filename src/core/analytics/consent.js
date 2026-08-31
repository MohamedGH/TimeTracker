/**
 * Analytics consent storage.
 *
 * Deliberately independent of the IndexedDB storage adapter (src/core/storage.js):
 * consent must be readable synchronously, before any tracking script is
 * requested, and must never block application startup.
 */

const CONSENT_KEY = 'time-tracker:analytics-consent';

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** @returns {'granted' | 'denied' | null} null means no decision was made yet. */
export function getConsentStatus() {
  if (!hasLocalStorage()) return null;
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function hasConsentDecision() {
  return getConsentStatus() !== null;
}

export function isConsentGranted() {
  return getConsentStatus() === 'granted';
}

export function setConsentStatus(granted) {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
  } catch {
    // Storage unavailable (private browsing, quota, ...): fail silently,
    // analytics simply stays disabled.
  }
}

export function clearConsentDecision() {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    // ignore
  }
}
