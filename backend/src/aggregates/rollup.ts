import { logger } from '../logger';
import crypto from 'crypto';
import { sql, and, eq, isNull, isNotNull } from 'drizzle-orm';
import { getDb } from '../db';
import {
  aggregateRollupRuns,
  commanderStats,
  commanderCardInclusion,
  deckPublications,
  userDecks,
} from '../db/schema';
import { asRecord, asString } from '../shares/projections';
import { buildCommanderKey } from './commander-key';
import { snapshotDeckStats } from './trending-decks';

/** Parent gate: a commander needs at least this many published decks to get
 *  a commander_stats row at all. Sub-threshold commanders simply have no row
 *  — enforced here at write time, never filtered at read time. */
export const MIN_COMMANDER_DECKS = 5;
/** Card-inclusion floor: a card needs at least this many decks in the group
 *  to appear in that commander's topCards. */
export const MIN_CARD_INCLUSION_DECKS = 2;
export const TOP_CARDS_PER_COMMANDER = 15;
/** `commander_stats.newLast7d` floor for the /trending "rising" list. */
export const RISING_MIN_NEW_7D = 2;
/** USD boundaries for the budget-distribution buckets. Inclusive-low: a sum
 *  of exactly BUDGET_LOW_MAX lands in mid, not low (mirrors discover.ts's own
 *  BUDGET_BANDS `v >= lo && v < hi` convention). */
export const BUDGET_LOW_MAX = 100;
export const BUDGET_MID_MAX = 400;
/** Folded privacy fix: avgBracket is null unless the group's bracketed-deck
 *  count clears this floor — otherwise a 1-deck sample would expose that
 *  single deck's exact bracket as the public "average". */
export const BRACKET_SAMPLE_MIN = 3;
/** Folded privacy fix: a budget bucket count of exactly 1 would name a single
 *  deck's price tier, so any count below this (i.e. exactly 1) is written as
 *  NULL instead. A true 0 carries no exposure risk and is never suppressed. */
export const BUDGET_BUCKET_SUPPRESS_MIN = 2;

/** How many commander_stats / commander_card_inclusion rows to insert per
 *  statement — bounds Postgres's parameter-count ceiling, exactly like
 *  combos/ingest.ts's FLUSH_AT (this dataset is small enough that no
 *  event-loop-yielding is needed between chunks, unlike combos' streaming
 *  ~100MB feed). */
const FLUSH_AT = 500;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** One published deck as read off the `deck_publications` ⋈ `user_decks`
 *  join — the only shape `computeCommanderAggregates` needs, decoupled from
 *  the raw SQL column names so the pure function has no DB awareness. */
export interface PublishedDeckInput {
  /** Raw `user_decks.data` JSONB — opaque, parsed defensively (no backend Deck type). */
  data: unknown;
  /** `deck_publications.bracket` — already `bracketOverride ?? bracketEstimation?.bracket` (w0-publish). */
  effectiveBracket: number | null;
  /** `deck_publications.published_at`, epoch ms. */
  publishedAt: number;
}

export interface CommanderStatsComputed {
  commanderKey: string;
  commanderName: string;
  partnerName: string | null;
  commanderOracleId: string;
  partnerOracleId: string | null;
  deckCount: number;
  newLast7d: number;
  avgBracket: number | null;
  bracketSampleCount: number;
  budgetLowCount: number | null;
  budgetMidCount: number | null;
  budgetHighCount: number | null;
}

export interface CardInclusionComputed {
  commanderKey: string;
  oracleId: string;
  cardName: string;
  deckCount: number;
  /** 1-based, per commander, by deckCount desc then cardName asc. */
  rank: number;
}

type AnyRecord = Record<string, unknown>;

/** Mainboard-only card records (`deck.cards`, never `deck.sideboard` — this
 *  scope matches `deck_publications.card_count`'s own mainboard-only count). */
function mainboardCards(deckRecord: AnyRecord): AnyRecord[] {
  const raw = deckRecord.cards;
  if (!Array.isArray(raw)) return [];
  const out: AnyRecord[] = [];
  for (const slot of raw) {
    const s = asRecord(slot);
    const card = s ? asRecord(s.card) : null;
    if (card) out.push(card);
  }
  return out;
}

