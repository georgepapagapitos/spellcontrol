import { apiUrl } from './api-base';
import type { ShareKind } from './shared-types';

/**
 * Mirrors backend/src/routes/activity.ts's ActivityItem discriminated union —
 * keep in lockstep when fields change (same convention as friends-client.ts /
 * shared-types.ts mirroring their own backend counterparts).
 */
export interface FriendRequestActivityItem {
  type: 'friend_request';
  id: string;
  requesterId: string;
  requesterUsername: string;
  requesterDisplayName: string | null;
  occurredAt: number;
}

export interface DirectShareActivityItem {
  type: 'direct_share';
  id: string;
  token: string;
  kind: ShareKind;
  fromUsername: string;
  fromDisplayName: string | null;
  label: string;
  occurredAt: number;
}

export interface FeedbackActivityItem {
  type: 'feedback';
  id: string;
  deckId: string;
  deckName: string;
  authorName: string;
  comment: string;
  occurredAt: number;
}

export interface DeckLikedActivityItem {
  type: 'deck_liked';
  id: string;
  slug: string;
  deckName: string;
  count: number;
  occurredAt: number;
}

export type RecentActivityItem =
  | DirectShareActivityItem
  | FeedbackActivityItem
  | DeckLikedActivityItem;

export type ActivityItem = FriendRequestActivityItem | RecentActivityItem;

export interface ActivityResponse {
  /** Incoming pending friend requests — always returned in full, no window. */
  actionRequired: FriendRequestActivityItem[];
  /** Direct shares, feedback, and grouped likes, merged and sorted newest-first. */
  recent: RecentActivityItem[];
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** The unified activity feed (social program W2) — the one badge source of
 *  truth for pending friend requests + directed shares + feedback + likes. */
export async function getActivity(): Promise<ActivityResponse> {
  const res = await fetch(apiUrl('/api/activity'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load activity.'));
  }
  return (await res.json()) as ActivityResponse;
}
