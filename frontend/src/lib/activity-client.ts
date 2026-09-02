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

/** An incoming trade offer still waiting on the viewer to answer. */
export interface TradeOfferActivityItem {
  type: 'trade_offer';
  id: string;
  offerId: string;
  fromUserId: string;
  fromUsername: string;
  fromDisplayName: string | null;
  /** Card-line counts, named from the VIEWER's side: what they'd give / get. */
  giveCount: number;
  receiveCount: number;
  occurredAt: number;
}

/** An offer the viewer SENT that the other side has now answered. */
export interface TradeResolvedActivityItem {
  type: 'trade_resolved';
  id: string;
  offerId: string;
  withUserId: string;
  withUsername: string;
  withDisplayName: string | null;
  outcome: 'accepted' | 'declined';
  occurredAt: number;
}

export type RecentActivityItem =
  | DirectShareActivityItem
  | FeedbackActivityItem
  | DeckLikedActivityItem
  | TradeResolvedActivityItem;

export type ActionRequiredItem = FriendRequestActivityItem | TradeOfferActivityItem;

export type ActivityItem = ActionRequiredItem | RecentActivityItem;

export interface ActivityResponse {
  /** Pending friend requests + incoming trade offers — always returned in
   *  full, no time window: an unanswered question doesn't stop being
   *  unanswered because it got old. */
  actionRequired: ActionRequiredItem[];
  /** Shares, feedback, likes, and answered trades, merged newest-first. */
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
    throw new Error(
      await readError(res, "Couldn't load recent activity. Check your connection and try again.")
    );
  }
  return (await res.json()) as ActivityResponse;
}
