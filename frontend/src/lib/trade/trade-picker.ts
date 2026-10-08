import { buildCollectionSearch } from '@/lib/search/deck-add-search';
import type { EnrichedCard } from '@/types/index';
import type { TradeCard, TradeCopy } from './trades-client';

/**
 * Building the "you give" side of an offer.
 *
 * Composing a trade is the mirror of settling one: here we turn a collection
 * into pickable lines and pin down which physical copies are going, so the
 * offer travels with real printings and the friend's binder ends up holding
 * the card that actually changed hands. See trade-settlement.ts for the other
 * half.
 */

/** One card the owner could put into a trade, with every copy they hold. */
export interface OwnedTradeLine {
  oracleId: string;
  name: string;
  /** Every physical copy, newest printing detail intact, in collection order. */
  copies: EnrichedCard[];
}

/**
 * Groups a collection into one line per distinct card.
 *
 * Keyed by `oracleId` so printings of the same card stack into one line —
 * that is how a person thinks about what they'd trade ("my Sol Ring"), and it
 * matches the oracle-level identity the friend-facing collection uses.
 * Copies with no oracleId (legacy rows) are left out: the wire shape names a
 * card by oracle id and the server rejects a line without one, so offering them
 * only moved the failure to Send ("That trade has a card we could not read.").
 */
