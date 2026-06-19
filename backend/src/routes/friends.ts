import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../auth';
import { getDb, getPool } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export const friendsRouter: Router = Router();

const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;

const friendReadLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, max: 60 });

const friendWriteLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, max: 20 });

// ────────────────────────────────────────────────
// GET /api/friends
// ────────────────────────────────────────────────
friendsRouter.get('/', requireAuth, friendReadLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const pool = getPool();

  const result = await pool.query<{
    id: string;
    username: string;
    accepted_at: string;
  }>(
    `SELECT
       CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS id,
       CASE WHEN f.requester_id = $1 THEN u2.username ELSE u1.username END AS username,
       f.accepted_at
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
    friendedAt: Number(r.accepted_at),
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
      addressee_id: string;
      addressee_username: string;
      created_at: string;
    }>(
      `SELECT f.requester_id, ur.username AS requester_username,
              f.addressee_id, ua.username AS addressee_username,
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
        addresseeId: r.addressee_id,
        addresseeUsername: r.addressee_username,
        createdAt: Number(r.created_at),
      }));

    const outgoing = result.rows
      .filter((r) => r.requester_id === callerId)
      .map((r) => ({
        requesterId: r.requester_id,
        requesterUsername: r.requester_username,
        addresseeId: r.addressee_id,
        addresseeUsername: r.addressee_username,
        createdAt: Number(r.created_at),
      }));

    res.json({ incoming, outgoing });
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

    if (typeof rawUsername !== 'string' || !/^[a-z0-9_-]{3,32}$/.test(rawUsername)) {
      return res.status(400).json({ error: 'Invalid username.' });
    }
    const username = rawUsername;

    const db = getDb();

    // Look up the target user
    const targetRows = await db
      .select({ id: users.id, username: users.username })
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
          addressee: { id: target.id, username: target.username },
        });
      }
    }

    // No existing row — insert new pending request
    const now = Date.now();
    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
       VALUES ($1, $2, 'pending', $3)`,
      [callerId, target.id, now]
    );

    return res.status(201).json({
      friendStatus: 'request_sent',
      addressee: { id: target.id, username: target.username },
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
      .select({ id: users.id, username: users.username })
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
