import type { EnrichedCard } from '@/types/index';
import {
  MAX_COPIES_PER_LINE,
  addCheapestCopy,
  askedOf,
  atLineCap,
  getEntryKey,
  giveCandidates,
  keyOf,
  resolveGivePrefill,
  type GivePickOptions,
} from './trade-basket';
import { emptyDraft, type TradeDraft } from './trade-draft';
import type { OwnedTradeLine } from './trade-picker';
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
  draft: TradeDraft;
  /** Null when the card went in. */
  blocked: AddBlock | null;
}

/** The most of one card the ask can hold: what they have, up to the server's 20. */
export function getCeiling(theirCount: number | null): number {
  return Math.min(MAX_COPIES_PER_LINE, theirCount ?? MAX_COPIES_PER_LINE);
}

/**
 * One more copy from THEIR collection. A card with a `scryfallId` + `finish` is
 * a request for that printing and gets its own entry; without them it is a
 * request for any printing. `theirCount` is how many they hold of what is being
 * asked for (that printing, or the card across printings), null when their
 * collection can't be read, which leaves only the per-line 20. The 20 is per
 * card, since the server holds one line per card.
 */
export function addGet(
  base: TradeDraft | null,
  friend: Friend,
  card: { oracleId: string; name: string; scryfallId?: string; finish?: string },
  theirCount: number | null
): AddResult {
  const draft = base ?? emptyDraft(friend.id, friend.name);
  const key = getEntryKey(card);
  const have = draft.get[key]?.quantity ?? 0;
  if (have >= getCeiling(theirCount) || askedOf(draft.get, card) >= MAX_COPIES_PER_LINE) {
    return { draft, blocked: 'copies' };
  }
  if (atLineCap(draft.get, key)) return { draft, blocked: 'lines' };
  const entry = {
    name: card.name,
    oracleId: card.oracleId,
    ...(card.scryfallId && card.finish ? { scryfallId: card.scryfallId, finish: card.finish } : {}),
    quantity: have + 1,
  };
  return { draft: { ...draft, get: { ...draft.get, [key]: entry } }, blocked: null };
}

/** One copy fewer of an ask; at zero the line goes. */
export function removeOneGet(base: TradeDraft | null, key: string): TradeDraft | null {
  const line = base?.get[key];
  if (!base || !line) return base;
  const get = { ...base.get };
  if (line.quantity <= 1) delete get[key];
  else get[key] = { ...line, quantity: line.quantity - 1 };
  return { ...base, get };
}

/**
 * The copy "+" would put in next: no deck or cube holds it if any free copy is
 * left, and the cheapest of those. `printing` narrows it to one printing (the
 * tile that was tapped).
 */
export function nextGiveCopy(
  base: TradeDraft | null,
  line: OwnedTradeLine,
  opts: GivePickOptions = {}
): EnrichedCard | undefined {
  const chosen = new Set(base?.give[keyOf(line)]?.copyIds ?? []);
  return giveCandidates(line, chosen, opts)[0];
}

/** One more of the viewer's own copies, picked by {@link nextGiveCopy}. */
export function addGive(
  base: TradeDraft | null,
  friend: Friend,
  line: OwnedTradeLine,
  opts: GivePickOptions = {}
): AddResult {
  const draft = base ?? emptyDraft(friend.id, friend.name);
  const key = keyOf(line);
  if (!nextGiveCopy(draft, line, opts)) return { draft, blocked: 'copies' };
  if (atLineCap(draft.give, key)) return { draft, blocked: 'lines' };
  const picked = addCheapestCopy(
    Object.fromEntries(Object.entries(draft.give).map(([k, l]) => [k, l.copyIds])),
    line,
    opts
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

/**
 * Take the most recently added copy of a card back out; the last one drops the
 * line. `among` limits it to those copyIds (one printing's), so a "-" on a
 * printing's tile never removes another printing's copy.
 */
export function removeOneGive(
  base: TradeDraft | null,
  key: string,
  among?: ReadonlySet<string>
): TradeDraft | null {
  const line = base?.give[key];
  if (!base || !line) return base;
  let at = line.copyIds.length - 1;
  if (among) while (at >= 0 && !among.has(line.copyIds[at])) at -= 1;
  if (at < 0) return base;
  const give = { ...base.give };
  const copyIds = line.copyIds.filter((_, i) => i !== at);
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
  ownedByKey: ReadonlyMap<string, OwnedTradeLine>,
  claimed?: ReadonlySet<string>
): { draft: TradeDraft; skipped: string[] } {
  const { prefill, skipped } = resolveGivePrefill(offer.give, ownedByKey, claimed);
  const draft = emptyDraft(friend.id, friend.name);
  for (const [key, copyIds] of Object.entries(prefill)) {
    const line = ownedByKey.get(key);
    if (line) draft.give[key] = { name: line.name, oracleId: line.oracleId, copyIds };
  }
  // What the offer would hand the viewer is what the counter asks for, at the
  // printings it named; a line that named none stays "any printing".
  for (const card of offer.receive) {
    const quantity = Math.max(1, Math.min(card.quantity, MAX_COPIES_PER_LINE));
    const pins = card.copies.length === card.quantity ? card.copies : [];
    if (pins.length === 0) {
      const key = keyOf(card);
      const entry = draft.get[key];
      draft.get[key] = {
        name: card.name,
        oracleId: card.oracleId,
        quantity: (entry?.quantity ?? 0) + quantity,
      };
      continue;
    }
    for (const copy of pins.slice(0, quantity)) {
      const key = getEntryKey({ ...card, scryfallId: copy.scryfallId, finish: copy.finish });
      const entry = draft.get[key];
      draft.get[key] = {
        name: card.name,
        oracleId: card.oracleId,
        scryfallId: copy.scryfallId,
        finish: copy.finish,
        quantity: (entry?.quantity ?? 0) + 1,
      };
    }
  }
  draft.counterTo = {
    offerId: offer.id,
    name: offer.counterpartyDisplayName || `@${offer.counterpartyUsername}`,
  };
  return { draft, skipped };
}
