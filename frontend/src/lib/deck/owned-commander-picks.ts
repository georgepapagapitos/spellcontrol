import type { EnrichedCard } from '@/types/index';
import {
  computeReadiness,
  extractCommanderCandidates,
  MIN_COLLECTION_SIZE,
  type ImportRecency,
  type ReadinessScore,
  type ReadinessStaple,
} from './commander-readiness';

/**
 * The commanders worth showing right after an import (board E307): the ones the
 * player owns, ranked by how much of their EDHREC deck they already own. This is
 * the commander finder's "Most of the deck owned" ranking (`computeReadiness`),
 * lifted out so the post-import moment and the finder cannot disagree. Pure and
 * network-free; the staple fetch is injected.
 */

/** Owned commanders scored. Each costs one EDHREC fetch, so the pool is bounded. */
export const PICK_POOL_SIZE = 12;
/** Commanders shown. */
export const PICK_COUNT = 3;
/** Staple fetches in flight at once. */
export const PICK_CONCURRENCY = 4;

export interface OwnedCommanderPick {
  card: EnrichedCard;
  score: ReadinessScore;
}

export type OwnedCommanderPicks =
  /** Too small a collection for a coverage % to mean anything, or no commander in it. */
  | { status: 'empty' }
  /** Every score came back unavailable: EDHREC could not be reached. */
  | { status: 'error' }
  | { status: 'ready'; picks: OwnedCommanderPick[] };

/**
 * The owned commanders to score, most popular first. ponytail: scoring is capped
 * at the PICK_POOL_SIZE most-played owned commanders (by EDHREC rank), so a
 * collection with a niche commander that covers its deck better can be missed;
 * raise the cap or score progressively if that shows up.
 */
export function pickPool(cards: EnrichedCard[], recency?: ImportRecency): EnrichedCard[] {
  if (cards.length < MIN_COLLECTION_SIZE) return [];
  return extractCommanderCandidates(cards, recency)
    .sort((a, b) => (a.edhrecRank ?? Infinity) - (b.edhrecRank ?? Infinity))
    .slice(0, PICK_POOL_SIZE);
}

/** Higher coverage first; more owned staples, then the more popular commander, break a tie. */
function byCoverage(a: OwnedCommanderPick, b: OwnedCommanderPick): number {
  return (
    b.score.percent - a.score.percent ||
    b.score.ownedCount - a.score.ownedCount ||
    (a.card.edhrecRank ?? Infinity) - (b.card.edhrecRank ?? Infinity)
  );
}

export async function rankOwnedCommanders(
  cards: EnrichedCard[],
  fetchStaples: (name: string) => Promise<ReadinessStaple[]>,
  recency?: ImportRecency,
  isCancelled: () => boolean = () => false
): Promise<OwnedCommanderPicks> {
  const pool = pickPool(cards, recency);
  if (pool.length === 0) return { status: 'empty' };
  const owned = new Set(cards.map((c) => c.name.toLowerCase()));
  const scored: OwnedCommanderPick[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PICK_CONCURRENCY, pool.length) }, async () => {
      while (!isCancelled() && next < pool.length) {
        const card = pool[next++];
        let staples: ReadinessStaple[] = [];
        try {
          staples = await fetchStaples(card.name);
        } catch {
          /* scored as unavailable below */
        }
        const score = computeReadiness(staples, owned);
        if (score.available) scored.push({ card, score });
      }
    })
  );
  if (scored.length === 0) return { status: 'error' };
  return { status: 'ready', picks: scored.sort(byCoverage).slice(0, PICK_COUNT) };
}
