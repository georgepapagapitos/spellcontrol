import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { resolveShareLabels } from '../shares/labels';

/**
 * Unified activity feed (social program W2) — derive-on-read over four
 * existing tables (friendships, shares, deck_feedback, deck_likes), no
 * events table. This is the single source the nav badge reads (replacing
 * Header.tsx/MobileTabBar.tsx's duplicated `pendingRequests + inboxCount`
 * math) and what W3's Home is expected to consume for a real feed.
 *
 * `deck_copied` is deliberately absent from `recent`: the copy counter
 * (`deck_publications.copy_count`, from w0-publish-public-reads) inserts no
 * event row, so there is no per-copy history to group into a "N people
 * copied your deck" item. Fast-follow: teach that copy handler
 * (routes/public.ts) to also write a lightweight event row.
 */
export const activityRouter: Router = Router();

const activityReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

/** Each `recent` source is independently capped here before the merge; the
 *  merge re-sorts and caps the combined result at RECENT_TOTAL_CAP. */
const RECENT_SOURCE_CAP = 20;
const RECENT_TOTAL_CAP = 30;
const LIKE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  kind: string;
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

/**
 * Incoming pending friend requests only — never outgoing, never accepted.
 * Always returned in full (no time window), matching useFriendRequests'
 * existing always-live-count semantics.
 */
async function loadActionRequired(callerId: string): Promise<FriendRequestActivityItem[]> {
  const { rows } = await getPool().query<{
    requester_id: string;
    requester_username: string;
    requester_display_name: string | null;
    created_at: string;
  }>(
    `SELECT f.requester_id, u.username AS requester_username, u.display_name AS requester_display_name,
            f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
      WHERE f.addressee_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC`,
    [callerId]
  );
  const items: FriendRequestActivityItem[] = rows.map((r) => ({
    type: 'friend_request',
    id: `friend_request:${r.requester_id}`,
    requesterId: r.requester_id,
    requesterUsername: r.requester_username,
    requesterDisplayName: r.requester_display_name,
    occurredAt: Number(r.created_at),
  }));
  return items;
}

/** Directed shares in the caller's inbox — mirrors shares.ts's GET /inbox
 *  query + per-sender label-resolution shape, capped at RECENT_SOURCE_CAP. */
