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

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await authedFetch('/api/auth/me', { method: 'GET' });
  if (res.status === 401) return null;
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
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
