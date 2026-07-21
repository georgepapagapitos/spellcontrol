import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { testAwareLimiter } from '../route-utils';
import { requireAuth } from '../auth';
import { getDb, getPool } from '../db';
import { pods, podMembers } from '../db/schema';
import { areFriends } from '../friends/relations';

/**
 * Pods: private playgroups of friends who play together repeatedly. A pod is
 * just a name + owner; the owner is a member by definition (auto-membership
 * at creation, mirroring game-night's "the host is going" row). Invites are
 * owner-only and friend-gated — the same `areFriends` check game-night's
 * `cleanInvitees` uses, no new permission concept. Ownership never
 * transfers: the owner deletes the pod to end it (matches game-night's
 * identical lack of a host-transfer feature). No color/avatar identity and
 * no public/discoverable pages in v1 — pods are ring-2 playgroup content,
 * not ring-3 discovery content.
 */
export const podsRouter: Router = Router();

const podReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 }); // mirrors friendReadLimiter
const podWriteLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 }); // mirrors friendWriteLimiter

const POD_NAME_MAX = 60;
const MAX_POD_MEMBERS = 24;

/** Trimmed string within [1, max] length, else null. */
function cleanRequired(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

interface PodListItem {
  id: string;
  name: string;
  ownerUserId: string;
  ownerUsername: string;
  createdAt: number;
  myStatus: 'invited' | 'member';
  memberCount: number;
}

interface PodMemberView {
  userId: string;
  username: string;
  status: 'invited' | 'member';
  joinedAt: number | null;
}

// ────────────────────────────────────────────────
// POST /api/pods
// ────────────────────────────────────────────────
podsRouter.post('/', requireAuth, podWriteLimiter, async (req: Request, res: Response) => {
  const name = cleanRequired((req.body as Record<string, unknown>)?.name, POD_NAME_MAX);
  if (!name) {
    return res
      .status(400)
      .json({ error: `Pod name is required (max ${POD_NAME_MAX} characters).` });
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const ownerId = req.user!.id;
  const db = getDb();

  await db.insert(pods).values({ id, name, ownerUserId: ownerId, createdAt: now });
  // The owner is a member by definition — keeps the roster and membership
  // lifecycle honest from the start (mirrors game-night's host auto-RSVP).
  await db.insert(podMembers).values({
    podId: id,
    userId: ownerId,
    status: 'member',
    invitedAt: now,
    joinedAt: now,
  });

  const pod: PodListItem = {
    id,
    name,
    ownerUserId: ownerId,
    // Immutable post-registration (see auth.ts) — the JWT's username is
    // always current, no need to re-read it from the DB.
    ownerUsername: req.user!.username,
    createdAt: now,
    myStatus: 'member',
    memberCount: 1,
  };
  return res.status(201).json({ pod });
});

// ────────────────────────────────────────────────
// GET /api/pods
// ────────────────────────────────────────────────
podsRouter.get('/', requireAuth, podReadLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const pool = getPool();

  const result = await pool.query<{
    id: string;
    name: string;
    owner_user_id: string;
    owner_username: string;
    created_at: string;
    my_status: 'invited' | 'member';
    member_count: string;
  }>(
    `SELECT p.id, p.name, p.owner_user_id, o.username AS owner_username, p.created_at,
            pm.status AS my_status,
            (SELECT COUNT(*) FROM pod_members m
              WHERE m.pod_id = p.id AND m.status = 'member') AS member_count
       FROM pods p
       JOIN pod_members pm ON pm.pod_id = p.id AND pm.user_id = $1
       JOIN users o ON o.id = p.owner_user_id
      ORDER BY p.created_at DESC`,
    [callerId]
  );

  const podList: PodListItem[] = result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerUserId: r.owner_user_id,
    ownerUsername: r.owner_username,
    createdAt: Number(r.created_at),
    myStatus: r.my_status,
    memberCount: Number(r.member_count),
  }));

  return res.json({ pods: podList });
});