async function loadDirectShares(callerId: string): Promise<DirectShareActivityItem[]> {
  const { rows } = await getPool().query<{
    token: string;
    kind: string;
    resource_id: string;
    created_at: string;
    sender_id: string;
    sender_username: string;
    sender_display_name: string | null;
  }>(
    `SELECT s.token, s.kind, s.resource_id, s.created_at,
            s.user_id AS sender_id, u.username AS sender_username, u.display_name AS sender_display_name
       FROM shares s
       JOIN users u ON u.id = s.user_id
      WHERE s.addressee_id = $1 AND s.audience = 'direct' AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [callerId, RECENT_SOURCE_CAP]
  );

  // Labels resolve against each sender's own resources, so group by sender —
  // same batching shares.ts's own /inbox route does.
  const bySender = new Map<string, Array<{ kind: string; resourceId: string }>>();
  for (const r of rows) {
    const arr = bySender.get(r.sender_id) ?? [];
    arr.push({ kind: r.kind, resourceId: r.resource_id });
    bySender.set(r.sender_id, arr);
  }
  const labels = new Map<string, string>();
  for (const [senderId, refs] of bySender) {
    const resolved = await resolveShareLabels(senderId, refs);
    for (const [k, v] of resolved) labels.set(`${senderId}:${k}`, v);
  }

  const items: DirectShareActivityItem[] = [];
  for (const r of rows) {
    const label = labels.get(`${r.sender_id}:${r.kind}:${r.resource_id}`);
    // A dangling share (resource deleted since) is dropped, not rendered
    // with a missing name — mirrors shares.ts's own /inbox behavior.
    if (label === undefined) continue;
    items.push({
      type: 'direct_share',
      id: `direct_share:${r.token}`,
      token: r.token,
      kind: r.kind,
      fromUsername: r.sender_username,
      fromDisplayName: r.sender_display_name,
      label,
      occurredAt: Number(r.created_at),
    });
  }
  return items;
}

/** Feedback submitted on the caller's own decks. Deck names resolve through
 *  the same resolveShareLabels() shares.ts uses — the caller owns every deck
 *  their own deck_feedback.deckId points at, so the lookup is scoped to their
 *  own user_decks rows (ownerId === callerId). */
async function loadFeedback(callerId: string): Promise<FeedbackActivityItem[]> {
  const { rows } = await getPool().query<{
    id: string;
    deck_id: string;
    author_name: string;
    comment: string;
    created_at: string;
  }>(
    `SELECT id, deck_id, author_name, comment, created_at
       FROM deck_feedback
      WHERE owner_user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [callerId, RECENT_SOURCE_CAP]
  );
  if (rows.length === 0) return [];

  const deckIds = [...new Set(rows.map((r) => r.deck_id))];
  const labels = await resolveShareLabels(
    callerId,
    deckIds.map((id) => ({ kind: 'deck', resourceId: id }))
  );

  const items: FeedbackActivityItem[] = [];
  for (const r of rows) {
    const deckName = labels.get(`deck:${r.deck_id}`);
    // Same "drop rather than render with a missing name" rule as directed
    // shares — the deck this feedback targeted has since been deleted.
    if (deckName === undefined) continue;
    items.push({
      type: 'feedback',
      id: `feedback:${r.id}`,
      deckId: r.deck_id,
      deckName,
      authorName: r.author_name,
      comment: r.comment,
      occurredAt: Number(r.created_at),
    });
  }
  return items;
}

/**
 * Likes on the caller's published decks in the last 7 days, grouped per deck.
 * INNER join (not LEFT) — a like on a deck since deleted drops from the feed
 * entirely rather than rendering with a missing name. Unpublished (but not
 * deleted) publications rows persist forever (see deckPublications' own doc
 * comment), so dropping *those* likes too needs the same explicit
 * `unpublished_at IS NULL` filter deck_bookmarks' own listing query uses —
 * mirrored here rather than relying on the join alone.
 */
async function loadDeckLiked(callerId: string): Promise<DeckLikedActivityItem[]> {
  const cutoff = Date.now() - LIKE_WINDOW_MS;
  const { rows } = await getPool().query<{
    slug: string;
    deck_name: string;
    occurred_at: string;
    cnt: string;
  }>(
    `SELECT dl.slug, dp.deck_name, MAX(dl.created_at) AS occurred_at, COUNT(*) AS cnt
       FROM deck_likes dl JOIN deck_publications dp ON dp.slug = dl.slug
      WHERE dl.deck_owner_id = $1 AND dl.created_at > $2 AND dp.unpublished_at IS NULL
      GROUP BY dl.slug, dp.deck_name ORDER BY occurred_at DESC LIMIT $3`,
    [callerId, cutoff, RECENT_SOURCE_CAP]
  );
  const items: DeckLikedActivityItem[] = rows.map((r) => ({
    type: 'deck_liked',
    id: `deck_liked:${r.slug}`,
    slug: r.slug,
    deckName: r.deck_name,
    count: Number(r.cnt),
    occurredAt: Number(r.occurred_at),
  }));
  return items;
}

activityRouter.get('/', requireAuth, activityReadLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;

  const [actionRequired, directShares, feedback, deckLiked] = await Promise.all([
    loadActionRequired(callerId),
    loadDirectShares(callerId),
    loadFeedback(callerId),
    loadDeckLiked(callerId),
  ]);

  const recent: RecentActivityItem[] = [...directShares, ...feedback, ...deckLiked]
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, RECENT_TOTAL_CAP);

  res.json({ actionRequired, recent });
});
