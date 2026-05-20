import { Router, type Request, type Response } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import { requireAdmin } from '../auth';
import { getDb } from '../db';
import { users, userData } from '../db/schema';

export const adminRouter: Router = Router();

/**
 * GET /api/admin/users
 * List every user with role, registration date, and a rough byte-size of
 * their synced state (so an admin can spot which accounts are heavy). The
 * size is computed via `pg_column_size` against the user_data JSONB columns
 * so it's cheap even when the rows are 20MB+.
 */
adminRouter.get('/users', requireAdmin, async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
      dataBytes: sql<number>`COALESCE(
        pg_column_size(${userData.collection})
        + pg_column_size(${userData.binders})
        + pg_column_size(${userData.decks})
        + pg_column_size(${userData.games})
      , 0)`,
    })
    .from(users)
    .leftJoin(userData, eq(userData.userId, users.id))
    .orderBy(desc(users.createdAt));
  res.json({ users: rows });
});

/**
 * DELETE /api/admin/users/:id
 * Hard-delete a user account. `user_data` and related rows cascade via FK.
 * Guards against an admin deleting themselves (would lock them out of the
 * admin panel and likely orphan the only admin seat).
 */
adminRouter.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return res.status(400).json({ error: 'Missing user id.' });
  }
  if (id === req.user!.id) {
    return res
      .status(400)
      .json({ error: 'You cannot delete your own account from the admin panel.' });
  }
  const db = getDb();
  const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (deleted.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ ok: true });
});