// ────────────────────────────────────────────────
// GET /api/pods/:id
// ────────────────────────────────────────────────
podsRouter.get('/:id', requireAuth, podReadLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const podId = String(req.params.id ?? '');
  const pool = getPool();

  // One query: pod existence + the caller's own membership row (LEFT JOIN so
  // a caller with no row still gets a pod-existence answer to branch on).
  const found = await pool.query<{
    id: string;
    name: string;
    owner_user_id: string;
    owner_username: string;
    created_at: string;
    my_status: 'invited' | 'member' | null;
  }>(
    `SELECT p.id, p.name, p.owner_user_id, o.username AS owner_username, p.created_at,
            pm.status AS my_status
       FROM pods p
       JOIN users o ON o.id = p.owner_user_id
       LEFT JOIN pod_members pm ON pm.pod_id = p.id AND pm.user_id = $2
      WHERE p.id = $1`,
    [podId, callerId]
  );
  // A caller with no row is treated the same as a nonexistent pod — the same
  // stealth 404 the rest of the app uses for non-owner access.
  if (found.rows.length === 0 || found.rows[0].my_status === null) {
    return res.status(404).json({ error: 'Pod not found.' });
  }
  const pod = found.rows[0];

  const memberRows = await pool.query<{
    user_id: string;
    username: string;
    status: 'invited' | 'member';
    joined_at: string | null;
  }>(
    `SELECT m.user_id, u.username, m.status, m.joined_at
       FROM pod_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.pod_id = $1
      ORDER BY m.invited_at ASC`,
    [podId]
  );
  const members: PodMemberView[] = memberRows.rows.map((m) => ({
    userId: m.user_id,
    username: m.username,
    status: m.status,
    joinedAt: m.joined_at !== null ? Number(m.joined_at) : null,
  }));

  return res.json({
    id: pod.id,
    name: pod.name,
    ownerUserId: pod.owner_user_id,
    ownerUsername: pod.owner_username,
    createdAt: Number(pod.created_at),
    myStatus: pod.my_status,
    members,
  });
});

// ────────────────────────────────────────────────
// PATCH /api/pods/:id  (owner only)
// ────────────────────────────────────────────────
podsRouter.patch('/:id', requireAuth, podWriteLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const podId = String(req.params.id ?? '');
  const name = cleanRequired((req.body as Record<string, unknown>)?.name, POD_NAME_MAX);
  if (!name) {
    return res
      .status(400)
      .json({ error: `Pod name is required (max ${POD_NAME_MAX} characters).` });
  }

  const db = getDb();
  // Non-owner gets the same 404 as a bad id — don't confirm the pod exists.
  const updated = await db
    .update(pods)
    .set({ name })
    .where(and(eq(pods.id, podId), eq(pods.ownerUserId, callerId)))
    .returning({ id: pods.id, createdAt: pods.createdAt });
  if (updated.length === 0) {
    return res.status(404).json({ error: 'Pod not found.' });
  }

  const memberCountRes = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM pod_members WHERE pod_id = $1 AND status = 'member'`,
    [podId]
  );

  const pod: PodListItem = {
    id: podId,
    name,
    ownerUserId: callerId,
    ownerUsername: req.user!.username,
    createdAt: Number(updated[0].createdAt),
    myStatus: 'member',
    memberCount: Number(memberCountRes.rows[0].count),
  };
  return res.json({ pod });
});

// ────────────────────────────────────────────────
// DELETE /api/pods/:id  (owner only) — hard delete, pod_members cascades
// ────────────────────────────────────────────────
podsRouter.delete('/:id', requireAuth, podWriteLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const podId = String(req.params.id ?? '');
  const db = getDb();

  const deleted = await db
    .delete(pods)
    .where(and(eq(pods.id, podId), eq(pods.ownerUserId, callerId)))
    .returning({ id: pods.id });
  if (deleted.length === 0) {
    return res.status(404).json({ error: 'Pod not found.' });
  }
  return res.status(204).end();
});

// ────────────────────────────────────────────────
// POST /api/pods/:id/invites  (owner only)
// ────────────────────────────────────────────────
podsRouter.post(
  '/:id/invites',
  requireAuth,
  podWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const podId = String(req.params.id ?? '');
    const db = getDb();
    const pool = getPool();

    const owned = await db
      .select({ id: pods.id })
      .from(pods)
      .where(and(eq(pods.id, podId), eq(pods.ownerUserId, callerId)))
      .limit(1);
    if (owned.length === 0) {
      return res.status(404).json({ error: 'Pod not found.' });
    }

    const raw = (req.body as Record<string, unknown>)?.userIds;
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
      return res.status(400).json({ error: 'userIds must be an array of user ids.' });
    }
    const ids = [...new Set(raw as string[])].filter((uid) => uid !== callerId);

    // Validated against the full requested set regardless of existing
    // membership — mirrors game-night's cleanInvitees exactly, same wording.
    for (const uid of ids) {
      if (!(await areFriends(callerId, uid))) {
        return res.status(403).json({ error: 'You can only invite friends.' });
      }
    }

    const existing = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM pod_members WHERE pod_id = $1`,
      [podId]
    );
    const existingIds = new Set(existing.rows.map((r) => r.user_id));
    // Already invited/member: skip as a no-op rather than erroring the whole
    // batch (idempotent re-invite of someone already in).
    const toInvite = ids.filter((uid) => !existingIds.has(uid));

    if (existingIds.size + toInvite.length > MAX_POD_MEMBERS) {
      return res.status(400).json({ error: `Pods can have up to ${MAX_POD_MEMBERS} members.` });
    }

    if (toInvite.length > 0) {
      const now = Date.now();
      await pool.query(
        `INSERT INTO pod_members (pod_id, user_id, status, invited_at, joined_at)
         SELECT $1, unnest($2::text[]), 'invited', $3, NULL
         ON CONFLICT DO NOTHING`,
        [podId, toInvite, now]
      );
    }

    return res.status(200).json({ invited: toInvite });
  }
);

