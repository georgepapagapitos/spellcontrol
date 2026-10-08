import type { EnrichedCard } from '@/types/index';
import {
  MAX_COPIES_PER_LINE,
  addCheapestCopy,
  atLineCap,
  keyOf,
  resolveGivePrefill,
} from './trade-basket';
import { emptyDraft, type TradeDraftV1 } from './trade-draft';
import { copiesByValue, type OwnedTradeLine } from './trade-picker';
import type { TradeOffer } from './trades-client';

/**
 * The single-step edits the trade workspace makes to a saved draft: the "+"
 * on a tile, the check that takes one back out, a stepper in a preview. Pure,
 * so the rules (their real count, the 20-per-line and 40-line ceilings) are
 * tested without a screen. The review (`use-trade-review`) has the bulk edits.
 */

export interface Friend {
  id: string;
  name: string;
}

/** Why an add did nothing, so the caller can say so. */
export type AddBlock = 'copies' | 'lines';

export interface AddResult {
  draft: TradeDraftV1;
  /** Null when the card went in. */
  blocked: AddBlock | null;
}

/** The most of one card the ask can hold: what they have, up to the server's 20. */
export function getCeiling(theirCount: number | null): number {
  return Math.min(MAX_COPIES_PER_LINE, theirCount ?? MAX_COPIES_PER_LINE);
}

/**
 * One more copy of a card from THEIR collection. `theirCount` is how many they
 * hold across every printing (null when their collection can't be read, which
 * leaves only the per-line 20).
 */
export function addGet(
  base: TradeDraftV1 | null,
  friend: Friend,
  card: { oracleId: string; name: string },
  theirCount: number | null
): AddResult {
  const draft = base ?? emptyDraft(friend.id, friend.name);
  const key = keyOf(card);
  const have = draft.get[key]?.quantity ?? 0;
  if (have >= getCeiling(theirCount)) return { draft, blocked: 'copies' };
  if (atLineCap(draft.get, key)) return { draft, blocked: 'lines' };
  return {
    draft: { ...draft, get: { ...draft.get, [key]: { name: card.name, quantity: have + 1 } } },
    blocked: null,
  };
}

/** One copy fewer of a card they have; at zero the line goes. */
export function removeOneGet(base: TradeDraftV1 | null, key: string): TradeDraftV1 | null {
  const line = base?.get[key];
  if (!base || !line) return base;
  const get = { ...base.get };
  if (line.quantity <= 1) delete get[key];
  else get[key] = { ...line, quantity: line.quantity - 1 };
  return { ...base, get };
}

/** The copy "+" would put in next: the cheapest one not already in the trade. */
export function nextGiveCopy(
  base: TradeDraftV1 | null,
  line: OwnedTradeLine
): EnrichedCard | undefined {
  const chosen = new Set(base?.give[keyOf(line)]?.copyIds ?? []);
  return copiesByValue(line).find((c) => !chosen.has(c.copyId));
}

/** One more of the viewer's own copies: the cheapest not already in the trade. */
export function addGive(
  base: TradeDraftV1 | null,
  friend: Friend,
  line: OwnedTradeLine
): AddResult {
  const draft = base ?? emptyDraft(friend.id, friend.name);
  const key = keyOf(line);
  if (!nextGiveCopy(draft, line)) return { draft, blocked: 'copies' };
  if (atLineCap(draft.give, key)) return { draft, blocked: 'lines' };
  const picked = addCheapestCopy(
    Object.fromEntries(Object.entries(draft.give).map(([k, l]) => [k, l.copyIds])),
    line
  );
  return {
    draft: {
      ...draft,
      give: {
        ...draft.give,
        [key]: { name: line.name, oracleId: line.oracleId, copyIds: picked[key] },
      },
    },
    blocked: null,
  };
}

/** Take the most recently added copy of a card back out; the last one drops the line. */
export function removeOneGive(base: TradeDraftV1 | null, key: string): TradeDraftV1 | null {
  const line = base?.give[key];
  if (!base || !line) return base;
  const give = { ...base.give };
  const copyIds = line.copyIds.slice(0, -1);
  if (copyIds.length === 0) delete give[key];
  else give[key] = { ...line, copyIds };
  return { ...base, give };
}

/**
 * A draft that answers an incoming offer. Offers are viewer-relative, so the
 * viewer's give side is what they were asked to hand over and their get side
 * is what they would receive. Copies the viewer no longer owns are named in
 * `skipped` rather than silently dropped.
 */
export function counterDraft(
  offer: TradeOffer,
  friend: Friend,
  ownedByKey: ReadonlyMap<string, OwnedTradeLine>
): { draft: TradeDraftV1; skipped: string[] } {
  const { prefill, skipped } = resolveGivePrefill(offer.give, ownedByKey);
  const draft = emptyDraft(friend.id, friend.name);
  for (const [key, copyIds] of Object.entries(prefill)) {
    const line = ownedByKey.get(key);
    if (line) draft.give[key] = { name: line.name, oracleId: line.oracleId, copyIds };
  }
  for (const card of offer.receive) {
    const key = keyOf(card);
    const quantity = Math.max(1, Math.min(card.quantity, MAX_COPIES_PER_LINE));
    draft.get[key] = { name: card.name, quantity: (draft.get[key]?.quantity ?? 0) + quantity };
  }
  draft.counterTo = {
    offerId: offer.id,
    name: offer.counterpartyDisplayName || `@${offer.counterpartyUsername}`,
  };
  return { draft, skipped };
}