export function groupOwnedForTrade(cards: EnrichedCard[]): OwnedTradeLine[] {
  const byKey = new Map<string, OwnedTradeLine>();
  for (const card of cards) {
    // Proxies are never tradeable — they are not the card.
    if (card.proxy) continue;
    if (!card.oracleId) continue;
    const existing = byKey.get(card.oracleId);
    if (existing) {
      existing.copies.push(card);
    } else {
      byKey.set(card.oracleId, {
        oracleId: card.oracleId,
        name: card.name,
        copies: [card],
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Filters grouped lines by the SAME query engine the deck editor's add-cards
 * panel uses — full Scryfall syntax (`t:`, `c:`, `cmc<=2`, `r:`, `otag:`, `-`,
 * `OR`) plus plain-text name-and-oracle-text search.
 *
 * This was a bare `name.includes(q)` substring, which left the composer with
 * the app's *weakest* search pointed at its *largest* haystack: a real
 * collection is ~11.5k cards, and the ask side beside it already ran the full
 * syntax against a friend's few hundred. Same engine both sides now.
 *
 * Name hits rank ahead of oracle-text hits (the add panel's `default` sort),
 * which matters because the caller caps the list — without it, typing "sol"
 * could fill the cap with cards whose rules text says "solve" before reaching
 * Sol Ring. `tagsFor` is the oracle-tag lookup; without it `otag:` clauses
 * degrade to match-anything rather than zeroing the results.
 */
export function filterOwnedLines(
  lines: OwnedTradeLine[],
  query: string,
  tagsFor?: (name: string) => string[]
): OwnedTradeLine[] {
  const search = buildCollectionSearch(query, tagsFor);
  if (search.kind === 'empty') return lines;

  const hits: { line: OwnedTradeLine; nameHit: boolean }[] = [];
  for (const line of lines) {
    // Every copy on a line is the same oracle card, so any one of them answers
    // the query; per-copy fields (finish, condition) are not searchable here.
    const sample = line.copies[0];
    if (!sample) continue;
    const match = search.match(sample);
    if (match.hit) hits.push({ line, nameHit: match.nameHit });
  }
  hits.sort(
    (a, b) => Number(b.nameHit) - Number(a.nameHit) || a.line.name.localeCompare(b.line.name)
  );
  return hits.map((h) => h.line);
}

/**
 * Lines the owner can part with without touching a deck or a cube — the
 * "tradeable surplus" the collection filter already defines, applied to the
 * give side.
 *
 * `surplusByName` comes from `computeSurplusByName`: unallocated copies beyond
 * the one kept copy, basics excluded. It is the natural complement to the
 * per-printing deck/binder badges — those warn that a copy is committed, this
 * narrows the list to the ones that aren't.
 */
export function filterToSurplus(
  lines: OwnedTradeLine[],
  surplusByName: Map<string, number>
): OwnedTradeLine[] {
  return lines.filter((line) => surplusByName.has(line.name));
}

function toCopy(card: EnrichedCard): TradeCopy {
  const copy: TradeCopy = { scryfallId: card.scryfallId, finish: card.finish };
  if (card.condition) copy.condition = card.condition;
  if (card.language) copy.language = card.language;
  return copy;
}

/**
 * A line's copies ordered cheapest market price first — the order any automatic
 * pick walks.
 *
 * ⚠️ This used to be raw collection order, which is arbitrary from the owner's
 * point of view: offering "Sol Ring ×1" handed over `copies[0]`, so whoever
 * happened to sit first in the array left the binder. With seven printings of a
 * card that can silently be the Beta rather than the Commander reprint.
 * Cheapest-first makes the automatic choice the *least* costly mistake — an
 * accidental cheap trade is annoying, an accidental Beta is not — and the
 * composer lets the owner override it per copy. Ties keep collection order, so
 * identical printings stay stable.
 */
export function copiesByValue(line: OwnedTradeLine): EnrichedCard[] {
  return line.copies
    .map((card, index) => ({ card, index }))
    .sort((a, b) => a.card.purchasePrice - b.card.purchasePrice || a.index - b.index)
    .map((entry) => entry.card);
}

/** A printing as the wire names it: `scryfallId` + `finish`, no condition. */
export interface PrintingRef {
  scryfallId: string;
  finish: string;
}

export function matchesPrinting(card: { scryfallId: string; finish: string }, ref: PrintingRef) {
  return card.scryfallId === ref.scryfallId && card.finish === ref.finish;
}

/**
 * Stable partition: copies no deck or cube holds first, the rest after, each
 * half keeping its incoming order. `claimed` is the set of copyIds an
 * allocation holds (`useAllocations().keys()`).
 */
export function freeFirst(copies: readonly EnrichedCard[], claimed?: ReadonlySet<string>) {
  if (!claimed || claimed.size === 0) return [...copies];
  return [
    ...copies.filter((c) => !claimed.has(c.copyId)),
    ...copies.filter((c) => claimed.has(c.copyId)),
  ];
}

/**
 * The order every automatic GIVE pick walks: a copy a deck or cube holds comes
 * last, and within each half the cheapest first (see {@link copiesByValue}).
 * Auto-picking by price alone offered a deck's copy while a free one sat in the
 * binder, because the deck copy happened to be the cheaper printing.
 */
export function copiesFreeFirst(
  line: OwnedTradeLine,
  claimed?: ReadonlySet<string>
): EnrichedCard[] {
  return freeFirst(copiesByValue(line), claimed);
}

/**
 * `quantity` copies to hand over unattended. Printings in `prefer` (an ask
 * that named them) are taken first, but a free copy always beats a claimed one:
 * free asked printings, then any free copy, then claimed asked printings, then
 * anything left. Fewer come back when the line holds fewer.
 */
export function pickCopies(
  line: OwnedTradeLine,
  quantity: number,
  opts: { claimed?: ReadonlySet<string>; prefer?: readonly PrintingRef[] } = {}
): EnrichedCard[] {
  const { claimed, prefer = [] } = opts;
  const ordered = copiesByValue(line);
  const free = ordered.filter((c) => !claimed?.has(c.copyId));
  const held = ordered.filter((c) => claimed?.has(c.copyId));
  const taken: EnrichedCard[] = [];
  const used = new Set<string>();
  const add = (card: EnrichedCard) => {
    used.add(card.copyId);
    taken.push(card);
  };
  // One copy per asked unit, so two asks of one printing take two copies.
  const takeAsked = (pool: EnrichedCard[]) => {
    for (const ref of prefer) {
      if (taken.length >= quantity) return;
      const hit = pool.find((c) => !used.has(c.copyId) && matchesPrinting(c, ref));
      if (hit) add(hit);
    }
  };
  const takeAny = (pool: EnrichedCard[]) => {
    for (const card of pool) {
      if (taken.length >= quantity) return;
      if (!used.has(card.copyId)) add(card);
    }
  };
  takeAsked(free);
  takeAny(free);
  takeAsked(held);
  takeAny(held);
  return taken;
}

/**
 * How a pick falls short of what an ask named: the asked printings no chosen
 * copy covers (`missed`), and the chosen copies that cover none of them
 * (`given`), one for one. Null when every asked printing is covered, or the ask
 * named none.
 */
export function printingShortfall(
  asked: readonly PrintingRef[],
  chosen: readonly EnrichedCard[]
): { missed: PrintingRef[]; given: EnrichedCard[] } | null {
  const spare = [...chosen];
  const missed: PrintingRef[] = [];
  for (const ref of asked) {
    const at = spare.findIndex((c) => matchesPrinting(c, ref));
    if (at >= 0) spare.splice(at, 1);
    else missed.push(ref);
  }
  return missed.length > 0 ? { missed, given: spare } : null;
}

/**
 * Turns a picked line + quantity into the wire shape, naming the exact copies
 * being handed over. Used where there is no explicit selection — the accept
 * path, and the composer's initial pick — so it takes the CHEAPEST copies (see
 * `copiesByValue`). Asking for more copies than are owned is clamped rather
 * than rejected; the picker already caps at `copies.length`, so this is the
 * belt to that braces.
 */
export function toTradeCard(line: OwnedTradeLine, quantity: number): TradeCard {
  const take = Math.max(0, Math.min(quantity, line.copies.length));
  return toTradeCardFromCopies(line, copiesByValue(line).slice(0, take));
}

/**
 * Wire shape from an EXPLICIT set of copies the owner chose. This is the honest
 * path: a physical trade is a decision about specific objects, not about a
 * quantity of an abstract card.
 *
 * `copyId` deliberately does NOT travel — the wire shape identifies a copy by
 * its printing (`scryfallId` + `finish`), which is what stays correct when the
 * giver edits quantities between proposing and settling. See trade-settlement.
 */
export function toTradeCardFromCopies(line: OwnedTradeLine, chosen: EnrichedCard[]): TradeCard {
  return {
    oracleId: line.oracleId,
    name: line.name,
    quantity: chosen.length,
    copies: chosen.map(toCopy),
  };
}

/** Total market value of a set of copies, in the active display currency
 *  (`purchasePrice` is already override- and proxy-resolved by applyPrices). */
export function sumCopyValue(copies: EnrichedCard[]): number {
  return copies.reduce((total, card) => total + (card.purchasePrice || 0), 0);
}

/** Every owned copy of ONE printing, at one price. */
export interface PrintingGroup {
  /** Stable within a line: printing + finish + condition. */
  key: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition?: string;
  /** Per-copy market price — identical across the group by construction. */
  price: number;
  copies: EnrichedCard[];
}

/**
 * Collapses a line's copies into one row per PRINTING, cheapest first.
 *
 * This is the unit a person actually chooses. Listing raw copies looked
 * thorough and was useless: 37 Evolving Wilds rendered as 37 checkboxes, eight
 * of them the identical "AFR #256 nm" at $0.17 — asking which of eight
 * indistinguishable objects to trade is a question with no answer, and it
 * buried the eight printings that DO differ. Condition is part of the key
 * because a played copy of the same printing is a different thing to trade.
 */
export function printingKeyOf(card: EnrichedCard): string {
  return `${card.scryfallId}|${card.finish}|${card.condition ?? ''}`;
}

export function groupByPrinting(
  line: OwnedTradeLine,
  claimed?: ReadonlySet<string>
): PrintingGroup[] {
  const byKey = new Map<string, PrintingGroup>();
  for (const card of copiesByValue(line)) {
    const key = printingKeyOf(card);
    const existing = byKey.get(key);
    if (existing) {
      existing.copies.push(card);
    } else {
      byKey.set(key, {
        key,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
        price: card.purchasePrice || 0,
        copies: [card],
      });
    }
  }
  // copiesByValue already ordered the input, so insertion order is cheapest
  // printing first and each group's copies are stable. With `claimed`, the
  // copies a deck holds sink to the end of their own group, so "the first N of
  // this printing" (what every count edit takes) is the free ones first.
  const groups = [...byKey.values()];
  if (claimed && claimed.size > 0) {
    for (const g of groups) g.copies = freeFirst(g.copies, claimed);
  }
  return groups;
}

/**
 * How many copies of each printing (by {@link PrintingGroup.key}) are in the
 * trade. The unit the accept dialog edits, and the composer's model expressed
 * as counts rather than copyIds — accepting resolves against copies the viewer
 * has never seen listed, so there is no stable copyId selection to carry.
 */
export type PrintingCounts = Record<string, number>;

export function countsTotal(counts: PrintingCounts): number {
  return Object.values(counts).reduce((n, v) => n + v, 0);
}

/**
 * The cheapest-first pick, expressed as per-printing counts — i.e. exactly what
 * {@link toTradeCard} would hand over unattended, except that copies a deck
 * holds come last and printings the ask named (`prefer`) come first. The
 * answer sheet opens pre-filled with this, so confirming is one more tap rather
 * than data entry, and adjusting is a deliberate override of a safe default.
 */
export function defaultPrintingCounts(
  line: OwnedTradeLine,
  quantity: number,
  opts: { claimed?: ReadonlySet<string>; prefer?: readonly PrintingRef[] } = {}
): PrintingCounts {
  const counts: PrintingCounts = {};
  for (const card of pickCopies(line, Math.max(0, quantity), opts)) {
    const key = printingKeyOf(card);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Sets one printing's count, then trims OTHER printings until the total fits
 * `target` again.
 *
 * The auto-balance is what keeps the common case one tap. An offer for a single
 * Sol Ring is a choice between printings, not an arithmetic exercise: without
 * the trim, switching from the default printing to another means decrementing
 * one and incrementing the other, and every intermediate state is invalid. With
 * it, tapping "+" on the printing you mean is the whole interaction. Trimming
 * takes from the most-selected printing first so a multi-copy pick sheds evenly
 * rather than wiping one printing out.
 */
export function setPrintingCountBalanced(
  groups: PrintingGroup[],
  counts: PrintingCounts,
  printingKey: string,
  next: number,
  target: number
): PrintingCounts {
  const group = groups.find((g) => g.key === printingKey);
  if (!group) return counts;
  const out: PrintingCounts = {
    ...counts,
    [printingKey]: Math.max(0, Math.min(next, group.copies.length)),
  };
  let over = countsTotal(out) - target;
  if (over <= 0) return out;
  const others = groups
    .filter((g) => g.key !== printingKey)
    .sort((a, b) => (out[b.key] ?? 0) - (out[a.key] ?? 0));
  for (const g of others) {
    if (over <= 0) break;
    const take = Math.min(over, out[g.key] ?? 0);
    if (take > 0) {
      out[g.key] = (out[g.key] ?? 0) - take;
      over -= take;
    }
  }
  return out;
}

/** The actual physical copies a set of counts names, cheapest printing first.
 *  Copies within a printing are interchangeable, so taking the first N of each
 *  group is not an arbitrary choice — it is the only one. */
export function copiesFromCounts(groups: PrintingGroup[], counts: PrintingCounts): EnrichedCard[] {
  return groups.flatMap((g) => g.copies.slice(0, counts[g.key] ?? 0));
}

/**
 * The "you get" side: what the viewer is asking a friend for. Named
 * oracle-level with no copies, because the friend collection it was picked
 * from carries no printing detail (contents yes, value no) — the friend's own
 * device fills the printings in when they accept.
 */
export function toRequestedCard(
  card: { oracleId: string; name: string },
  quantity: number
): TradeCard {
  return { oracleId: card.oracleId, name: card.name, quantity, copies: [] };
}