/** A card's parsed `prices.usd`, or null when absent/non-numeric. */
function cardUsdPrice(card: AnyRecord): number | null {
  const prices = asRecord(card.prices);
  const raw = prices?.usd;
  if (typeof raw !== 'string') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Sum of parseable card prices across a deck's mainboard, or null when NOT
 *  A SINGLE card carries a parseable price (excluded from the budget
 *  denominator entirely — never silently counted as "$0 → low"). */
function deckUsdTotal(cards: AnyRecord[]): number | null {
  let sum = 0;
  let any = false;
  for (const card of cards) {
    const price = cardUsdPrice(card);
    if (price !== null) {
      sum += price;
      any = true;
    }
  }
  return any ? sum : null;
}

function budgetBucket(sum: number): 'low' | 'mid' | 'high' {
  if (sum < BUDGET_LOW_MAX) return 'low';
  if (sum < BUDGET_MID_MAX) return 'mid';
  return 'high';
}

/** Folded privacy fix: suppress a lone-deck bucket count to null; 0 and
 *  anything >= BUDGET_BUCKET_SUPPRESS_MIN pass through as the real integer. */
function suppressBudgetCount(n: number): number | null {
  return n === 0 || n >= BUDGET_BUCKET_SUPPRESS_MIN ? n : null;
}

interface DeckGroupEntry {
  publishedAt: number;
  effectiveBracket: number | null;
  commanderName: string;
  partnerName: string | null;
  mainboard: AnyRecord[];
}

/**
 * Pure, no DB access. Groups published decks by commander(+partner) key,
 * drops groups under MIN_COMMANDER_DECKS, and computes every stat + the
 * top-15 card inclusion list for each surviving group. `now` is passed in
 * (rather than read via Date.now()) so this stays deterministic and testable.
 */
export function computeCommanderAggregates(
  decks: PublishedDeckInput[],
  now: number
): { stats: CommanderStatsComputed[]; cardInclusion: CardInclusionComputed[] } {
  const groups = new Map<
    string,
    { commanderOracleId: string; partnerOracleId: string | null; entries: DeckGroupEntry[] }
  >();

  for (const deck of decks) {
    const record = asRecord(deck.data);
    if (!record) continue;
    const commanderCard = asRecord(record.commander);
    const commanderOracleId = commanderCard ? asString(commanderCard.oracle_id) : undefined;
    if (!commanderOracleId) continue; // no commander -- drop the deck entirely

    const partnerCard = asRecord(record.partnerCommander);
    const partnerOracleId = partnerCard ? asString(partnerCard.oracle_id) : undefined;

    const key = buildCommanderKey(commanderOracleId, partnerOracleId);
    const group = groups.get(key) ?? {
      commanderOracleId,
      partnerOracleId: partnerOracleId ?? null,
      entries: [],
    };
    group.entries.push({
      publishedAt: deck.publishedAt,
      effectiveBracket: deck.effectiveBracket,
      commanderName: asString(commanderCard?.name) ?? commanderOracleId,
      partnerName: partnerOracleId ? (asString(partnerCard?.name) ?? partnerOracleId) : null,
      mainboard: mainboardCards(record),
    });
    groups.set(key, group);
  }

  const stats: CommanderStatsComputed[] = [];
  const cardInclusion: CardInclusionComputed[] = [];

  for (const [commanderKey, { commanderOracleId, partnerOracleId, entries }] of groups) {
    if (entries.length < MIN_COMMANDER_DECKS) continue;

    const deckCount = entries.length;
    const newLast7d = entries.filter((e) => e.publishedAt > now - SEVEN_DAYS_MS).length;

    const bracketed = entries.filter((e) => e.effectiveBracket !== null);
    const bracketSampleCount = bracketed.length;
    const avgBracket =
      bracketSampleCount >= BRACKET_SAMPLE_MIN
        ? bracketed.reduce((sum, e) => sum + (e.effectiveBracket as number), 0) / bracketSampleCount
        : null;

    let low = 0;
    let mid = 0;
    let high = 0;
    for (const e of entries) {
      const total = deckUsdTotal(e.mainboard);
      if (total === null) continue;
      const bucket = budgetBucket(total);
      if (bucket === 'low') low++;
      else if (bucket === 'mid') mid++;
      else high++;
    }

    const cardCounts = new Map<string, { name: string; count: number }>();
    for (const e of entries) {
      const seenInDeck = new Set<string>();
      for (const card of e.mainboard) {
        const oracleId = asString(card.oracle_id);
        const name = asString(card.name);
        if (!oracleId || !name || seenInDeck.has(oracleId)) continue;
        seenInDeck.add(oracleId);
        const existing = cardCounts.get(oracleId);
        if (existing) existing.count++;
        else cardCounts.set(oracleId, { name, count: 1 });
      }
    }
    const topCards = [...cardCounts.entries()]
      .map(([oracleId, v]) => ({ oracleId, cardName: v.name, deckCount: v.count }))
      .filter((c) => c.deckCount >= MIN_CARD_INCLUSION_DECKS)
      .sort((a, b) => b.deckCount - a.deckCount || a.cardName.localeCompare(b.cardName))
      .slice(0, TOP_CARDS_PER_COMMANDER);

    stats.push({
      commanderKey,
      commanderName: entries[0].commanderName,
      partnerName: entries[0].partnerName,
      commanderOracleId,
      partnerOracleId,
      deckCount,
      newLast7d,
      avgBracket,
      bracketSampleCount,
      budgetLowCount: suppressBudgetCount(low),
      budgetMidCount: suppressBudgetCount(mid),
      budgetHighCount: suppressBudgetCount(high),
    });

    topCards.forEach((c, i) => {
      cardInclusion.push({
        commanderKey,
        oracleId: c.oracleId,
        cardName: c.cardName,
        deckCount: c.deckCount,
        rank: i + 1,
      });
    });
  }

  return { stats, cardInclusion };
}

export interface RollupResult {
  commandersWritten: number;
  runId: string;
}

/**
 * Replaces the commander_stats / commander_card_inclusion dataset wholesale
 * from every currently-PUBLIC deck. Idempotent — running twice back-to-back
 * with an unchanged deck_publications table yields the same final state.
 *
 * Mirrors combos/ingest.ts's `ingestCombos` shape: one unbounded read (no
 * chunking on the read side — this is our own small, slow-growing table, not
 * combos' external ~100MB feed; chunk only if it ever becomes a real
 * dataset), then a TRUNCATE + chunked-insert inside one db.transaction() so
 * readers racing the commit see either the pre- or post-state, never a
 * partial rebuild. TRUNCATE order is child-first (commander_card_inclusion,
 * then commander_stats CASCADE) — reversing it fails every run, since
 * Postgres refuses to truncate a table another table's FK references unless
 * the referencing table is truncated in the same statement.
 *
 * If deck_publications doesn't exist yet (this PR's scheduler starting
 * before w0-publish-schema-endpoints has run against the real database), the
 * query throws a missing-relation error — left to propagate to the caller;
 * `runScheduledRollup`'s wrapper swallows and logs it, same as every other
 * externally-dependent failure mode in this bucket.
 */
export async function runRollup(): Promise<RollupResult> {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const db = getDb();

  await db.insert(aggregateRollupRuns).values({
    id: runId,
    startedAt,
    finishedAt: null,
    commandersWritten: null,
    error: null,
  });

  let commandersWritten = 0;
  let lastError: string | null = null;

  try {
    const rows = await db
      .select({
        data: userDecks.data,
        effectiveBracket: deckPublications.bracket,
        publishedAt: deckPublications.publishedAt,
      })
      .from(deckPublications)
      .innerJoin(
        userDecks,
        and(
          eq(userDecks.userId, deckPublications.userId),
          eq(userDecks.id, deckPublications.deckId)
        )
      )
      .where(
        and(
          isNull(deckPublications.unpublishedAt),
          isNull(userDecks.deletedAt),
          isNotNull(userDecks.data)
        )
      );

    const { stats, cardInclusion } = computeCommanderAggregates(rows, startedAt);

    await db.transaction(async (tx) => {
      await tx.execute(sql`TRUNCATE TABLE commander_card_inclusion`);
      await tx.execute(sql`TRUNCATE TABLE commander_stats CASCADE`);

      for (let i = 0; i < stats.length; i += FLUSH_AT) {
        const chunk = stats.slice(i, i + FLUSH_AT).map((s) => ({ ...s, computedAt: startedAt }));
        await tx.insert(commanderStats).values(chunk);
      }
      for (let i = 0; i < cardInclusion.length; i += FLUSH_AT) {
        await tx.insert(commanderCardInclusion).values(cardInclusion.slice(i, i + FLUSH_AT));
      }
    });

    commandersWritten = stats.length;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await db
      .update(aggregateRollupRuns)
      .set({ finishedAt: Date.now(), commandersWritten, error: lastError })
      .where(sql`id = ${runId}`);
  }

  // Second, independent nightly concern (w4-trending): the deck-level view/copy
  // snapshot feeding the decayed "most copied" ranking. Deliberately run after
  // the commander-stats transaction above has already committed and reported
  // its own outcome, in its own try/catch, so a bug in this feature can never
  // roll back or mis-report the unrelated, already-working commander-stats write.
  try {
    const snapshotted = await snapshotDeckStats(startedAt);
    logger.info(`[aggregates] snapshotted ${snapshotted} deck(s) for trending`);
  } catch (err) {
    logger.error('[aggregates] deck stat snapshot failed:', err);
  }

  return { commandersWritten, runId };
}

/**
 * Fire-and-forget background refresh: never throws, logs the outcome. The
 * caller (a setInterval in server.ts) doesn't await success.
 */
export async function runScheduledRollup(): Promise<void> {
  try {
    logger.info('[aggregates] starting scheduled rollup');
    const result = await runRollup();
    logger.info(
      `[aggregates] scheduled rollup done — wrote ${result.commandersWritten} commanders`
    );
  } catch (err) {
    logger.error('[aggregates] scheduled rollup failed:', err);
  }
}

/**
 * Timestamp of the most recent successful rollup, or null when none has
 * finished. Used to skip a nightly refresh when one already ran recently
 * (e.g. after a backend redeploy).
 */
export async function lastSuccessfulRollupAt(): Promise<number | null> {
  const db = getDb();
  const rows = await db
    .select({ finishedAt: aggregateRollupRuns.finishedAt })
    .from(aggregateRollupRuns)
    .where(sql`finished_at IS NOT NULL AND error IS NULL`)
    .orderBy(sql`finished_at DESC`)
    .limit(1);
  return rows[0]?.finishedAt ?? null;
}
