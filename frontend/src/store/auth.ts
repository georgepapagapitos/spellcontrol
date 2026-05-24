import { create } from 'zustand';
import * as authApi from '../lib/auth-api';
import type { AuthUser } from '../lib/auth-api';
import { flushSync, stopSyncAndWipeLocal } from '../lib/sync';

export type AuthStatus = 'unknown' | 'loading' | 'authed' | 'guest';

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  /** Last error from a login/register attempt, surfaced in the auth form. */
  error: string | null;

  /**
   * Hits /api/auth/me to discover whether the current cookie is valid. Called
   * once on app mount.
   */
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  /**
   * Native only: finish a Google sign-in by exchanging the handoff code that
   * arrived on the OAuth deep link. The web flow needs no store method — its
   * callback sets the session cookie server-side and `bootstrap()` picks it up
   * on the reload. Resolves to false (and sets `error`) on failure.
   */
  completeGoogleOAuth: (code: string) => Promise<boolean>;
  /**
   * Finish a first-time Google sign-in: create the account with the username
   * the user chose, using the signup token from the OAuth callback. Returns
   * `{ ok, status }` so the choose-username screen can distinguish a "taken"
   * 409 from other failures and offer the link-with-password flow.
   */
  completeGoogleSignup: (
    signupToken: string,
    username: string
  ) => Promise<{ ok: boolean; status?: number }>;
  /**
   * Link a Google identity to an existing password account: when the chosen
   * username is taken and it's the user's, they prove ownership with the
   * password and the Google identity is attached. Resolves to false (and
   * sets `error`) on failure.
   */
  linkGoogleWithPassword: (
    signupToken: string,
    username: string,
    password: string
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  /**
   * Permanently delete the account: hit DELETE /api/auth/me, then tear down
   * sync and wipe the local cache. Resolves to false (and sets `error`) if the
   * server call fails, so the caller can keep the user signed in.
   */
  deleteAccount: () => Promise<boolean>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: 'unknown',
  error: null,

  bootstrap: async () => {
    set({ status: 'loading' });
    try {
      const user = await authApi.fetchMe();
      if (user) set({ user, status: 'authed', error: null });
      else set({ user: null, status: 'guest' });
    } catch {
      // Network failure — treat as guest so the login screen shows. The user
      // can retry by attempting to log in.
      set({ user: null, status: 'guest' });
    }
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const user = await authApi.login(username, password);
      set({ user, status: 'authed', error: null });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed.' });
      return false;
    }
  },

  register: async (username, password) => {
    set({ error: null });
    try {
      const user = await authApi.register(username, password);
      set({ user, status: 'authed', error: null });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Registration failed.' });
      return false;
    }
  },

  completeGoogleOAuth: async (code) => {
    set({ error: null });
    try {
      const user = await authApi.exchangeGoogleCode(code);
      set({ user, status: 'authed', error: null });
      return true;
    } catch (err) {
      // Don't downgrade an already-authed session: a replayed handoff code
      // (e.g. the user taps "Open SpellControl" on the stranded /oauth/callback
      // page after the first deep-link delivery already signed them in, or
      // Android fires appUrlOpen twice) returns 401 because handoff codes are
      // single-use — that must be a no-op, not a logout.
      const stillAuthed = get().status === 'authed';
      set({
        error: stillAuthed ? null : err instanceof Error ? err.message : 'Google sign-in failed.',
        status: stillAuthed ? 'authed' : 'guest',
      });
      return stillAuthed;
    }
  },

  completeGoogleSignup: async (signupToken, username) => {
    set({ error: null });
    try {
      const user = await authApi.completeGoogleSignup(signupToken, username);
      set({ user, status: 'authed', error: null });
      return { ok: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      set({ error: err instanceof Error ? err.message : 'Could not finish sign-up.' });
      return { ok: false, status };
    }
  },

  linkGoogleWithPassword: async (signupToken, username, password) => {
    set({ error: null });
    try {
      const user = await authApi.linkGoogleWithPassword(signupToken, username, password);
      set({ user, status: 'authed', error: null });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not link the account.' });
      return false;
    }
  },

  logout: async () => {
    // Best-effort flush of any pending writes before tearing down. Failure
    // is fine — user explicitly chose to leave.
    try {
      await flushSync();
    } catch {
      /* ignore */
    }
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    await stopSyncAndWipeLocal();
    set({ user: null, status: 'guest', error: null });
  },

  deleteAccount: async () => {
    set({ error: null });
    try {
      // Delete server-side first. Crucially we do NOT flushSync() beforehand —
      // unlike logout, pushing the soon-to-be-deleted snapshot is exactly the
      // wrong move. If the call fails the user stays signed in with data intact.
      await authApi.deleteAccount();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not delete account.' });
      return false;
    }
    // Server rows are gone and the cookie is cleared. stopSyncAndWipeLocal
    // detaches subscribers (cancelling any pending debounced push) and clears
    // the zustand-persist + IndexedDB cache so nothing can re-push it.
    await stopSyncAndWipeLocal();
    set({ user: null, status: 'guest', error: null });
    return true;
  },

  clearError: () => set({ error: null }),
}));
