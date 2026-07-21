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
