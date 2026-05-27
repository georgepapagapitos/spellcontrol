export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface SyncSnapshot {
  collection: unknown;
  binders: unknown[];
  decks: unknown[];
  /** Added with the play feature — older snapshots may omit it. */
  games?: unknown[];
  version: number;
  updatedAt: number;
}

import { handleResponse } from './fetch-utils';
import { apiUrl } from './api-base';

function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(url), { credentials: 'same-origin', ...init });
}

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
 * Result shape for /me. `autoLinkedAt` is non-null when an external sign-in
 * was just attached to this account via a verified-email match — the
 * frontend surfaces a "was this you?" banner until it's acknowledged.
 */
export interface MeResponse {
  user: AuthUser;
  autoLinkedAt: number | null;
}

export async function fetchMe(): Promise<MeResponse | null> {
  const res = await authedFetch('/api/auth/me', { method: 'GET' });
  if (res.status === 401) return null;
  const data = await handleResponse<{ user: AuthUser; autoLinkedAt?: number | null }>(res);
  return { user: data.user, autoLinkedAt: data.autoLinkedAt ?? null };
}

/** Dismiss the auto-link banner (server-side: clears users.auto_linked_at). */
export async function acknowledgeAutoLink(): Promise<void> {
  const res = await authedFetch('/api/auth/me/acknowledge-auto-link', { method: 'POST' });
  await handleResponse<{ ok: true }>(res);
}

export async function fetchSync(): Promise<SyncSnapshot> {
  const res = await authedFetch('/api/sync', { method: 'GET' });
  return handleResponse<SyncSnapshot>(res);
}

interface PutSyncResult {
  version: number;
  updatedAt: number;
}

/**
 * Push a snapshot. Throws with `.status === 409` and `.current` payload on
 * conflict; callers should refetch and re-apply.
 */
export async function putSync(input: {
  collection: unknown;
  binders: unknown[];
  decks: unknown[];
  games?: unknown[];
  baseVersion: number;
}): Promise<PutSyncResult> {
  const res = await authedFetch('/api/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const body = (await res.json()) as { current: SyncSnapshot };
    const e = new Error('Version conflict.') as Error & {
      status?: number;
      current?: SyncSnapshot;
    };
    e.status = 409;
    e.current = body.current;
    throw e;
  }
  return handleResponse<PutSyncResult>(res);
}

export interface SyncBackupMeta {
  id: string;
  /** Why the backup was taken — currently always 'collection-wipe'. */
  reason: string;
  priorVersion: number;
  priorCardCount: number;
  createdAt: number;
}

/** List the server-side pre-wipe backups for the current user (newest first). */
export async function fetchBackups(): Promise<SyncBackupMeta[]> {
  const res = await authedFetch('/api/sync/backups', { method: 'GET' });
  const data = await handleResponse<{ backups: SyncBackupMeta[] }>(res);
  return data.backups;
}

/**
 * Restore a backup as the current server snapshot. Same 409 contract as
 * putSync (throws with `.status === 409` and `.current` so the caller can
 * rebase). Returns the restored snapshot the client should apply.
 */
export async function restoreBackup(input: {
  backupId: string;
  baseVersion: number;
}): Promise<SyncSnapshot> {
  const res = await authedFetch('/api/sync/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const body = (await res.json()) as { current: SyncSnapshot };
    const e = new Error('Version conflict.') as Error & {
      status?: number;
      current?: SyncSnapshot;
    };
    e.status = 409;
    e.current = body.current;
    throw e;
  }
  return handleResponse<SyncSnapshot>(res);
}
