import { sql, isNull, lt } from 'drizzle-orm';
import { getDb } from '../db';
import { deckPublications, deckStatSnapshots } from '../db/schema';

/** Per-pair decay applied per day of age -- more recent deltas score higher. */
export const DECAY_RATE = 0.7;
/** A copy is a stronger trending signal than a view. */
export const COPY_WEIGHT = 3;
export const VIEW_WEIGHT = 1;
/** `snapshotDeckStats` prunes any row older than this many days. */
export const SNAPSHOT_RETENTION_DAYS = 8;
/** `computeDecayedTrending` never returns more than this many decks. */
export const TRENDING_DECKS_LIMIT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bounds Postgres's parameter-count ceiling on the bulk upsert, exactly like
 *  rollup.ts's own FLUSH_AT -- this dataset (one row per public deck) is small
 *  enough that no event-loop-yielding is needed between chunks. */
const FLUSH_AT = 500;

/** One snapshot row as `computeDecayedTrending` consumes it -- decoupled from
 *  the raw DB row so the pure function has no DB awareness. `day` is a plain
 *  'YYYY-MM-DD' string (never a JS Date -- see schema.ts's doc comment on
 *  deckStatSnapshots for why). */
export interface DeckSnapshotRow {
  deckId: string;
  day: string;
  viewCount: number;
  copyCount: number;
}

export interface TrendingDeck {
  deckId: string;
  score: number;
}

function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** UTC calendar day for an epoch-ms instant, as 'YYYY-MM-DD'. Always UTC
 *  (never the server's local timezone) so the bucket is unambiguous
 *  regardless of where this runs. */
function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Pure, no DB access. Groups snapshot rows by deck, sorts each deck's rows by
 * day ascending, and walks CONSECUTIVE PAIRS only -- a deck's first-ever
 * recorded snapshot is never the right-hand side of any pair, and never the
 * left-hand side of a fabricated zero row, so it contributes zero score
 * until a second day's snapshot exists to form a real delta (folded
 * correctness fix -- see w4-trending spec: scoring a first snapshot as a
 * delta-from-zero would produce a one-time spike off pre-existing cumulative
 * counts, the opposite of what decay is meant to reward).
 *
 * Each pair's copy/view deltas are floored at 0 (a counter correction can
 * never subtract score) and decayed by the AGE OF THE LATER snapshot in the
 * pair -- the day the delta was earned. Decks with a total score <= 0 are
 * dropped; the rest are sorted desc by score and capped at
 * TRENDING_DECKS_LIMIT.
 */
export function computeDecayedTrending(snapshots: DeckSnapshotRow[], now: number): TrendingDeck[] {
  const byDeck = new Map<string, DeckSnapshotRow[]>();
  for (const row of snapshots) {
    const rows = byDeck.get(row.deckId);
    if (rows) rows.push(row);
    else byDeck.set(row.deckId, [row]);
  }

  const scored: TrendingDeck[] = [];
  for (const [deckId, rows] of byDeck) {
    const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    let score = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const copyDelta = Math.max(0, curr.copyCount - prev.copyCount);
      const viewDelta = Math.max(0, curr.viewCount - prev.viewCount);
      const ageDays = Math.floor((now - dayToMs(curr.day)) / DAY_MS);
      score += (copyDelta * COPY_WEIGHT + viewDelta * VIEW_WEIGHT) * DECAY_RATE ** ageDays;
    }
    if (score > 0) scored.push({ deckId, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, TRENDING_DECKS_LIMIT);
}

/**
 * Snapshots today's cumulative view/copy counters for every currently-public
 * deck, upserting one row per deck per day, then prunes anything older than
 * SNAPSHOT_RETENTION_DAYS. `deckPublications.viewCount`/`.copyCount` are
 * real, confirmed columns (w0-publish-schema-endpoints, batch 2 -- 14
 * batches before this one) -- read directly, no try/catch-and-warn-on-
 * missing-column path.
 *
 * Called from rollup.ts's runRollup() as a second, independent step -- never
 * inside the commander_stats transaction -- so a bug here can't roll back or
 * mis-report that unrelated, already-working write.
 */
export async function snapshotDeckStats(now: number): Promise<number> {
  const db = getDb();
  const today = toDay(now);

  const decks = await db
    .select({
      deckId: deckPublications.deckId,
      userId: deckPublications.userId,
      viewCount: deckPublications.viewCount,
      copyCount: deckPublications.copyCount,
    })
    .from(deckPublications)
    .where(isNull(deckPublications.unpublishedAt));

  for (let i = 0; i < decks.length; i += FLUSH_AT) {
    const chunk = decks.slice(i, i + FLUSH_AT).map((d) => ({ ...d, day: today }));
    await db
      .insert(deckStatSnapshots)
      .values(chunk)
      .onConflictDoUpdate({
        target: [deckStatSnapshots.deckId, deckStatSnapshots.day],
        set: {
          userId: sql`excluded.user_id`,
          viewCount: sql`excluded.view_count`,
          copyCount: sql`excluded.copy_count`,
        },
      });
  }

  const cutoff = toDay(now - SNAPSHOT_RETENTION_DAYS * DAY_MS);
  await db.delete(deckStatSnapshots).where(lt(deckStatSnapshots.day, cutoff));

  return decks.length;
}
