import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { combos, comboCards, comboIngestRuns } from '../db/schema';

const SPELLBOOK_BULK_URL = 'https://json.commanderspellbook.com/variants.json';

/**
 * Subset of the Spellbook bulk variant shape we read. The actual feed has many
 * more fields; we accept anything and only pluck what we need so a Spellbook
 * schema change can't crash ingest.
 */
interface SpellbookVariant {
  id?: unknown;
  uses?: unknown;
  produces?: unknown;
  identity?: unknown;
  manaNeeded?: unknown;
  description?: unknown;
  easyPrerequisites?: unknown;
  notablePrerequisites?: unknown;
  otherPrerequisites?: unknown;
  popularity?: unknown;
  legalities?: unknown;
  bracketTag?: unknown;
  bracket?: unknown;
}

interface ParsedPrerequisites {
  easy?: string;
  notable?: string;
}

interface ParsedCombo {
  id: string;
  identity: string;
  produces: string[];
  prerequisites: ParsedPrerequisites | null;
  description: string | null;
  manaNeeded: string | null;
  popularity: number;
  legalities: Record<string, string>;
  cardCount: number;
  bracket: number | null;
  cards: Array<{ oracleId: string; cardName: string; quantity: number; position: number }>;
}

export interface IngestResult {
  written: number;
  skipped: number;
  runId: string;
}

interface BulkPayload {
  variants?: unknown;
}