// ────────────────────────────────────────────────
// POST /api/pods/:id/accept
// ────────────────────────────────────────────────
podsRouter.post(
  '/:id/accept',
  requireAuth,
  podWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const podId = String(req.params.id ?? '');
    const now = Date.now();

    const result = await getPool().query(
      `UPDATE pod_members SET status = 'member', joined_at = $1
        WHERE pod_id = $2 AND user_id = $3 AND status = 'invited'`,
      [now, podId, callerId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pod not found.' });
    }
    return res.status(200).json({ status: 'member' });
  }
);

// ────────────────────────────────────────────────
// POST /api/pods/:id/decline
// ────────────────────────────────────────────────
podsRouter.post(
  '/:id/decline',
  requireAuth,
  podWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const podId = String(req.params.id ?? '');

    // Declining leaves no trace — mirrors a declined friend request not
    // being kept around either.
    const result = await getPool().query(
      `DELETE FROM pod_members WHERE pod_id = $1 AND user_id = $2 AND status = 'invited'`,
      [podId, callerId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pod not found.' });
    }
    return res.status(204).end();
  }
);

// ────────────────────────────────────────────────
// DELETE /api/pods/:id/members/me  ("leave")
// Registered before the /:userId wildcard below — same literal-before-
// wildcard ordering friends.ts uses for /:friendId/shares vs /:friendId.
// ────────────────────────────────────────────────
podsRouter.delete(
  '/:id/members/me',
  requireAuth,
  podWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const podId = String(req.params.id ?? '');
    const pool = getPool();

    const podRows = await pool.query<{ owner_user_id: string }>(
      `SELECT owner_user_id FROM pods WHERE id = $1`,
      [podId]
    );
    if (podRows.rows.length === 0) {
      return res.status(404).json({ error: 'Pod not found.' });
    }
    if (podRows.rows[0].owner_user_id === callerId) {
      return res.status(400).json({ error: "You're the pod owner — delete the pod instead." });
    }

    const result = await pool.query(
      `DELETE FROM pod_members WHERE pod_id = $1 AND user_id = $2 AND status = 'member'`,
      [podId, callerId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pod not found.' });
    }
    return res.status(204).end();
  }
);

// ────────────────────────────────────────────────
// DELETE /api/pods/:id/members/:userId  ("remove", owner only)
// ────────────────────────────────────────────────
podsRouter.delete(
  '/:id/members/:userId',
  requireAuth,
  podWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const podId = String(req.params.id ?? '');
    const targetUserId = String(req.params.userId ?? '');
    const pool = getPool();

    const podRows = await pool.query<{ owner_user_id: string }>(
      `SELECT owner_user_id FROM pods WHERE id = $1`,
      [podId]
    );
    if (podRows.rows.length === 0 || podRows.rows[0].owner_user_id !== callerId) {
      return res.status(404).json({ error: 'Pod not found.' });
    }
    // Self-removal is "leave," not "remove" — and the owner can't leave.
    if (targetUserId === callerId) {
      return res.status(400).json({ error: "You're the pod owner — delete the pod instead." });
    }

    const result = await pool.query(`DELETE FROM pod_members WHERE pod_id = $1 AND user_id = $2`, [
      podId,
      targetUserId,
    ]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Member not found.' });
    }
    return res.status(204).end();
  }
);
