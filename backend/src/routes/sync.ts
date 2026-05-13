import { Router, type Request, type Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { userData } from '../db/schema';

export const syncRouter: Router = Router();

interface SyncSnapshot {
  collection: unknown;
  binders: unknown;
  decks: unknown;
  games: unknown;
  version: number;
  updatedAt: number;
}

async function loadSnapshot(userId: string): Promise<SyncSnapshot> {
  const db = getDb();
  const rows = await db.select().from(userData).where(eq(userData.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    // Should not happen — registration creates the row — but recover gracefully.
    const now = Date.now();
    await db.insert(userData).values({
      userId,
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 0,
      updatedAt: now,
    });
    return { collection: null, binders: [], decks: [], games: [], version: 0, updatedAt: now };
  }
  return {
    collection: row.collection ?? null,
    binders: row.binders ?? [],
    decks: row.decks ?? [],
    games: row.games ?? [],
    version: row.version ?? 0,
    updatedAt: row.updatedAt ?? Date.now(),
  };
}

syncRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const snap = await loadSnapshot(req.user!.id);
  res.json(snap);
});

syncRouter.put('/', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as {
    collection?: unknown;
    binders?: unknown;
    decks?: unknown;
    games?: unknown;
    baseVersion?: unknown;
  };
  if (typeof body.baseVersion !== 'number') {
    return res.status(400).json({ error: 'baseVersion is required.' });
  }
  if (!Array.isArray(body.binders) || !Array.isArray(body.decks)) {
    return res.status(400).json({ error: 'binders and decks must be arrays.' });
  }
  // games is allowed to be omitted by older clients — treat as no-op (keep existing).
  if (body.games !== undefined && !Array.isArray(body.games)) {
    return res.status(400).json({ error: 'games must be an array if provided.' });
  }
  // collection is allowed to be null (no upload yet) or any object shape.

  const db = getDb();
  const now = Date.now();
  // Optimistic concurrency: only update when DB version matches client's base.
  const setPayload: Record<string, unknown> = {
    collection: body.collection ?? null,
    binders: body.binders,
    decks: body.decks,
    version: body.baseVersion + 1,
    updatedAt: now,
  };
  if (Array.isArray(body.games)) {
    setPayload.games = body.games;
  }
  const updated = await db
    .update(userData)
    .set(setPayload)
    .where(and(eq(userData.userId, req.user!.id), eq(userData.version, body.baseVersion)))
    .returning({ version: userData.version, updatedAt: userData.updatedAt });

  if (updated.length === 0) {
    const current = await loadSnapshot(req.user!.id);
    return res.status(409).json({ error: 'Version conflict.', current });
  }

  res.json({ version: updated[0].version, updatedAt: updated[0].updatedAt });
});
