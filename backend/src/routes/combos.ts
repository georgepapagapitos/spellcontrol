import { Router, type Request, type Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { combos, comboCards } from '../db/schema';
import { matchCombos, type ComboInput } from '../combos/match';
import { ingestCombos, streamSpellbookVariants } from '../combos/ingest';

export const combosRouter: Router = Router();

const MAX_OWNED_IDS = 10_000;
const MAX_DECK_IDS = 500;

function adminUsernames(): Set<string> {
  const raw = process.env.ADMIN_USERNAMES ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function asStringArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Loads every combo that contains at least one of the supplied oracle ids,
 * along with its full card list. The oracle index makes the first hop
 * trivial; the second `inArray(combos.id, ids)` pulls the metadata for those
 * combos in one round-trip.
 */
async function loadRelevantCombos(oracleIds: string[]): Promise<ComboInput[]> {
  if (oracleIds.length === 0) return [];
  const db = getDb();

  const matchingComboIds = await db
    .selectDistinct({ comboId: comboCards.comboId })
    .from(comboCards)
    .where(inArray(comboCards.oracleId, oracleIds));
  const ids = matchingComboIds.map((r) => r.comboId);
  if (ids.length === 0) return [];

  const [comboRows, cardRows] = await Promise.all([
    db.select().from(combos).where(inArray(combos.id, ids)),
    db
      .select()
      .from(comboCards)
      .where(inArray(comboCards.comboId, ids))
      .orderBy(comboCards.position),
  ]);

  const cardsByCombo = new Map<string, ComboInput['cards']>();
  for (const r of cardRows) {
    const list = cardsByCombo.get(r.comboId) ?? [];
    list.push({ oracleId: r.oracleId, cardName: r.cardName, quantity: r.quantity });
    cardsByCombo.set(r.comboId, list);
  }

  return comboRows.map((row) => ({
    id: row.id,
    identity: row.identity,
    produces: row.produces,
    prerequisites: row.prerequisites,
    description: row.description,
    manaNeeded: row.manaNeeded,
    popularity: row.popularity,
    legalities: row.legalities,
    cardCount: row.cardCount,
    bracket: row.bracket,
    cards: cardsByCombo.get(row.id) ?? [],
  }));
}

combosRouter.post('/match', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as {
    ownedOracleIds?: unknown;
    deckOracleIds?: unknown;
    format?: unknown;
  };

  const ownedOracleIds = asStringArray(body.ownedOracleIds, MAX_OWNED_IDS);
  if (!ownedOracleIds) {
    return res.status(400).json({ error: 'ownedOracleIds must be a string array.' });
  }
  const deckOracleIds =
    body.deckOracleIds === undefined ? undefined : asStringArray(body.deckOracleIds, MAX_DECK_IDS);
  if (body.deckOracleIds !== undefined && deckOracleIds === null) {
    return res.status(400).json({ error: 'deckOracleIds must be a string array if provided.' });
  }
  const format = typeof body.format === 'string' ? body.format : undefined;

  // Only fetch combos that touch at least one card the user has present
  // (deck ∪ collection). The seeded set is what `matchCombos` then buckets.
  const seedIds = new Set<string>(ownedOracleIds);
  if (deckOracleIds) for (const id of deckOracleIds) seedIds.add(id);

  const relevant = await loadRelevantCombos(Array.from(seedIds));
  const result = matchCombos({
    combos: relevant,
    ownedOracleIds,
    deckOracleIds: deckOracleIds ?? undefined,
    format,
  });

  res.json(result);
});

combosRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return res.status(400).json({ error: 'id is required.' });
  }
  const db = getDb();
  const [comboRow] = await db.select().from(combos).where(eq(combos.id, id)).limit(1);
  if (!comboRow) {
    return res.status(404).json({ error: 'Combo not found.' });
  }
  const cards = await db
    .select()
    .from(comboCards)
    .where(eq(comboCards.comboId, id))
    .orderBy(comboCards.position);

  res.json({
    id: comboRow.id,
    identity: comboRow.identity,
    produces: comboRow.produces,
    prerequisites: comboRow.prerequisites,
    description: comboRow.description,
    manaNeeded: comboRow.manaNeeded,
    popularity: comboRow.popularity,
    legalities: comboRow.legalities,
    cardCount: comboRow.cardCount,
    bracket: comboRow.bracket,
    cards: cards.map((c) => ({
      oracleId: c.oracleId,
      cardName: c.cardName,
      quantity: c.quantity,
      position: c.position,
    })),
  });
});

combosRouter.post('/admin/refresh', requireAuth, async (req: Request, res: Response) => {
  const admins = adminUsernames();
  if (admins.size === 0 || !admins.has(req.user!.username.toLowerCase())) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  try {
    const result = await ingestCombos(streamSpellbookVariants());
    res.json(result);
  } catch (err) {
    console.error('[combos] admin refresh failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Refresh failed: ${message}` });
  }
});
