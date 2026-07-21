import { Router, type Request, type Response } from 'express';
import { requireAuth, normalizeUsername } from '../auth';
import { getDb, getPool } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getScryfallCache } from '../scryfall-cache';
import { areFriends } from '../friends/relations';
import { resolveShareLabels } from '../shares/labels';
import { testAwareLimiter } from '../route-utils';

export const friendsRouter: Router = Router();

const friendReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
const friendCollectionLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });
const friendWriteLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

// ────────────────────────────────────────────────
// GET /api/friends
// ────────────────────────────────────────────────
friendsRouter.get('/', requireAuth, friendReadLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const pool = getPool();

  const result = await pool.query<{
    id: string;
    username: string;
    display_name: string | null;
    accepted_at: string;
    card_count: string;
  }>(
    // card_count is unique cards by oracle id — matches how the cube collab
    // pool dedupes (so the picker count == what the friend can bring). The
    // correlated subquery runs once per friend (a handful) and hits the
    // user_cards(user_id, …) index, so it stays cheap.
    `SELECT
       CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS id,
       CASE WHEN f.requester_id = $1 THEN u2.username ELSE u1.username END AS username,
       CASE WHEN f.requester_id = $1 THEN u2.display_name ELSE u1.display_name END AS display_name,
       f.accepted_at,
       COALESCE((
         SELECT COUNT(DISTINCT uc.data->>'oracleId')
         FROM user_cards uc
         WHERE uc.user_id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
           AND uc.deleted_at IS NULL
           AND uc.data->>'oracleId' IS NOT NULL
       ), 0) AS card_count
     FROM friendships f
     JOIN users u1 ON u1.id = f.requester_id
     JOIN users u2 ON u2.id = f.addressee_id
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
       AND f.status = 'accepted'
     ORDER BY f.accepted_at DESC`,
    [callerId]
  );

  const friends = result.rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    friendedAt: Number(r.accepted_at),
    cardCount: Number(r.card_count),
  }));

  res.json({ friends });
});

