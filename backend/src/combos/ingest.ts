import crypto from 'crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { sql } from 'drizzle-orm';
import jsonParser from 'stream-json';
import streamArray from 'stream-json/streamers/stream-array.js';
import { getDb } from '../db';
import { combos, comboCards, comboIngestRuns } from '../db/schema';

const SPELLBOOK_BULK_URL = 'https://json.commanderspellbook.com/variants.json';

/** How many parsed combos to buffer before flushing to Postgres. Bounds peak
 * memory: ~500 combos × (combo row + ~3 card rows) ≈ a few MB regardless of
 * how big the upstream dataset gets. */
const FLUSH_AT = 500;

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

/**
 * Streams the Spellbook bulk variants endpoint, yielding one raw variant at
 * a time. The previous implementation did `await response.json()` which
 * materialized the entire ~100 MB payload into V8 heap, peaking at several
 * hundred MB and OOM-killing small containers. Streaming bounds peak memory
 * to a few MB regardless of dataset size.
 *
 * Handles both top-level shapes the upstream endpoint has used:
 *   - `{ variants: [...] }` (current modern shape)
 *   - `[...]` (legacy / fallback)
 *
 * The detection is done by looking at the first non-whitespace byte of the
 * response stream.
 */
export async function* streamSpellbookVariants(): AsyncIterable<unknown> {
  const response = await fetch(SPELLBOOK_BULK_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'spellcontrol/1.0 (combo-ingest)',
    },
  });
  if (!response.ok) {
    throw new Error(`Spellbook bulk fetch failed: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Spellbook bulk fetch returned no body');
  }

  // Convert WHATWG ReadableStream → Node Readable so stream-json can pipe it.
  const nodeStream = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);

  // Peek the first non-whitespace byte to choose the right pipeline. We use a
  // small buffer because the JSON's leading byte is reliably within the first
  // few bytes (anything else is whitespace).
  const first = await peekFirstNonWhitespace(nodeStream);
  if (first === null) {
    throw new Error('Spellbook bulk response was empty');
  }

  if (first === '[') {
    // Top-level array — stream each element directly. `withParserAsStream`
    // gives us a Duplex that combines `parser()` and `streamArray()` and
    // emits `{key, value}` per array element.
    const pipeline = nodeStream.pipe(streamArray.withParserAsStream());
    for await (const item of pipeline as AsyncIterable<{ key: number; value: unknown }>) {
      yield item.value;
    }
    return;
  }

  if (first === '{') {
    // `{variants: [...]}` — feed the parsed token stream through a small
    // hand-rolled pick that only forwards tokens once we're inside the
    // `variants` array, then hands those to streamArray. Keeps streaming
    // semantics for the (currently dominant) object-shape payload.
    yield* streamArrayUnderKey(nodeStream, 'variants');
    return;
  }

  throw new Error(`Spellbook bulk payload shape unrecognized (first byte: ${first})`);
}

/**
 * For a JSON payload like `{ variants: [...], otherStuff: ... }`, streams
 * the elements of the array at the named top-level key without buffering
 * the array in memory. Implemented as: parse → forward only the tokens
 * that fall inside the target array → streamArray.
 */
async function* streamArrayUnderKey(nodeStream: Readable, key: string): AsyncIterable<unknown> {
  const tokens = nodeStream.pipe(jsonParser());

  // Forward tokens only while we're inside the target value's subtree. We
  // start tracking nesting depth from the moment `keyValue: <key>` is seen
  // (the next token is the start of the value); we stop forwarding when
  // depth returns to 0.
  let inside = false;
  let depth = 0;
  let nextValueIsTarget = false;

  const filter = new Transform({
    objectMode: true,
    transform(chunk: { name: string; value?: unknown }, _enc, cb) {
      if (!inside) {
        if (chunk.name === 'keyValue' && chunk.value === key) {
          nextValueIsTarget = true;
        } else if (
          nextValueIsTarget &&
          (chunk.name === 'startArray' || chunk.name === 'startObject')
        ) {
          inside = true;
          depth = 1;
          nextValueIsTarget = false;
          this.push(chunk);
        } else if (nextValueIsTarget) {
          // Scalar value at the target key — not an array, abort.
          nextValueIsTarget = false;
        }
        cb();
        return;
      }
      this.push(chunk);
      if (chunk.name === 'startArray' || chunk.name === 'startObject') depth++;
      else if (chunk.name === 'endArray' || chunk.name === 'endObject') {
        depth--;
        if (depth === 0) {
          inside = false;
          this.push(null); // signal end downstream
        }
      }
      cb();
    },
  });

  const pipeline = tokens.pipe(filter).pipe(streamArray.asStream());
  for await (const item of pipeline as AsyncIterable<{ key: number; value: unknown }>) {
    yield item.value;
  }
}

/** Reads the first non-whitespace byte from a Node Readable, then unshifts
 * it back so the downstream pipeline still sees the full payload. */
async function peekFirstNonWhitespace(stream: Readable): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let collected = Buffer.alloc(0);
    const onReadable = () => {
      const chunk: Buffer | null = stream.read();
      if (chunk === null) return;
      collected = Buffer.concat([collected, chunk]);
      // Walk for first non-whitespace byte.
      for (let i = 0; i < collected.length; i++) {
        const ch = String.fromCharCode(collected[i]);
        if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
        // Found it — push the buffered bytes back so the downstream pipeline
        // sees the complete JSON, then resolve.
        stream.removeListener('readable', onReadable);
        stream.removeListener('error', onError);
        stream.unshift(collected);
        resolve(ch);
        return;
      }
      // All whitespace so far; keep reading.
    };
    const onError = (err: Error) => {
      stream.removeListener('readable', onReadable);
      reject(err);
    };
    const onEnd = () => {
      stream.removeListener('readable', onReadable);
      stream.removeListener('error', onError);
      resolve(null);
    };
    stream.on('readable', onReadable);
    stream.once('error', onError);
    stream.once('end', onEnd);
  });
}

/**
 * Back-compat wrapper for callers that still want an array. Drains the
 * stream into memory — DO NOT use this for the production scheduler
 * (defeats the streaming win). Kept for tests and any future caller that
 * legitimately wants the full collection in memory.
 */
export async function fetchSpellbookBulk(): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const v of streamSpellbookVariants()) out.push(v);
  return out;
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

/** Adapter: any plain Iterable becomes an AsyncIterable. Lets ingestCombos
 * accept either a streamed source (production) or a literal array (tests). */
async function* asAsync<T>(items: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in Object(items)) {
    yield* items as AsyncIterable<T>;
    return;
  }
  for (const item of items as Iterable<T>) yield item;
}

/**
 * Replaces the combo dataset wholesale. Idempotent — running twice yields the
 * same final state.
 *
 * Streams the source iterable, parses one variant at a time, and flushes
 * every FLUSH_AT combos to Postgres inside one transaction. Peak memory is
 * bounded by FLUSH_AT (a few MB) regardless of how many variants come
 * through — historically a single `await response.json()` would balloon to
 * 200+ MB and OOM small containers.
 *
 * The transaction wraps a TRUNCATE + chunked inserts. Either the whole
 * replacement commits or the previous dataset stays intact; reads racing the
 * commit see either pre- or post-state, never a partial dataset.
 */
export async function ingestCombos(
  source: Iterable<unknown> | AsyncIterable<unknown>
): Promise<IngestResult> {
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
    await db.transaction(async (tx) => {
      await tx.execute(sql`TRUNCATE TABLE combo_cards`);
      await tx.execute(sql`TRUNCATE TABLE combos CASCADE`);

      let queue: ParsedCombo[] = [];

      const flush = async () => {
        if (queue.length === 0) return;
        // Insert combos first so the FK from combo_cards has a target.
        await tx.insert(combos).values(
          queue.map((p) => ({
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
        const cardRows: Array<{
          comboId: string;
          oracleId: string;
          cardName: string;
          quantity: number;
          position: number;
        }> = [];
        for (const p of queue) {
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
        if (cardRows.length > 0) {
          // The card-rows-per-flush count is bounded (FLUSH_AT × max ~10
          // cards) so we can insert in one go without hitting Postgres's
          // 65535-parameter ceiling. ~5000 rows × 4 cols = 20000 params.
          await tx.insert(comboCards).values(cardRows);
        }
        written += queue.length;
        queue = [];
      };

      for await (const raw of asAsync(source)) {
        const parsed = parseVariant(raw);
        if (!parsed) {
          skipped++;
          continue;
        }
        queue.push(parsed);
        if (queue.length >= FLUSH_AT) {
          await flush();
          // Yield to the event loop so the HTTP server can answer health
          // checks (and any in-flight user requests) between batches. The
          // ingest itself runs at roughly the same wall-clock as before;
          // it just stops monopolising the worker, which is what lets a
          // shared-cpu-1x VM survive a full bulk run without flapping its
          // Fly healthchecks. Tested empirically — every flush is ~80-150ms
          // of CPU work, so a single setImmediate per ~500-combo batch is
          // enough breathing room for /health to come back well under the
          // 5s probe timeout.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      await flush();
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
 * Fire-and-forget background refresh: stream the bulk feed and ingest. Logs
 * outcomes; the caller (a setInterval in server.ts) doesn't await success.
 */
export async function runScheduledIngest(): Promise<void> {
  try {
    console.log('[combos] starting scheduled ingest');
    const result = await ingestCombos(streamSpellbookVariants());
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
