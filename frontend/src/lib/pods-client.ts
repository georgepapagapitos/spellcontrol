import { apiUrl } from './api-base';

export type PodMemberStatus = 'invited' | 'member';

export interface Pod {
  id: string;
  name: string;
  ownerUserId: string;
  ownerUsername: string;
  createdAt: number;
  myStatus: PodMemberStatus;
  memberCount: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function listPods(): Promise<Pod[]> {
  const res = await fetch(apiUrl('/api/pods'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load pods.'));
  }
  const body = (await res.json()) as { pods: Pod[] };
  return body.pods;
}

export async function createPod(name: string): Promise<Pod> {
  const res = await fetch(apiUrl('/api/pods'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to create pod.'));
  }
  const body = (await res.json()) as { pod: Pod };
  return body.pod;
}

/** Invite friends to an existing pod — the create flow's optional invite
 *  step, and reused unchanged by the pod hub page's "Invite more" control. */
export async function invitePodMembers(
  podId: string,
  userIds: string[]
): Promise<{ invited: string[] }> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(podId)}/invites`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to invite friends.'));
  }
  return (await res.json()) as { invited: string[] };
}

export async function acceptPodInvite(podId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(podId)}/accept`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to accept invite.'));
  }
}

export async function declinePodInvite(podId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(podId)}/decline`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, 'Failed to decline invite.'));
  }
}

export async function leavePod(podId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(podId)}/members/me`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, 'Failed to leave pod.'));
  }
}

/** Pods awaiting the caller's reply — computed client-side from the
 *  already-fetched `GET /api/pods` response, the same shape as
 *  GameNights.tsx's own `pendingInviteCount`. Feeds the "Pods" nav badge. */
export function pendingPodInviteCount(pods: Pod[]): number {
  return pods.filter((p) => p.myStatus === 'invited').length;
}

/** Thrown by getPod() on 404 — the same stealth 404 the server returns for a
 *  bad id and for a caller with no row on a real pod alike. */
export class PodNotFoundError extends Error {
  constructor() {
    super('Pod not found.');
    this.name = 'PodNotFoundError';
  }
}

export interface PodMember {
  userId: string;
  username: string;
  status: PodMemberStatus;
  joinedAt: number | null;
}

/** GET /api/pods/:id — the hub page's full detail, roster included. */
export interface PodDetail {
  id: string;
  name: string;
  ownerUserId: string;
  ownerUsername: string;
  createdAt: number;
  myStatus: PodMemberStatus;
  members: PodMember[];
}

export async function getPod(id: string): Promise<PodDetail> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(id)}`), {
    credentials: 'include',
  });
  if (res.status === 404) {
    throw new PodNotFoundError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load pod.'));
  }
  return (await res.json()) as PodDetail;
}

/** Owner-only rename. Returns the server-trimmed name (not just the caller's
 *  input) so the hub page reflects exactly what was stored. */
export async function renamePod(id: string, name: string): Promise<string> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to rename pod.'));
  }
  const body = (await res.json()) as { pod: Pod };
  return body.pod.name;
}

/** Owner-only hard delete. */
export async function deletePod(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, 'Failed to delete pod.'));
  }
}

/** Owner-only removal of a member (or a still-pending invitee) by id. */
export async function removePodMember(id: string, userId: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/pods/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`),
    { method: 'DELETE', credentials: 'include' }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, 'Failed to remove member.'));
  }
}

/** One seat in a pod's shared-history game. `userId`/`username` are always
 *  null here — the server nulls every seat's account identity before this
 *  ever reaches the client (see backend/src/routes/pod-stats.ts); only the
 *  in-game `name` is safe to render. */
export interface PodGameParticipant {
  seat: number;
  userId: null;
  username: null;
  name: string;
  deckId: string | null;
  deckName: string | null;
  commander: string | null;
  colorIdentity: string[];
  finalLife: number;
  eliminated: boolean;
}

/** GET /api/pods/:id/games response row. `winnerUserId` is intentionally
 *  left un-redacted by the server (only per-participant fields are nulled) —
 *  the hub page must not render it directly; resolve the winner's display
 *  name via `winnerSeat` against `participants` instead. */
export interface PodGameResult {
  sessionId: string;
  code: string;
  format: string;
  startingLife: number;
  winnerSeat: number | null;
  winnerUserId: string | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  participants: PodGameParticipant[];
}

export async function fetchPodGames(id: string): Promise<PodGameResult[]> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(id)}/games`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load shared history.'));
  }
  const body = (await res.json()) as { games: PodGameResult[] };
  return body.games;
}

/** One row of GET /api/pods/:id/leaderboard — already sorted by the server
 *  (wins desc, then win rate desc). */
export interface PodStanding {
  userId: string;
  username: string;
  played: number;
  wins: number;
  winRate: number;
}

export async function fetchPodLeaderboard(id: string): Promise<PodStanding[]> {
  const res = await fetch(apiUrl(`/api/pods/${encodeURIComponent(id)}/leaderboard`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load the leaderboard.'));
  }
  const body = (await res.json()) as { standings: PodStanding[] };
  return body.standings;
}