// ────────────────────────────────────────────────
// GET /api/friends/requests
// ────────────────────────────────────────────────
friendsRouter.get(
  '/requests',
  requireAuth,
  friendReadLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const pool = getPool();

    const result = await pool.query<{
      requester_id: string;
      requester_username: string;
      requester_display_name: string | null;
      addressee_id: string;
      addressee_username: string;
      addressee_display_name: string | null;
      created_at: string;
    }>(
      `SELECT f.requester_id, ur.username AS requester_username, ur.display_name AS requester_display_name,
              f.addressee_id, ua.username AS addressee_username, ua.display_name AS addressee_display_name,
              f.created_at
       FROM friendships f
       JOIN users ur ON ur.id = f.requester_id
       JOIN users ua ON ua.id = f.addressee_id
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [callerId]
    );

    const incoming = result.rows
      .filter((r) => r.addressee_id === callerId)
      .map((r) => ({
        requesterId: r.requester_id,
        requesterUsername: r.requester_username,
        requesterDisplayName: r.requester_display_name,
        addresseeId: r.addressee_id,
        addresseeUsername: r.addressee_username,
        addresseeDisplayName: r.addressee_display_name,
        createdAt: Number(r.created_at),
      }));

    const outgoing = result.rows
      .filter((r) => r.requester_id === callerId)
      .map((r) => ({
        requesterId: r.requester_id,
        requesterUsername: r.requester_username,
        requesterDisplayName: r.requester_display_name,
        addresseeId: r.addressee_id,
        addresseeUsername: r.addressee_username,
        addresseeDisplayName: r.addressee_display_name,
        createdAt: Number(r.created_at),
      }));

    res.json({ incoming, outgoing });
  }
);

// ────────────────────────────────────────────────
// GET /api/friends/activity  (new-from-friends aggregated feed)
// ────────────────────────────────────────────────
//
// Merges two friends-scoped signals into one reverse-chronological feed:
// newly-published public decks (deck_publications) and friends-audience
// shares (shares). Both underlying queries already cap at 30; the merge
// re-sorts and caps the combined result at 30 too.
interface PublishedDeckActivity {
  type: 'published_deck';
  friendUsername: string;
  deckName: string;
  slug: string;
  format: string;
  occurredAt: number;
}

interface SharedContentActivity {
  type: 'shared_content';
  friendUsername: string;
  kind: string;
  token: string;
  label: string;
  occurredAt: number;
}

type FriendActivityItem = PublishedDeckActivity | SharedContentActivity;

friendsRouter.get(
  '/activity',
  requireAuth,
  friendReadLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const pool = getPool();

    const friendRows = await pool.query<{ friend_id: string }>(
      `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
         FROM friendships
        WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
      [callerId]
    );
    const friendIds = friendRows.rows.map((r) => r.friend_id);
    if (friendIds.length === 0) {
      return res.json({ items: [] });
    }

    const [publishedRows, sharedRows] = await Promise.all([
      pool.query<{
        slug: string;
        deck_name: string;
        format: string;
        username: string;
        published_at: string;
      }>(
        `SELECT dp.slug, dp.deck_name, dp.format, u.username, dp.published_at
           FROM deck_publications dp JOIN users u ON u.id = dp.user_id
          WHERE dp.user_id = ANY($1::text[]) AND dp.unpublished_at IS NULL
          ORDER BY dp.published_at DESC LIMIT 30`,
        [friendIds]
      ),
      // Joins users for username — the raw shares table has no display identity
      // of its own (mirrors the published_deck query's own u.username join).
      pool.query<{
        token: string;
        kind: string;
        resource_id: string;
        created_at: string;
        user_id: string;
        username: string;
      }>(
        `SELECT s.token, s.kind, s.resource_id, s.created_at, s.user_id, u.username
           FROM shares s JOIN users u ON u.id = s.user_id
          WHERE s.user_id = ANY($1::text[]) AND s.audience = 'friends' AND s.revoked_at IS NULL
          ORDER BY s.created_at DESC LIMIT 30`,
        [friendIds]
      ),
    ]);

    const published: PublishedDeckActivity[] = publishedRows.rows.map((r) => ({
      type: 'published_deck',
      friendUsername: r.username,
      deckName: r.deck_name,
      slug: r.slug,
      format: r.format,
      occurredAt: Number(r.published_at),
    }));

    // resolveShareLabels is owner-scoped (one query per kind per owner), so
    // batch refs per distinct friend and call it once per owner — not once
    // per share.
    const refsByOwner = new Map<string, { kind: string; resourceId: string }[]>();
    for (const r of sharedRows.rows) {
      const refs = refsByOwner.get(r.user_id) ?? [];
      refs.push({ kind: r.kind, resourceId: r.resource_id });
      refsByOwner.set(r.user_id, refs);
    }
    const labelEntries = await Promise.all(
      [...refsByOwner.entries()].map(
        async ([ownerId, refs]) => [ownerId, await resolveShareLabels(ownerId, refs)] as const
      )
    );
    const labelsByOwner = new Map(labelEntries);

    const shared: SharedContentActivity[] = [];
    for (const r of sharedRows.rows) {
      const label = labelsByOwner.get(r.user_id)?.get(`${r.kind}:${r.resource_id}`) ?? null;
      // Revoked shares are already excluded by the query; a null label means
      // the underlying resource was deleted since — drop it, same as
      // GET /:friendId/shares.
      if (label === null) continue;
      shared.push({
        type: 'shared_content',
        friendUsername: r.username,
        kind: r.kind,
        token: r.token,
        label,
        occurredAt: Number(r.created_at),
      });
    }

    const items: FriendActivityItem[] = [...published, ...shared]
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 30);

    return res.json({ items });
  }
);

