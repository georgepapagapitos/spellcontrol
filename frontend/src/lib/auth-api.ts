export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

/**
 * One delta row from `GET /api/sync`. `data === null && deletedAt != null`
 * is a tombstone — clients should drop the local row with this id.
 * Cards carry their owning `importId`; other kinds omit it.
 */
export interface SyncRow {
  kind: SyncKind;
  id: string;
  data: unknown;
  rev: number;
  deletedAt: number | null;
  importId?: string;
}

export type SyncKind = 'import' | 'card' | 'binder' | 'deck' | 'game' | 'list' | 'cube';

export interface SyncPullPage {
  rows: SyncRow[];
  cursor: number;
  hasMore: boolean;
}

export interface SyncUpsert {
  kind: SyncKind;
  id: string;
  data: unknown;
  importId?: string;
  clientRev?: number;
}
export interface SyncDeletion {
  kind: SyncKind;
  id: string;
}

/**
 * Card-only reject-stale check (E129): asserts the client's believed live
 * copyIds for a (scryfallId, finish) printing group, so the server can detect
 * a concurrent add/remove for that SAME group before applying this batch's
 * upserts/deletions for it. See routes/sync.ts for the server-side semantics.
 */
export interface SyncCardGroupCheck {
  scryfallId: string;
  finish: string;
  /** Sorted copyIds the client believes are currently live for this group. */
  baseline: string[];
}

export interface SyncPushResult {
  applied: Array<{
    kind: SyncKind;
    id: string;
    rev: number;
    deletedAt: number | null;
  }>;
  conflicts?: Array<{
    kind: 'deck' | 'card';
    id: string;
    serverRev: number;
    serverData: unknown;
    /** Card-only; the row's owning import so a restore doesn't lose it. */
    importId?: string;
  }>;
  cursor: number;
}

import { authedFetch, handleResponse } from './fetch-utils';
import { apiUrl } from './api-base';

export async function register(username: string, password: string): Promise<AuthUser> {
  const res = await authedFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await authedFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
}

export async function logout(): Promise<void> {
  await authedFetch('/api/auth/logout', { method: 'POST' });
}

/** Which sign-in methods this deployment offers. Google is optional. */
export interface AuthProviders {
  password: boolean;
  google: boolean;
}

/**
 * Ask the backend which sign-in methods are enabled. Used by the auth screen
 * to decide whether to render the "Continue with Google" button. Falls back to
 * password-only if the request fails, so a network blip never strands the user.
 */
export async function fetchProviders(): Promise<AuthProviders> {
  try {
    const res = await authedFetch('/api/auth/providers', { method: 'GET' });
    return await handleResponse<AuthProviders>(res);
  } catch {
    return { password: true, google: false };
  }
}

/**
 * Absolute URL that starts the Google OAuth flow. Web navigates the top-level
 * page here; native opens it in the system browser. `platform=native` tells
 * the backend callback to deep-link a handoff code back instead of setting a
 * cookie (the system browser's cookie jar is unreachable from the WebView).
 */
export function googleSignInUrl(platform: 'web' | 'native'): string {
  return apiUrl(`/api/auth/google${platform === 'native' ? '?platform=native' : ''}`);
}

/**
 * Native only: trade the single-use handoff code from the OAuth deep link for
 * a real session. The response's Set-Cookie lands in the native cookie jar
 * because this request goes through the Capacitor HTTP bridge.
 */
