/**
 * Error Manager — Centralized error handling and user notification.
 * Pure functional error formatting with reactive subscription.
 */

export const ERROR_CODES = Object.freeze({
  VALIDATION: 'validation_error',
  STORAGE: 'storage_error',
  IMPORT: 'import_error',
  TIMER: 'timer_error',
  AUTH: 'auth_error',
  SYNC: 'sync_error',
  RUNTIME: 'runtime_error',
});

/**
 * Normalizes an unknown caught error into a structured ErrorInfo object.
 * Pure function: (error, context) -> ErrorInfo
 */
export function normalizeError(error, context = 'general') {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Une erreur inattendue est survenue.');
  
  let code = ERROR_CODES.RUNTIME;
  let userMessage = rawMessage;

  if (context === 'auth') {
    code = ERROR_CODES.AUTH;
    userMessage = rawMessage || 'Erreur lors de l’authentification Google.';
  } else if (context === 'sync') {
    code = ERROR_CODES.SYNC;
    userMessage = rawMessage || 'Erreur lors de la synchronisation multi-appareils.';
  } else if (context === 'mobile') {
    code = ERROR_CODES.RUNTIME;
    userMessage = rawMessage || 'Impossible d’installer ou de mettre à jour l’application mobile.';
  } else if (context === 'timer' || rawMessage.toLowerCase().includes('timer')) {
    code = ERROR_CODES.TIMER;
    userMessage = rawMessage.includes('invalide')
      ? 'Veuillez renseigner une activité et une catégorie pour démarrer le chrono.'
      : rawMessage;
  } else if (context === 'entry' || rawMessage.toLowerCase().includes('horaires') || rawMessage.toLowerCase().includes('activité')) {
    code = ERROR_CODES.VALIDATION;
    userMessage = 'Veuillez vérifier le nom de l’activité et les horaires saisis.';
  } else if (context === 'storage' || rawMessage.toLowerCase().includes('indexeddb')) {
    code = ERROR_CODES.STORAGE;
    userMessage = 'Impossible d’accéder à la mémoire locale de votre navigateur.';
  } else if (context === 'import' || rawMessage.toLowerCase().includes('json') || rawMessage.toLowerCase().includes('sauvegarde')) {
    code = ERROR_CODES.IMPORT;
    userMessage = rawMessage || 'Le fichier de données importé est invalide ou corrompu.';
  }

  return {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    code,
    context,
    message: userMessage,
    originalMessage: rawMessage,
    timestamp: Date.now(),
  };
}

/**
 * Creates an instance of the ErrorManager.
 */
export function createErrorManager({ onErrorChanged } = {}) {
  let currentError = null;
  let currentNotice = null; // { type: 'success' | 'info', message }
  const listeners = new Set();

  function notify() {
    if (typeof onErrorChanged === 'function') {
      onErrorChanged({ error: currentError, notice: currentNotice });
    }
    listeners.forEach(fn => fn({ error: currentError, notice: currentNotice }));
  }

  return {
    getError() {
      return currentError;
    },

    getNotice() {
      return currentNotice;
    },

    handleError(err, context = 'general') {
      currentError = normalizeError(err, context);
      notify();
      return currentError;
    },

    clearError() {
      if (currentError !== null) {
        currentError = null;
        notify();
      }
    },

    notifySuccess(message, autoDismissMs = 3000) {
      currentNotice = { type: 'success', message, timestamp: Date.now() };
      notify();
      if (autoDismissMs > 0 && typeof setTimeout !== 'undefined') {
        setTimeout(() => {
          if (currentNotice?.message === message) {
            currentNotice = null;
            notify();
          }
        }, autoDismissMs);
      }
    },

    notifyInfo(message, autoDismissMs = 4000) {
      currentNotice = { type: 'info', message, timestamp: Date.now() };
      notify();
      if (autoDismissMs > 0 && typeof setTimeout !== 'undefined') {
        setTimeout(() => {
          if (currentNotice?.message === message) {
            currentNotice = null;
            notify();
          }
        }, autoDismissMs);
      }
    },

    clearNotice() {
      if (currentNotice !== null) {
        currentNotice = null;
        notify();
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
