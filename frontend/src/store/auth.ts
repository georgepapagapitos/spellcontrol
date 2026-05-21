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
  logout: () => Promise<void>;
  /**
   * Permanently delete the account: hit DELETE /api/auth/me, then tear down
   * sync and wipe the local cache. Resolves to false (and sets `error`) if the
   * server call fails, so the caller can keep the user signed in.
   */
  deleteAccount: () => Promise<boolean>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set) => ({
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
