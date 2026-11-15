import { describe, it, expect, vi } from 'vitest';
import { normalizeError, createErrorManager, ERROR_CODES } from '../src/core/error-manager.js';

describe('error-manager', () => {
  describe('normalizeError', () => {
    it('categorizes timer errors cleanly', () => {
      const err = normalizeError(new Error('Timer invalide.'), 'timer');
      expect(err.code).toBe(ERROR_CODES.TIMER);
      expect(err.message).toContain('renseigner une activité');
    });

    it('categorizes storage errors cleanly', () => {
      const err = normalizeError(new Error('IndexedDB error'), 'storage');
      expect(err.code).toBe(ERROR_CODES.STORAGE);
      expect(err.message).toContain('mémoire locale');
    });

    it('handles generic unknown errors gracefully', () => {
      const err = normalizeError('Crash!');
      expect(err.code).toBe(ERROR_CODES.RUNTIME);
      expect(err.originalMessage).toBe('Crash!');
    });
  });

  describe('createErrorManager', () => {
    it('stores error and notifies listeners', () => {
      const listener = vi.fn();
      const manager = createErrorManager({ onErrorChanged: listener });

      manager.handleError(new Error('Test error'));
      expect(manager.getError()).toBeTruthy();
      expect(listener).toHaveBeenCalled();

      manager.clearError();
      expect(manager.getError()).toBeNull();
    });

    it('supports temporary notices', () => {
      const manager = createErrorManager();
      manager.notifySuccess('Opération réussie !', 0); // 0 = no auto-dismiss
      expect(manager.getNotice()?.type).toBe('success');
      expect(manager.getNotice()?.message).toBe('Opération réussie !');

      manager.clearNotice();
      expect(manager.getNotice()).toBeNull();
    });
  });
});
