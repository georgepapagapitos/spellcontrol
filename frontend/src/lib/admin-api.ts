import { authedFetch, handleResponse } from './fetch-utils';
import type { UserRole } from './auth-api';
import type { ReportKind } from './report-client';
import { useAuth } from '../store/auth';

/**
 * Every /api/admin/* call routes through here. A 403 mid-session means the
 * caller's role changed since bootstrap (e.g. a demoted admin still sitting
 * on /admin) — requireAdmin already reads the row fresh on every request, so
 * bootstrap() re-reading /api/auth/me picks up the real role and the page's
 * own `isAdmin` check bounces to /collection (playtest batch 12, E351).
 */
async function adminResponse<T>(res: Response): Promise<T> {
  try {
    return await handleResponse<T>(res);
  } catch (err) {
    if ((err as { status?: number } | null)?.status === 403) {
      void useAuth.getState().bootstrap();
    }
    throw err;
  }
}

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
  /** Admin-granted AI unlock (T114); admins pass the gate regardless. */
  aiAccess: boolean;
  /** Per-user daily AI quota override; null = the app default. */
  aiDailyLimit: number | null;
}

export interface AiSpendWindow {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** Estimated cost at the model's list price. */
  usd: number;
}

export interface AiSpend {
  model: string;
  windows: { today: AiSpendWindow; d7: AiSpendWindow; d30: AiSpendWindow };
  /** Per-user totals over the last 30 days; users with no calls are absent. */
  users: (AiSpendWindow & { userId: string })[];
}

/** Estimated AI cost (T116): totals per window plus a 30-day per-user breakdown. */
export async function getAiSpend(): Promise<AiSpend> {
  const res = await authedFetch('/api/admin/ai-spend');
  return adminResponse<AiSpend>(res);
}

export async function listUsers(): Promise<AdminUserSummary[]> {
  const res = await authedFetch('/api/admin/users');
  const data = await adminResponse<{ users: AdminUserSummary[] }>(res);
  return data.users;
}

export async function deleteUser(id: string): Promise<void> {
  const res = await authedFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await adminResponse<{ ok: true }>(res);
}

/** Clears a target user's display name, bio, and avatar in one moderation action. */
export async function clearUserProfile(id: string): Promise<void> {
  const res = await authedFetch(`/api/admin/users/${encodeURIComponent(id)}/clear-profile`, {
    method: 'POST',
  });
  await adminResponse<{ ok: true }>(res);
}

/** Grant/revoke the per-user AI unlock and/or override the daily quota
 *  (null = app default). Partial: omit a field to leave it as is. */
export async function setUserAi(
  id: string,
  patch: { access?: boolean; dailyLimit?: number | null }
): Promise<void> {
  const res = await authedFetch(`/api/admin/users/${encodeURIComponent(id)}/ai`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await adminResponse<{ ok: true }>(res);
}

/**
 * Grant or revoke the admin seat, keyed on the immutable user id. This is the
 * only ongoing way roles change — `ADMIN_EMAILS` on the server seeds the first
 * admin on a fresh database and nothing else. The server refuses a change to
 * your own role, which is what guarantees a deployment always keeps one admin.
 */
export async function setUserRole(id: string, role: UserRole): Promise<void> {
  const res = await authedFetch(`/api/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  await adminResponse<{ ok: true }>(res);
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
  const data = await adminResponse<{ reports: AdminReportRow[] }>(res);
  return data.reports;
}

/** Resolve a report: 'dismiss' just closes it out, 'hide' also unpublishes
 *  the reported deck (or, for a profile report, hides the profile and every
 *  one of that user's live publications). `changed` is false when 'hide' had
 *  nothing left to do — the target was already taken down some other way
 *  (E352, playtest batch 12) — so the caller can say so honestly. */
export async function resolveReport(
  id: string,
  action: 'dismiss' | 'hide'
): Promise<{ changed: boolean }> {
  const res = await authedFetch(`/api/admin/reports/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return adminResponse<{ ok: true; changed: boolean }>(res);
}

export interface EventCountRow {
  /** YYYY-MM-DD */
  day: string;
  name: string;
  path: string;
  count: number;
}

export interface ErrorCountRow {
  day: string;
  path: string;
  kind: 'error' | 'rejection' | 'render';
  message: string;
  frame: string;
  count: number;
  /** Postgres timestamptz text. */
  last_seen: string;
}

export interface VitalCountRow {
  day: string;
  path: string;
  metric: 'LCP' | 'CLS' | 'INP';
  rating: 'good' | 'needs-improvement' | 'poor';
  count: number;
}

export interface BeaconRows {
  events: EventCountRow[];
  errors: ErrorCountRow[];
  vitals: VitalCountRow[];
}

/** First-party beacon counters for the last `days` days (raw daily rows). */
export async function listEvents(days = 30): Promise<BeaconRows> {
  const res = await authedFetch(`/api/admin/events?days=${days}`);
  return adminResponse<BeaconRows>(res);
}
