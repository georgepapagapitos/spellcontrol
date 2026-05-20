import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { desc } from 'drizzle-orm';
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
  gzipped: Buffer;
}

let current: CombosPayload | null = null;
let inflight: Promise<CombosPayload> | null = null;
let lastBuiltAt = 0;

async function buildPayload(): Promise<CombosPayload> {
  const db = getDb();

  const comboRows = await db.select().from(combos).orderBy(desc(combos.popularity));
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
      cards,
    });
  }

  const json = JSON.stringify(out);
  const raw = Buffer.from(json, 'utf-8');
  const gz = gzipSync(raw);
  const version = createHash('sha1').update(raw).digest('hex').slice(0, 16);

  return {
    version,
    comboCount: out.length,
    rawBytes: raw.byteLength,
    gzippedBytes: gz.byteLength,
    updatedAt: Date.now(),
    gzipped: gz,
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