// ────────────────────────────────────────────────
// POST /api/friends/requests
// ────────────────────────────────────────────────
friendsRouter.post(
  '/requests',
  requireAuth,
  friendWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const body = req.body as { username?: unknown };
    const rawUsername = body.username;

    const username = normalizeUsername(rawUsername);
    if (!username) {
      return res.status(400).json({ error: 'Invalid username.' });
    }

    const db = getDb();

    // Look up the target user
    const targetRows = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (targetRows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const target = targetRows[0];

    if (target.id === callerId) {
      return res.status(400).json({ error: 'Cannot send a friend request to yourself.' });
    }

    // Check for existing rows in either direction
    const pool = getPool();
    const existing = await pool.query<{
      requester_id: string;
      addressee_id: string;
      status: string;
      accepted_at: string | null;
    }>(
      `SELECT requester_id, addressee_id, status, accepted_at
       FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [callerId, target.id]
    );

    for (const row of existing.rows) {
      const isForward = row.requester_id === callerId && row.addressee_id === target.id;
      const isReverse = row.requester_id === target.id && row.addressee_id === callerId;

      if (row.status === 'accepted') {
        return res.status(409).json({ error: 'Already friends.' });
      }
      if (row.status === 'pending' && isForward) {
        return res.status(409).json({ error: 'Friend request already sent.' });
      }
      if (row.status === 'pending' && isReverse) {
        // Auto-accept: update the reverse pending row to accepted
        const now = Date.now();
        await pool.query(
          `UPDATE friendships SET status = 'accepted', accepted_at = $1
           WHERE requester_id = $2 AND addressee_id = $3`,
          [now, target.id, callerId]
        );
        return res.status(201).json({
          friendStatus: 'friends',
          addressee: { id: target.id, username: target.username, displayName: target.displayName },
        });
      }
    }

    // No existing row — insert new pending request. The pair-unique index
    // (friendships_pair_idx) can still reject this if the reverse request
    // lands between the check above and the insert — the E69 race that used
    // to leave two pending rows. Treat that violation as "the reverse row
    // just appeared" and resolve it the same way the check would have.
    const now = Date.now();
    try {
      await pool.query(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
         VALUES ($1, $2, 'pending', $3)`,
        [callerId, target.id, now]
      );
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      const accepted = await pool.query(
        `UPDATE friendships SET status = 'accepted', accepted_at = $1
         WHERE requester_id = $2 AND addressee_id = $3 AND status = 'pending'
         RETURNING requester_id`,
        [now, target.id, callerId]
      );
      if (accepted.rowCount === 1) {
        return res.status(201).json({
          friendStatus: 'friends',
          addressee: { id: target.id, username: target.username, displayName: target.displayName },
        });
      }
      // Not a pending reverse row — either our own duplicate direction
      // (double-tap) or a pair that just got accepted. Mirror the check's
      // responses.
      const pair = await pool.query<{ status: string }>(
        `SELECT status FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2)
            OR (requester_id = $2 AND addressee_id = $1)`,
        [callerId, target.id]
      );
      if (pair.rows.some((r) => r.status === 'accepted')) {
        return res.status(409).json({ error: 'Already friends.' });
      }
      return res.status(409).json({ error: 'Friend request already sent.' });
    }

    return res.status(201).json({
      friendStatus: 'request_sent',
      addressee: { id: target.id, username: target.username, displayName: target.displayName },
    });
  }
);

// ────────────────────────────────────────────────
// POST /api/friends/requests/:requesterId/accept
// ────────────────────────────────────────────────
friendsRouter.post(
  '/requests/:requesterId/accept',
  requireAuth,
  friendWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const requesterId = String(req.params.requesterId ?? '');
    const pool = getPool();
    const now = Date.now();

    // Find the pending row where requester=requesterId, addressee=caller
    const result = await pool.query<{ requester_id: string; addressee_id: string }>(
      `UPDATE friendships SET status = 'accepted', accepted_at = $1
       WHERE requester_id = $2 AND addressee_id = $3 AND status = 'pending'
       RETURNING requester_id, addressee_id`,
      [now, requesterId, callerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Friend request not found.' });
    }

    // Get the requester's username
    const db = getDb();
    const userRows = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, requesterId))
      .limit(1);

    const requester = userRows[0];
    if (!requester) {
      return res.status(404).json({ error: 'Friend request not found.' });
    }

    return res.json({
      friend: {
        id: requester.id,
        username: requester.username,
        displayName: requester.displayName,
        friendedAt: now,
      },
    });
  }
);