export async function exchangeGoogleCode(code: string): Promise<AuthUser> {
  const res = await authedFetch('/api/auth/google/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
}

/**
 * Finish a first-time Google sign-in: the user picked `username` on the
 * choose-username screen; `signupToken` is the short-lived token from the
 * OAuth callback that carries their verified Google identity. Creates the
 * account and returns the user. Throws with `.status === 409` if the username
 * is taken so the screen can prompt for another.
 */
export async function completeGoogleSignup(
  signupToken: string,
  username: string
): Promise<AuthUser> {
  const res = await authedFetch('/api/auth/google/complete-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signupToken, username }),
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
}

/**
 * Account linking, password-confirmed: the user picked a username that's
 * already taken; if it's their existing account they can prove ownership by
 * supplying the password, and the Google identity gets attached to it.
 * Throws with `.status === 401` on bad credentials, `.status === 409` if that
 * account already has a Google account linked.
 */
export async function linkGoogleWithPassword(
  signupToken: string,
  username: string,
  password: string
): Promise<AuthUser> {
  const res = await authedFetch('/api/auth/google/link-with-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signupToken, username, password }),
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
}

/** Which sign-in methods the authed user has set up. */
export interface MyIdentities {
  /** True if the account has a password (i.e. is not SSO-only). */
  password: boolean;
  /** Set when a Google identity is attached. */
  google: { linkedAt: number } | null;
}

export async function fetchIdentities(): Promise<MyIdentities> {
  const res = await authedFetch('/api/auth/me/identities', { method: 'GET' });
  return handleResponse<MyIdentities>(res);
}

/**
 * Absolute URL that starts the link-Google flow. Web navigates top-level here
 * (the session cookie travels). Native must POST `requestGoogleLinkIntent`
 * first and pass the returned token, because the system browser is cookieless.
 */
export function googleLinkUrl(platform: 'web' | 'native', intent?: string): string {
  if (platform === 'native') {
    return apiUrl(
      `/api/auth/google/link?platform=native&intent=${encodeURIComponent(intent ?? '')}`
    );
  }
  return apiUrl('/api/auth/google/link');
}

/**
 * Native only: ask the backend for a short-lived "I approved linking" token
 * to pass through the system browser. The POST runs through the Capacitor
 * HTTP bridge so the session cookie travels.
 */
export async function requestGoogleLinkIntent(): Promise<string> {
  const res = await authedFetch('/api/auth/google/link-intent', { method: 'POST' });
  const data = await handleResponse<{ intent: string }>(res);
  return data.intent;
}

/** Detach the Google identity from the authed user. */
export async function unlinkGoogle(): Promise<void> {
  const res = await authedFetch('/api/auth/me/identities/google', { method: 'DELETE' });
  await handleResponse<{ ok: true }>(res);
}

/**
 * Permanently delete the current account and all server-side data. The backend
 * deletes the `users` row; every user-owned table cascades. The session cookie
 * is cleared by the response. Callers must NOT flush pending sync writes first
 * — that would re-push data the user just asked to destroy.
 */
export async function deleteAccount(): Promise<void> {
  const res = await authedFetch('/api/auth/me', { method: 'DELETE' });
  await handleResponse<{ ok: true }>(res);
}

/**
 * User-editable public-profile fields (social program W0). All nullable —
 * `null` means "not set", never absent/undefined, so consumers can render a
 * fixed set of fields without an extra existence check.
 */
export interface Profile {
  displayName: string | null;
  bio: string | null;
  avatarCardId: string | null;
  avatarCardName: string | null;
  avatarImageUrl: string | null;
}

/** A freshly-picked avatar, pre-derived client-side (see AvatarPickerSheet). */
export interface AvatarPatch {
  cardId: string;
  cardName: string;
  imageUrl: string;
}

/**
 * Result shape for /me. `autoLinkedAt` is non-null when an external sign-in
 * was just attached to this account via a verified-email match — the
 * frontend surfaces a "was this you?" banner until it's acknowledged.
 */
export interface MeResponse {
  user: AuthUser;
  autoLinkedAt: number | null;
  profile: Profile;
}

export async function fetchMe(): Promise<MeResponse | null> {
  const res = await authedFetch('/api/auth/me', { method: 'GET' });
  if (res.status === 401) return null;
  const data = await handleResponse<{
    user: AuthUser;
    autoLinkedAt?: number | null;
    profile: Profile;
  }>(res);
  return { user: data.user, autoLinkedAt: data.autoLinkedAt ?? null, profile: data.profile };
}

/**
 * Per-field PATCH semantics: a key absent from `patch` leaves that field
 * unchanged server-side; `null` clears it; any other value sets it. Callers
 * that always hold all three fields in local state (ProfileEditor) just pass
 * the current value of each — the server treats an empty string the same as
 * `null` (trims, then a blank result clears).
 */
export async function updateProfile(patch: {
  displayName?: string | null;
  bio?: string | null;
  avatar?: AvatarPatch | null;
}): Promise<Profile> {
  const res = await authedFetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await handleResponse<{ profile: Profile }>(res);
  return data.profile;
}

/** Dismiss the auto-link banner (server-side: clears users.auto_linked_at). */
export async function acknowledgeAutoLink(): Promise<void> {
  const res = await authedFetch('/api/auth/me/acknowledge-auto-link', { method: 'POST' });
  await handleResponse<{ ok: true }>(res);
}

/**
 * Pull delta rows newer than `since`. The server pages at `limit` (default 2000);
 * the response carries `hasMore` so the driver knows to keep pulling. `fresh`
 * tells the server we have no local rows yet, so it skips historical tombstones
 * and sends only live rows — a fresh client has nothing to delete.
 */
export async function pullSync(
  since: number,
  limit?: number,
  fresh?: boolean
): Promise<SyncPullPage> {
  const params = new URLSearchParams({ since: String(since) });
  if (typeof limit === 'number' && limit > 0) params.set('limit', String(limit));
  if (fresh) params.set('fresh', '1');
  const res = await authedFetch(`/api/sync?${params.toString()}`, { method: 'GET' });
  return handleResponse<SyncPullPage>(res);
}

/**
 * Apply a delta batch. Last-write-wins per row for every kind. The server
 * stamps each applied op with a fresh rev (from `user_data_rev_seq`) and an
 * `import` deletion cascades tombstones to its cards inside the same tx.
 * Callers reflect the returned `applied[]` revs onto their local rows so
 * subsequent pulls don't re-deliver them.
 */
export async function pushSync(input: {
  upserts: SyncUpsert[];
  deletions: SyncDeletion[];
  cardGroupChecks?: SyncCardGroupCheck[];
}): Promise<SyncPushResult> {
  const res = await authedFetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse<SyncPushResult>(res);
}
