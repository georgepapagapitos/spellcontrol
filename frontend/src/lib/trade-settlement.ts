import type { EnrichedCard } from '../types';
import type { TradeCard, TradeCopy } from './trades-client';

/**
 * Turning an accepted trade into collection changes.
 *
 * Settlement is deliberately CLIENT-side: the server stores the deal but never
 * touches anybody's `user_cards`, so each person's own device removes what they
 * handed over and adds what they got, through the ordinary sync queue. That
 * keeps the local-first model intact — a trade is just another local mutation
 * that happens to have been agreed with someone else.
 *
 * Everything here is pure so the interesting part is testable without a store,
 * a network, or IndexedDB.
 */

/** One copy to remove from the collection, already matched to a real card. */
export interface SettlementRemoval {
  copyId: string;
  name: string;
}

/** One copy to add, with the printing that physically changed hands. */
export interface SettlementAddition {
  oracleId: string;
  name: string;
  copy: TradeCopy;
}

/** A card the plan could not fully cover from what is actually owned. */
export interface SettlementShortfall {
  name: string;
  /** How many copies are missing (1 or more). */
  missing: number;
}

export interface SettlementPlan {
  remove: SettlementRemoval[];
  add: SettlementAddition[];
  /**
   * Cards the person agreed to hand over but no longer owns — traded away,
   * edited down, or never entered. The settlement still proceeds for
   * everything else; this is surfaced so the UI can say so plainly rather
   * than silently under-removing.
   */
  short: SettlementShortfall[];
}

/**
 * Scores how well an owned copy matches a copy named in the trade. Higher is
 * better; -1 means "not this card at all".
 *
 * Printing is matched rather than copyId because copyIds are not stable across
 * an edit: someone who changed a card's quantity between proposing and settling
 * has different copyIds for the same physical cards. Matching on
 * scryfallId + finish survives that, and degrades to "any copy of this card"
 * only when the exact printing genuinely is not there.
 */
function matchScore(owned: EnrichedCard, oracleId: string, copy: TradeCopy): number {
  const sameCard =
    (owned.oracleId && owned.oracleId === oracleId) || owned.scryfallId === copy.scryfallId;
  if (!sameCard) return -1;
  let score = 0;
  if (owned.scryfallId === copy.scryfallId) score += 4;
  if (owned.finish === copy.finish) score += 2;
  if (copy.condition && owned.condition === copy.condition) score += 1;
  return score;
}

/**
 * Works out exactly which copies leave the collection and which arrive, for
 * ONE side of an accepted trade.
 *
 * @param give   what this person hands over (their own side of the offer)
 * @param receive what they get (the counterparty's side, printings resolved)
 * @param owned  the person's current collection
 *
 * Idempotency is the caller's job and is easy to get right: re-running against
 * a collection the plan was already applied to yields a `remove` list that
 * matches nothing (the copies are gone) — which is why the settlement flow can
 * safely apply first and report to the server second. `add` is NOT
 * self-cancelling, so the caller must not re-apply a plan it already applied;
 * `settled` on the offer is that guard.
 */
export function planSettlement(
  give: TradeCard[],
  receive: TradeCard[],
  owned: EnrichedCard[]
): SettlementPlan {
  const remove: SettlementRemoval[] = [];
  const short: SettlementShortfall[] = [];
  // A copy may only be spent once across the whole plan — two lines asking for
  // the same printing must not both claim it.
  const claimed = new Set<string>();

  for (const card of give) {
    // A line with resolved copies names its printings; one without (which the
    // server only allows on an unresolved side) still has to give SOMETHING,
    // so fall back to any copy of the card.
    const wanted: TradeCopy[] =
      card.copies.length > 0
        ? card.copies
        : Array.from({ length: card.quantity }, () => ({ scryfallId: '', finish: '' }));

    let missing = 0;
    for (const copy of wanted) {
      let best: EnrichedCard | null = null;
      let bestScore = -1;
      for (const candidate of owned) {
        if (claimed.has(candidate.copyId)) continue;
        const score = matchScore(candidate, card.oracleId, copy);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (!best || bestScore < 0) {
        missing += 1;
        continue;
      }
      claimed.add(best.copyId);
      remove.push({ copyId: best.copyId, name: best.name });
    }
    if (missing > 0) short.push({ name: card.name, missing });
  }

  const add: SettlementAddition[] = [];
  for (const card of receive) {
    for (const copy of card.copies) {
      add.push({ oracleId: card.oracleId, name: card.name, copy });
    }
  }

  return { remove, add, short };
}

/** Human summary for the settlement toast. Counts copies, not card lines —
 *  "3 cards in, 2 out" is what a person actually checks against the pile in
 *  their hand. */
export function describeSettlement(plan: SettlementPlan): string {
  const inCount = plan.add.length;
  const outCount = plan.remove.length;
  const parts: string[] = [];
  if (inCount > 0) parts.push(`${inCount} card${inCount === 1 ? '' : 's'} in`);
  if (outCount > 0) parts.push(`${outCount} out`);
  return parts.length > 0 ? parts.join(', ') : 'No collection changes';
}
