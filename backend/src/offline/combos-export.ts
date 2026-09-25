import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { asc, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { combos, comboCards } from '../db/schema';
import type { OfflineCombo, OfflineComboCard } from './types';

const REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — combos refresh nightly via ingest

interface CombosPayload {
  version: string;
  comboCount: number;
  rawBytes: number;
  gzippedBytes: number;
  updatedAt: number;
  /** The dataset as one gzipped JSON array — the legacy shape. */
  gzipped: Buffer;
  /**
   * The same rows as gzipped NDJSON (one combo per line). Clients read this
   * incrementally and insert as rows arrive, so a 107k-row dataset never has
   * to exist as a single 160 MB string (or array) in a WebView's heap.
   */
  gzippedNdjson: Buffer;
}

/**
 * Gzip a sequence of string parts without ever materializing the joined text:
 * each part is hashed, counted and written to the compressor as it is produced,
 * honouring backpressure. Keeps the six-hourly rebuild's peak at "rows in
 * memory + ~18 MB of gzip" instead of "rows + 160 MB string + 160 MB buffer".
 */
async function gzipParts(
  parts: Iterable<string>
): Promise<{ gz: Buffer; rawBytes: number; sha1: string }> {
  const hash = createHash('sha1');
  const chunks: Buffer[] = [];
  let rawBytes = 0;
  const gz = createGzip();
  gz.on('data', (c: Buffer) => chunks.push(c));
  const ended = once(gz, 'end');
  for (const part of parts) {
    const b = Buffer.from(part, 'utf-8');
    rawBytes += b.byteLength;
    hash.update(b);
    if (!gz.write(b)) await once(gz, 'drain');
  }
  gz.end();
  await ended;
  return { gz: Buffer.concat(chunks), rawBytes, sha1: hash.digest('hex') };
}

/** `[row,row,…]` — byte-identical to `JSON.stringify(rows)`, so the version hash is unchanged. */
function* jsonArrayParts(lines: string[]): Iterable<string> {
  yield '[';
  for (let i = 0; i < lines.length; i++) yield i === 0 ? lines[i] : `,${lines[i]}`;
  yield ']';
}

function* ndjsonParts(lines: string[]): Iterable<string> {
  for (const line of lines) yield `${line}\n`;
}

let current: CombosPayload | null = null;
let inflight: Promise<CombosPayload> | null = null;
let lastBuiltAt = 0;

async function buildPayload(): Promise<CombosPayload> {
  const db = getDb();

  // Popularity ties are common; without a total order the row sequence — and
  // so the payload hash — could change between rebuilds, and every client
  // would re-download an identical dataset. The id tiebreak makes it stable.
  const comboRows = await db.select().from(combos).orderBy(desc(combos.popularity), asc(combos.id));
  const cardRows = await db.select().from(comboCards);

  const cardsByCombo = new Map<string, OfflineComboCard[]>();
  for (const row of cardRows) {
    const arr = cardsByCombo.get(row.comboId);
    const entry: OfflineComboCard = {
      oracleId: row.oracleId,
      cardName: row.cardName,
      quantity: row.quantity ?? 1,
      position: row.position,
    };
    if (arr) arr.push(entry);
    else cardsByCombo.set(row.comboId, [entry]);
  }

  const out: OfflineCombo[] = [];
  for (const c of comboRows) {
    const cards = (cardsByCombo.get(c.id) ?? []).sort((a, b) => a.position - b.position);
    if (cards.length === 0) continue;
    out.push({
      id: c.id,
      identity: c.identity,
      produces: Array.isArray(c.produces) ? c.produces : [],
      prerequisites: c.prerequisites ?? null,
      description: c.description ?? null,
      manaNeeded: c.manaNeeded ?? null,
      popularity: c.popularity ?? 0,
      legalities:
        c.legalities && typeof c.legalities === 'object'
          ? (c.legalities as Record<string, string>)
          : {},
      cardCount: c.cardCount,
      bracket: c.bracket ?? null,
      // The browser matches combos against this export, so every field the
      // bracket estimate reads has to be here. bracketTag was missing until
      // 2026-09-23, which left every combo untagged in the app.
      bracketTag: c.bracketTag ?? null,
      templates: c.templates ?? null,
      templateQueries: c.templateQueries ?? null,
      cards,
    });
  }

  // One JSON.stringify per row, shared by both encodings.
  const lines = out.map((c) => JSON.stringify(c));
  const array = await gzipParts(jsonArrayParts(lines));
  const ndjson = await gzipParts(ndjsonParts(lines));

  return {
    version: array.sha1.slice(0, 16),
    comboCount: out.length,
    rawBytes: array.rawBytes,
    gzippedBytes: array.gz.byteLength,
    updatedAt: Date.now(),
    gzipped: array.gz,
    gzippedNdjson: ndjson.gz,
  };
}

/**
 * Returns the cached combos payload. Rebuilds at most once per 6h — combo
 * ingest runs nightly so any shorter cadence is wasted work. Concurrent
 * callers share the same in-flight build.
 */
export async function getCombosBulk(): Promise<CombosPayload> {
  const now = Date.now();
  if (current && now - lastBuiltAt < REBUILD_INTERVAL_MS) return current;
  if (!inflight) {
    inflight = buildPayload()
      .then((p) => {
        current = p;
        lastBuiltAt = Date.now();
        return p;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function __resetCombosBulkForTesting(): void {
  current = null;
  inflight = null;
  lastBuiltAt = 0;
}
