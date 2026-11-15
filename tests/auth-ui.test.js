import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

function createBaseState(overrides = {}) {
  return {
    entries: [],
    activities: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    activeTimer: null,
    authUser: null,
    tab: 'entry',
    period: '7',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    ...overrides,
  };
}

describe('Google OAuth 2.0 / OIDC UI integration', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entry';
  });

  it('opens the account modal and completes Google OIDC sign-in & sign-out', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mockSession = {
      user: {
        id: 'oidc-42',
        name: 'Marie Curie',
        givenName: 'Marie',
        email: 'marie@example.com',
        emailVerified: true,
        picture: '',
        provider: 'google_oidc',
      },
      expiresAt: Date.now() + 3600_000,
      accessToken: 'secret-in-memory',
    };

    const authClient = {
      isConfigured: () => true,
      signIn: vi.fn().mockResolvedValue(mockSession),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const saveAuthSession = vi.fn().mockResolvedValue(undefined);
    const clearAuthSession = vi.fn().mockResolvedValue(undefined);
    const state = createBaseState();

    const ui = createUI({
      root,
      state,
      persist: vi.fn().mockResolvedValue(undefined),
      saveAuthSession,
      clearAuthSession,
      authClient,
    });

    const headerAccountBtn = root.querySelector('[data-behavior-target="account-open"]');
    expect(headerAccountBtn).toBeTruthy();
    expect(headerAccountBtn.textContent).toContain('Connexion');

    // Open account bottom-sheet modal
    headerAccountBtn.click();
    expect(root.querySelector('.modal-box')?.textContent).toContain('Compte Google (OIDC)');

    const signInBtn = root.querySelector('.modal-box [data-behavior-target="auth-google-signin"]');
    expect(signInBtn).toBeTruthy();
    signInBtn.click();

    await vi.waitFor(() => {
      expect(authClient.signIn).toHaveBeenCalledTimes(1);
      expect(state.authUser?.id).toBe('oidc-42');
    });

    expect(saveAuthSession).toHaveBeenCalledWith(mockSession);
    expect(root.querySelector('[data-behavior-target="account-open"]').textContent).toContain('Marie');
    expect(root.querySelector('.auth-profile-email')?.textContent).toBe('marie@example.com');

    // Sign out from Account card
    const signOutBtn = root.querySelector('[data-behavior-target="auth-google-signout"]');
    expect(signOutBtn).toBeTruthy();
    signOutBtn.click();

    await vi.waitFor(() => {
      expect(authClient.signOut).toHaveBeenCalledTimes(1);
      expect(clearAuthSession).toHaveBeenCalledTimes(1);
      expect(state.authUser).toBeNull();
    });

    ui.destroy();
    root.remove();
  });

  it('displays auth errors via errorManager when Google sign-in fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const authClient = {
      isConfigured: () => true,
      signIn: vi.fn().mockRejectedValue(new Error('Fenêtre de connexion Google fermée avant la fin.')),
      signOut: vi.fn(),
    };
    const state = createBaseState();

    const ui = createUI({
      root,
      state,
      persist: vi.fn().mockResolvedValue(undefined),
      authClient,
    });

    root.querySelector('[data-behavior-target="auth-google-signin"]').click();

    await vi.waitFor(() => {
      expect(state.error).toContain('Fenêtre de connexion Google fermée');
    });

    ui.destroy();
    root.remove();
  });
});
