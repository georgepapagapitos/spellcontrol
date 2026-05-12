export interface AuthUser {
  id: string;
  username: string;
}

export interface SyncSnapshot {
  collection: unknown;
  binders: unknown[];
  decks: unknown[];
  version: number;
  updatedAt: number;
}

import { handleResponse } from './fetch-utils';

function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { credentials: 'same-origin', ...init });
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
