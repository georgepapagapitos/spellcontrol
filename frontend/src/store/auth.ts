import { create } from 'zustand';
import * as authApi from '../lib/auth-api';
import type { AuthUser } from '../lib/auth-api';
import { flushSync, stopSyncAndWipeLocal } from '../lib/sync';
import { markEverVisited } from '../lib/first-run';

export type AuthStatus = 'unknown' | 'loading' | 'authed' | 'guest';

// Remember the signed-in identity locally so being OFFLINE doesn't look like
// being signed OUT. `/api/auth/me` can't be reached without a network, but a
// network failure is not a sign-out — only a real 401 is. We keep just the
// display identity here; the session cookie remains the actual credential and
// re-validates on the next online bootstrap. Cleared on a real 401 / logout /
// delete so a revoked session can't linger.
const AUTH_USER_KEY = 'spellcontrol:auth-user';

function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function storeUser(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    /* localStorage unavailable — offline identity just won't persist */
  }
}

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  /** Last error from a login/register attempt, surfaced in the auth form. */
  error: string | null;
  /**
   * When non-null, the server attached a new external sign-in to this
   * account via a verified-email match just before this session started.
   * The frontend shows a one-time "was this you?" banner; dismissing it
   * (or unlinking) calls `acknowledgeAutoLink()` and clears this.
   */
  autoLinkedAt: number | null;

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
  /** Dismiss the auto-link banner (server clears users.auto_linked_at). */
  acknowledgeAutoLink: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set, get) => {
  /** Shared success path: persist user identity, update store, mark visited. */
  function signInAs(user: AuthUser): void {
    storeUser(user);
    set({ user, status: 'authed', error: null });
    markEverVisited();
  }

  return {
    // Seed from the remembered identity so an offline launch shows the user as
    // signed in immediately (status stays 'unknown' until bootstrap resolves).
    user: loadStoredUser(),
    status: 'unknown',
    error: null,
    autoLinkedAt: null,

    bootstrap: async () => {
      set({ status: 'loading' });
      try {
        const me = await authApi.fetchMe();
        if (me) {
          storeUser(me.user);
          set({ user: me.user, status: 'authed', error: null, autoLinkedAt: me.autoLinkedAt });
        } else {
          // A real 401 — the session is gone. Forget the cached identity.
          storeUser(null);
          set({ user: null, status: 'guest', autoLinkedAt: null });
        }
      } catch {
        // Network failure is NOT a sign-out. If we remember a signed-in identity,
        // stay authed in offline mode (local data + account preserved); the
        // cookie re-validates on the next online bootstrap. Only fall back to the
        // login screen when there's no remembered user.
        const remembered = loadStoredUser();
        if (remembered)
          set({ user: remembered, status: 'authed', error: null, autoLinkedAt: null });
        else set({ user: null, status: 'guest', autoLinkedAt: null });
      }
    },

    login: async (username, password) => {
      set({ error: null });
      try {
        const user = await authApi.login(username, password);
        // Any intentional first auth choice satisfies the first-run gate.
        signInAs(user);
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
        signInAs(user);
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
        signInAs(user);
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
        signInAs(user);
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
        signInAs(user);
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
      storeUser(null);
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
      storeUser(null);
      set({ user: null, status: 'guest', error: null });
      return true;
    },

    acknowledgeAutoLink: async () => {
      // Optimistic: clear the banner immediately so it doesn't flash back on
      // the next bootstrap if the request is slow. The server side is the
      // authoritative source though; if it fails the next /me will resurface.
      set({ autoLinkedAt: null });
      try {
        await authApi.acknowledgeAutoLink();
      } catch {
        /* ignore — next /me will restore the flag if needed */
      }
    },

    clearError: () => set({ error: null }),
  };
});
