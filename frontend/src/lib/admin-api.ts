import { authedFetch, handleResponse } from './fetch-utils';
import type { UserRole } from './auth-api';

export interface AdminUserSummary {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  /** Approximate Postgres byte-size of the user's synced JSONB columns. */
  dataBytes: number;
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
