import { Router, type Request, type Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { userData } from '../db/schema';

export const syncRouter: Router = Router();

// Per-user stored-snapshot cap. Still a real anti-abuse bound (every GET/PUT
// round-trips the blob through the container), but the old 10MB figure was
// wrong in practice: an EnrichedCard carries full Scryfall data (oracle text,
// legalities, image URLs, mana cost…), so a ~10.7k-copy collection serializes
// to ~16MB and was being rejected with 413 — sync silently never happened.
// 64MB gives that real-world collection ~4x headroom to grow. The Express
// json() limit (server.ts) is set higher so THIS check produces the friendly
// message instead of a raw parser 413. Long-term fix is to stop persisting
// Scryfall-derivable fields and re-enrich on load (much smaller blobs).
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

interface SyncSnapshot {
  collection: unknown;
  binders: unknown;
  decks: unknown;
  games: unknown;
  version: number;
  updatedAt: number;
}

/**
 * Diagnostic summary of a stored/incoming snapshot. Cheap, no PII beyond the
 * userId (already in our logs). Grep the container logs with:
 *   docker compose logs -f backend | grep '\[sync\]'
 */
function summarize(label: string, userId: string, snap: Partial<SyncSnapshot>): string {
  const col = snap.collection as { cards?: unknown } | null | undefined;
  const cards = col && Array.isArray(col.cards) ? col.cards.length : 0;
  const collection = col ? `${cards}cards` : 'null';
  const binders = Array.isArray(snap.binders) ? snap.binders.length : 0;
  const decks = Array.isArray(snap.decks) ? snap.decks.length : 0;
  const games = Array.isArray(snap.games) ? snap.games.length : 0;
  return `[sync] ${label} user=${userId} v=${snap.version ?? '?'} collection=${collection} binders=${binders} decks=${decks} games=${games}`;
}

function collectionCardCount(collection: unknown): number {
  const col = collection as { cards?: unknown } | null | undefined;
  return col && Array.isArray(col.cards) ? col.cards.length : 0;
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
  // What the client is about to reconcile against. If this shows
  // collection=null while binders>0, the server has lost the collection and
  // the client's applyServerSnapshot will blank the in-memory cards (~2s
  // after the IndexedDB hydrate) — the reported "loads then wipes" symptom.
  console.log(summarize('GET', req.user!.id, snap));
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

  const snapshotBytes = Buffer.byteLength(
    JSON.stringify({
      collection: body.collection ?? null,
      binders: body.binders,
      decks: body.decks,
      games: body.games ?? [],
    }),
    'utf8'
  );
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    // Log it: an oversize push means sync is silently failing for this user,
    // and (until this commit) it never showed in the logs because PUT.in is
    // logged AFTER this check. Now it is visible.
    console.log(
      `[sync] PUT.reject user=${req.user!.id} reason=too-large bytes=${snapshotBytes} ` +
        `cap=${MAX_SNAPSHOT_BYTES}`
    );
    return res.status(413).json({
      error: `Saved data is too large (${Math.ceil(snapshotBytes / 1024 / 1024)} MB). Maximum is ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB.`,
    });
  }

  // Diagnostic: compare what's about to be written against what's stored, so a
  // collection-destroying push is loud and attributable in the container logs.
  const prior = await loadSnapshot(req.user!.id);
  const priorCards = collectionCardCount(prior.collection);
  const incomingCards = collectionCardCount(body.collection ?? null);
  const wipe = priorCards > 0 && (body.collection == null || incomingCards === 0);
  console.log(
    `${summarize('PUT.in', req.user!.id, { ...body, version: body.baseVersion as number })} ` +
      `prior.collection=${prior.collection ? `${priorCards}cards` : 'null'} prior.v=${prior.version}` +
      (wipe ? ' *** COLLECTION WIPE: null/empty push over a non-empty stored collection ***' : '')
  );

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
    console.log(
      `[sync] PUT.409 user=${req.user!.id} base=${body.baseVersion} dbv=${current.version} ` +
        `(client re-bases and retries; last-write-wins for fields it touched)`
    );
    return res.status(409).json({ error: 'Version conflict.', current });
  }

  console.log(
    `[sync] PUT.ok user=${req.user!.id} v=${updated[0].version} ` +
      `collection=${body.collection == null ? 'null' : `${incomingCards}cards`}`
  );
  res.json({ version: updated[0].version, updatedAt: updated[0].updatedAt });
});