// ────────────────────────────────────────────────
// POST /api/friends/requests/:requesterId/decline
// ────────────────────────────────────────────────
friendsRouter.post(
  '/requests/:requesterId/decline',
  requireAuth,
  friendWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const requesterId = String(req.params.requesterId ?? '');
    const pool = getPool();

    const result = await pool.query(
      `DELETE FROM friendships
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [requesterId, callerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Friend request not found.' });
    }

    return res.status(204).end();
  }
);

// ────────────────────────────────────────────────
// DELETE /api/friends/requests/:addresseeId  (cancel outgoing)
// ────────────────────────────────────────────────
friendsRouter.delete(
  '/requests/:addresseeId',
  requireAuth,
  friendWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const addresseeId = String(req.params.addresseeId ?? '');
    const pool = getPool();

    const result = await pool.query(
      `DELETE FROM friendships
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [callerId, addresseeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Friend request not found.' });
    }

    return res.status(204).end();
  }
);

// ────────────────────────────────────────────────
// GET /api/friends/:friendId/collection
// ────────────────────────────────────────────────

interface FriendCard {
  name: string;
  oracleId: string;
  colors: string[];
  cmc: number;
  typeLine: string;
  edhrecRank?: number;
}

interface FriendCollectionResponse {
  ownerUsername: string;
  ownerDisplayName: string | null;
  cards: FriendCard[];
}

/**
 * Confirms the caller is friends with friendId and returns the friend's
 * { id, username, displayName }. Returns null and writes a 403 if not friends
 * or user not found — callers must return immediately on null.
 */
async function requireFriendship(
  res: Response,
  callerId: string,
  friendId: string
): Promise<{ id: string; username: string; displayName: string | null } | null> {
  if (!(await areFriends(callerId, friendId))) {
    res.status(403).json({ error: 'Not friends.' });
    return null;
  }
  const db = getDb();
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, friendId))
    .limit(1);
  if (rows.length === 0) {
    res.status(403).json({ error: 'Not friends.' });
    return null;
  }
  return rows[0];
}

