import { authedFetch, handleResponse } from './fetch-utils';
import type { UserRole } from './auth-api';
import type { ReportKind } from './report-client';

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

export interface AdminReportRow {
  id: string;
  kind: ReportKind;
  /** Best-effort human-readable target — "{deck name} by {owner}" for a
   *  deck report, the reported username for a profile report. */
  targetLabel: string;
  /** Null for an anonymous report — the client shows "Anonymous". */
  reporterUsername: string | null;
  reason: string;
  createdAt: number;
}

/** Unresolved content reports (social program W1), newest first. */
export async function listReports(): Promise<AdminReportRow[]> {
  const res = await authedFetch('/api/admin/reports');
  const data = await handleResponse<{ reports: AdminReportRow[] }>(res);
  return data.reports;
}

/** Resolve a report: 'dismiss' just closes it out, 'hide' also unpublishes
 *  the reported deck (or, for a profile report, hides the profile and every
 *  one of that user's live publications). */
export async function resolveReport(id: string, action: 'dismiss' | 'hide'): Promise<void> {
  const res = await authedFetch(`/api/admin/reports/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  await handleResponse<{ ok: true }>(res);
}