export async function fetchSpellbookBulk(): Promise<unknown[]> {
  const response = await fetch(SPELLBOOK_BULK_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'spellcontrol/1.0 (combo-ingest)',
    },
  });
  if (!response.ok) {
    throw new Error(`Spellbook bulk fetch failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as BulkPayload | unknown[];
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.variants)) return payload.variants;
  throw new Error('Spellbook bulk payload shape unrecognized');
}

/**
 * Defensive parser. Returns null when the variant is missing the bits we need
 * (id, at least one card with an oracle id) — the dataset has plenty of
 * historical/incomplete variants and we'd rather drop them silently than
 * crash the run.
 */
export function parseVariant(raw: unknown): ParsedCombo | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as SpellbookVariant;

  const id = typeof v.id === 'string' && v.id.length > 0 ? v.id : null;
  if (!id) return null;

  const cards: ParsedCombo['cards'] = [];
  const usesRaw = Array.isArray(v.uses) ? v.uses : [];
  usesRaw.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    const cardObj = (entry as { card?: unknown }).card;
    if (!cardObj || typeof cardObj !== 'object') return;
    const card = cardObj as { name?: unknown; oracleId?: unknown; oracle_id?: unknown };
    const oracleIdRaw = card.oracleId ?? card.oracle_id;
    const name = card.name;
    if (typeof oracleIdRaw !== 'string' || typeof name !== 'string') return;
    if (!oracleIdRaw || !name) return;
    const quantityRaw = (entry as { quantity?: unknown }).quantity;
    const quantity =
      typeof quantityRaw === 'number' && Number.isFinite(quantityRaw) && quantityRaw > 0
        ? Math.floor(quantityRaw)
        : 1;
    // Dedupe within one combo — same oracle id with different positions is
    // possible in Spellbook (multiple instances of one card) but our PK is
    // (combo_id, oracle_id) so we keep the first occurrence and take the max
    // quantity seen across the dupes.
    const existing = cards.find((c) => c.oracleId === oracleIdRaw);
    if (existing) {
      if (quantity > existing.quantity) existing.quantity = quantity;
      return;
    }
    cards.push({ oracleId: oracleIdRaw, cardName: name, quantity, position: idx });
  });
  if (cards.length === 0) return null;

  const produces: string[] = [];
  const producesRaw = Array.isArray(v.produces) ? v.produces : [];
  for (const entry of producesRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const feature = (entry as { feature?: { name?: unknown } }).feature;
    const name = feature?.name;
    if (typeof name === 'string' && name.length > 0) produces.push(name);
  }

  const legalities = parseLegalities(v.legalities);

  return {
    id,
    identity: typeof v.identity === 'string' ? v.identity.toLowerCase() : '',
    produces,
    prerequisites: parsePrerequisites(v),
    description:
      typeof v.description === 'string' && v.description.length > 0 ? v.description : null,
    manaNeeded: typeof v.manaNeeded === 'string' && v.manaNeeded.length > 0 ? v.manaNeeded : null,
    popularity:
      typeof v.popularity === 'number' && Number.isFinite(v.popularity) ? v.popularity : 0,
    legalities,
    cardCount: cards.length,
    bracket: typeof v.bracket === 'number' ? v.bracket : null,
    cards,
  };
}

function parseLegalities(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [format, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      out[format] = value ? 'legal' : 'not_legal';
    } else if (typeof value === 'string') {
      out[format] = value;
    }
  }
  return out;
}

/**
 * Parses Spellbook's three prerequisite fields into our two-bucket structure.
 * Their `easyPrerequisites` and `notablePrerequisites` map cleanly. The legacy
 * `otherPrerequisites` field (rarely populated on modern variants) is appended
 * to `notable` so we never silently drop content.
 */
function parsePrerequisites(v: SpellbookVariant): ParsedPrerequisites | null {
  const easy = typeof v.easyPrerequisites === 'string' ? v.easyPrerequisites.trim() : '';
  const notableRaw =
    typeof v.notablePrerequisites === 'string' ? v.notablePrerequisites.trim() : '';
  const other = typeof v.otherPrerequisites === 'string' ? v.otherPrerequisites.trim() : '';
  const notableParts = [notableRaw, other].filter((p) => p.length > 0);
  const out: ParsedPrerequisites = {};
  if (easy.length > 0) out.easy = easy;
  if (notableParts.length > 0) out.notable = notableParts.join('\n\n');
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Replaces the combo dataset wholesale. Idempotent — running twice yields the
 * same final state. We delete-then-insert per combo to keep the comboCards
 * rows in sync without computing diffs (the dataset is small enough — ~85k
 * combos × ~3 cards average — that this runs in a few seconds against
 * Postgres on a laptop).
 */
export async function ingestCombos(rawVariants: unknown[]): Promise<IngestResult> {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const db = getDb();

  await db.insert(comboIngestRuns).values({
    id: runId,
    startedAt,
    finishedAt: null,
    combosWritten: null,
    source: 'spellbook-bulk',
    error: null,
  });

  let written = 0;
  let skipped = 0;
  let lastError: string | null = null;

  try {
    const parsed: ParsedCombo[] = [];
    for (const raw of rawVariants) {
      const p = parseVariant(raw);
      if (p) parsed.push(p);
      else skipped++;
    }

    // Wrap in a transaction so a partial failure doesn't leave a half-written
    // dataset on disk. Chunk the upserts so the parameter limit (~65k) holds.
    await db.transaction(async (tx) => {
      // Wipe-and-replace is the simplest correctness model. The combos table
      // is read-only relative to user data — no foreign keys point in — so
      // truncating mid-run is safe; reads racing the swap will see either
      // pre-state or post-state, never partial.
      await tx.execute(sql`TRUNCATE TABLE combo_cards`);
      await tx.execute(sql`TRUNCATE TABLE combos CASCADE`);

      const COMBO_CHUNK = 500;
      for (let i = 0; i < parsed.length; i += COMBO_CHUNK) {
        const slice = parsed.slice(i, i + COMBO_CHUNK);
        await tx.insert(combos).values(
          slice.map((p) => ({
            id: p.id,
            identity: p.identity,
            produces: p.produces,
            prerequisites: p.prerequisites,
            description: p.description,
            manaNeeded: p.manaNeeded,
            popularity: p.popularity,
            legalities: p.legalities,
            cardCount: p.cardCount,
            bracket: p.bracket,
            updatedAt: startedAt,
          }))
        );
      }

      const cardRows: Array<{
        comboId: string;
        oracleId: string;
        cardName: string;
        quantity: number;
        position: number;
      }> = [];
      for (const p of parsed) {
        for (const c of p.cards) {
          cardRows.push({
            comboId: p.id,
            oracleId: c.oracleId,
            cardName: c.cardName,
            quantity: c.quantity,
            position: c.position,
          });
        }
      }
      const CARD_CHUNK = 2000;
      for (let i = 0; i < cardRows.length; i += CARD_CHUNK) {
        await tx.insert(comboCards).values(cardRows.slice(i, i + CARD_CHUNK));
      }

      written = parsed.length;
    });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await db
      .update(comboIngestRuns)
      .set({
        finishedAt: Date.now(),
        combosWritten: written,
        error: lastError,
      })
      .where(sql`id = ${runId}`);
  }

  return { written, skipped, runId };
}

/**
 * Fire-and-forget background refresh: pull the bulk feed and ingest. Logs
 * outcomes; the caller (a setInterval in server.ts) doesn't await success.
 */
export async function runScheduledIngest(): Promise<void> {
  try {
    console.log('[combos] starting scheduled ingest');
    const variants = await fetchSpellbookBulk();
    const result = await ingestCombos(variants);
    console.log(
      `[combos] scheduled ingest done — wrote ${result.written}, skipped ${result.skipped}`
    );
  } catch (err) {
    console.error('[combos] scheduled ingest failed:', err);
  }
}

/**
 * Returns the timestamp of the most recent successful ingest, or null when
 * none has finished. Used to skip nightly refreshes when one already ran
 * recently (e.g. after a backend redeploy).
 */
export async function lastSuccessfulIngestAt(): Promise<number | null> {
  const db = getDb();
  const rows = await db
    .select({ finishedAt: comboIngestRuns.finishedAt })
    .from(comboIngestRuns)
    .where(sql`finished_at IS NOT NULL AND error IS NULL`)
    .orderBy(sql`finished_at DESC`)
    .limit(1);
  return rows[0]?.finishedAt ?? null;
}