friendsRouter.get(
  '/:friendId/collection',
  requireAuth,
  friendCollectionLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const friendId = String(req.params.friendId ?? '');
    const pool = getPool();

    // 1. Confirm friendship and fetch the owner's username
    const target = await requireFriendship(res, callerId, friendId);
    if (!target) return;

    // 3. Fetch friend's non-deleted cards
    const cardRows = await pool.query<{ data: unknown; id: string }>(
      `SELECT id, data FROM user_cards
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [friendId]
    );

    // 4. Dedupe by oracleId; collect scryfallIds for rank fallback
    const seenOracleIds = new Set<string>();
    const deduped: Array<{ data: Record<string, unknown>; scryfallId: string }> = [];

    for (const row of cardRows.rows) {
      const d = row.data as Record<string, unknown>;
      if (!d) continue;
      const oracleId = typeof d.oracleId === 'string' ? d.oracleId : '';
      if (!oracleId) continue;
      if (seenOracleIds.has(oracleId)) continue;
      seenOracleIds.add(oracleId);
      const scryfallId = typeof d.scryfallId === 'string' ? d.scryfallId : '';
      deduped.push({ data: d, scryfallId });
    }

    // 5. Bulk-fetch Scryfall cache for rank fallback (only for cards missing edhrecRank)
    const scryfallIds = deduped
      .filter((e) => typeof e.data.edhrecRank !== 'number' && e.scryfallId)
      .map((e) => e.scryfallId);

    const scryfallMap =
      scryfallIds.length > 0 ? getScryfallCache().getMany(scryfallIds) : new Map();

    // 6. Project to FriendCard — only public oracle-level fields
    const cards: FriendCard[] = [];
    for (const { data: d, scryfallId } of deduped) {
      const name = typeof d.name === 'string' ? d.name : '';
      const oracleId = typeof d.oracleId === 'string' ? d.oracleId : '';
      if (!name || !oracleId) continue;

      const colors = Array.isArray(d.colors)
        ? (d.colors as unknown[]).filter((c): c is string => typeof c === 'string')
        : [];
      const cmc = typeof d.cmc === 'number' ? d.cmc : 0;
      const typeLine = typeof d.typeLine === 'string' ? d.typeLine : '';

      // Prefer rank from stored JSONB; fall back to SQLite cache
      let edhrecRank: number | undefined;
      if (typeof d.edhrecRank === 'number') {
        edhrecRank = d.edhrecRank;
      } else if (scryfallId) {
        const cached = scryfallMap.get(scryfallId);
        if (cached && typeof cached.edhrec_rank === 'number') {
          edhrecRank = cached.edhrec_rank;
        }
      }

      const card: FriendCard = { name, oracleId, colors, cmc, typeLine };
      if (edhrecRank !== undefined) card.edhrecRank = edhrecRank;
      cards.push(card);
    }

    const response: FriendCollectionResponse = {
      ownerUsername: target.username,
      ownerDisplayName: target.displayName,
      cards,
    };

    return res.json(response);
  }
);

// ────────────────────────────────────────────────
// GET /api/friends/:friendId/shares  (friend hub — a friend's friends-visible shares)
// ────────────────────────────────────────────────
//
// Registered before DELETE /:friendId; the literal /requests routes above
// already win over the /:friendId wildcard, so /:friendId/shares is the right
// slot. Returns only audience='friends' shares — directed shares are private to
// their recipient and never surface here. The viewer opens /s/:token, which
// re-checks friendship server-side, so the token list is not a capability leak.
friendsRouter.get(
  '/:friendId/shares',
  requireAuth,
  friendReadLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const friendId = String(req.params.friendId ?? '');

    // Confirm friendship and fetch the owner's username.
    const owner = await requireFriendship(res, callerId, friendId);
    if (!owner) return;

    const pool = getPool();
    const rows = await pool.query<{
      token: string;
      kind: string;
      resource_id: string;
      created_at: string;
    }>(
      `SELECT token, kind, resource_id, created_at
         FROM shares
        WHERE user_id = $1 AND audience = 'friends' AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [friendId]
    );

    const labels = await resolveShareLabels(
      friendId,
      rows.rows.map((r) => ({ kind: r.kind, resourceId: r.resource_id }))
    );

    const shares = rows.rows
      .map((r) => ({
        token: r.token,
        kind: r.kind,
        resourceId: r.resource_id,
        label: labels.get(`${r.kind}:${r.resource_id}`) ?? null,
        createdAt: Number(r.created_at),
      }))
      // Drop shares whose underlying resource no longer exists (deleted deck /
      // cube / list) — they'd 404 on open, so don't advertise them.
      .filter((s) => s.label !== null);

    return res.json({ ownerUsername: owner.username, ownerDisplayName: owner.displayName, shares });
  }
);

// ────────────────────────────────────────────────
// DELETE /api/friends/:friendId  (unfriend either direction)
// ────────────────────────────────────────────────
friendsRouter.delete(
  '/:friendId',
  requireAuth,
  friendWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const friendId = String(req.params.friendId ?? '');
    const pool = getPool();

    const result = await pool.query(
      `DELETE FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2)
              OR (requester_id = $2 AND addressee_id = $1))`,
      [callerId, friendId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Friend not found.' });
    }

    return res.status(204).end();
  }
);
