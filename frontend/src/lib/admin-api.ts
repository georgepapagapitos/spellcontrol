import { authedFetch, handleResponse } from './fetch-utils';
import type { UserRole } from './auth-api';

export interface AdminUserSummary {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  /** Approximate Postgres byte-size of the user's synced JSONB columns. */
  dataBytes: number;
  /** Public-profile fields (social program W0) — enough to spot impersonation. */
  displayName: string | null;
  bio: string | null;
  avatarCardName: string | null;
}

export async function listUsers(): Promise<AdminUserSummary[]> {
  const res = await authedFetch('/api/admin/users');
  const data = await handleResponse<{ users: AdminUserSummary[] }>(res);
  return data.users;
}

export async function deleteUser(id: string): Promise<void> {
  const res = await authedFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await handleResponse<{ ok: true }>(res);
}

/** Clears a target user's display name, bio, and avatar in one moderation action. */
export async function clearUserProfile(id: string): Promise<void> {
  const res = await authedFetch(`/api/admin/users/${encodeURIComponent(id)}/clear-profile`, {
    method: 'POST',
  });
  await handleResponse<{ ok: true }>(res);
}
