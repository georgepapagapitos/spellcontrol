/**
 * Collection Breakdown insights (T164) — what a Commander player with many
 * decks and physical binders can DO with their cards, not just how many of
 * each color they own. Replaces the old Colors/Types/Rarity descriptive
 * sections' exclusive claim on the drawer: those three now live behind one
 * flexible group-by (see `computeGroupedBreakdown`), and this module adds the
 * actionable layer above it.
 *
 * Deliberately store-free (mirrors `lib/ownership-lens.ts`'s established
 * pattern): every function takes plain arrays/maps already read from the
 * stores, so this stays cheap to unit-test with no store/IndexedDB side
 * effects. `StatsBar`/`CollectionPage` own the store reads.
 */
import { materializeBinders } from './materialize';
import { isBasicLandName, SURPLUS_KEEP_COPIES, computeSurplusByName } from './allocations-core';
import { priceOf } from './deck-value';
import { getColorKey, COLOR_INFO } from './colors';
import { getCardType, TYPE_ORDER } from './card-types';
import type { AllocationInfo } from './allocations-core';
import type { Currency } from './currency';
import type { Deck } from '../store/decks';
import type { SavedCube } from '../store/cube';
import type { ScryfallCard } from '@/deck-builder/types';
import type { BinderDef, EnrichedCard } from '../types';

// ── Where a Breakdown row sends the collection table ────────────────────────

/**
 * A row's destination filter, applied to the collection table and closing
 * the drawer. Each variant mirrors an existing `CardListTable` filter field
 * exactly (see `CardListTable.tsx`'s `filterJump` effect) — a dimension with
 * no collection filter has no variant here, and its rows render as plain
 * text (see `computeGroupedBreakdown`'s `filterJump: undefined`).
 */
export type CollectionFilterJump =
  | { kind: 'binder'; name: string }
  | { kind: 'color'; key: string }
  | { kind: 'rarity'; key: string }
  | { kind: 'type'; key: string }
  | { kind: 'set'; code: string }
  | { kind: 'surplus' };

/** Sentinel `CardListTable` already uses for "no binder claimed this copy". */
export const UNCATEGORIZED_BINDER = '__uncategorized';

// ── In decks vs idle ─────────────────────────────────────────────────────────

export interface AllocationSplit {
  boundCount: number;
  boundValue: number;
  idleCount: number;
  idleValue: number;
}

/**
 * Physical copies bound to a deck or physical cube vs bound to nothing.
 * Basic lands are excluded from BOTH buckets: a collection's basic-land count
 * is a function of how many were imported, not a meaningful "committed vs
 * spare" signal, and including them would swamp the idle bucket with noise
 * no one is going to act on.
 *
 * No collection filter distinguishes "any allocation" from "none" (the only
 * allocation-aware filter is tradeable surplus, a narrower predicate — see
 * `computeSparesSummary`), so this insight's rows carry no `filterJump`.
 */
export function computeAllocationSplit(
  cards: EnrichedCard[],
  allocations: ReadonlyMap<string, AllocationInfo>
): AllocationSplit | null {
  let boundCount = 0;
  let boundValue = 0;
  let idleCount = 0;
  let idleValue = 0;
  for (const c of cards) {
    if (isBasicLandName(c.name)) continue;
    if (allocations.has(c.copyId)) {
      boundCount++;
      boundValue += c.purchasePrice;
    } else {
      idleCount++;
      idleValue += c.purchasePrice;
    }
  }
  if (boundCount + idleCount === 0) return null;
  return { boundCount, boundValue, idleCount, idleValue };
}

// ── Spares (tradeable surplus) ───────────────────────────────────────────────

export interface SparesSummary {
  count: number;
  value: number;
}

/**
 * Tradeable surplus (same definition `computeSurplusByName` already uses,
 * and the same filter the collection's "Tradeable surplus" toggle applies):
 * unallocated copies beyond the one kept copy per name, basics excluded.
 * Adds the money side surplus-by-name doesn't carry: per name, the MOST
 * valuable unclaimed copy is the one assumed kept (a player keeps their
 * nicest copy as the "working" one), so the spare value is the sum of the
 * cheaper unclaimed copies past that.
 */
export function computeSparesSummary(
  cards: EnrichedCard[],
  allocations: ReadonlyMap<string, AllocationInfo>
): SparesSummary | null {
  const surplusByName = computeSurplusByName(cards, allocations);
  if (surplusByName.size === 0) return null;

  const unclaimedPricesByName = new Map<string, number[]>();
  for (const c of cards) {
    if (!surplusByName.has(c.name)) continue;
    if (allocations.has(c.copyId)) continue;
    const arr = unclaimedPricesByName.get(c.name);
    if (arr) arr.push(c.purchasePrice);
    else unclaimedPricesByName.set(c.name, [c.purchasePrice]);
  }

  let count = 0;
  let value = 0;
  for (const [name, extra] of surplusByName) {
    const prices = (unclaimedPricesByName.get(name) ?? []).sort((a, b) => b - a);
    const spare = prices.slice(SURPLUS_KEEP_COPIES);
    count += extra;
    value += spare.reduce((s, p) => s + p, 0);
  }
  return count > 0 ? { count, value } : null;
}

// ── Shared copies (decks/cubes wanting more than you own) ──────────────────

export interface SharedCopyWanter {
  kind: 'deck' | 'cube';
  id: string;
  name: string;
}

export interface SharedCopyRow {
  cardName: string;
  owned: number;
  /** Distinct decks/cubes that list this card — the demand side. */
  demand: number;
  /** demand - owned, always > 0 for a returned row. */
  shortfall: number;
  wantedBy: SharedCopyWanter[];
}

/**
 * Cards where decks (and physical cubes) together list more copies than you
 * own, restricted to cards you own at least one of (zero-owned cards are the
 * "Close to done" / normal missing-card story, not a shared-copies
 * contention). `cubes` is the full saved-cube list; non-`isPhysical` (draft)
 * cubes are filtered out here, mirroring `buildAllocationMap`'s own check.
 * Demand counts DISTINCT wanting containers, not physical copies wanted -
 * this app is predominantly Commander-singleton, so one listing equals one
 * wanted copy. Considering-zone and sideboard slots are excluded: they are
 * park-candidates, not committed picks.
 */
export function computeSharedCopies(
  cards: EnrichedCard[],
  decks: Deck[],
  cubes: SavedCube[]
): SharedCopyRow[] {
  const owned = new Map<string, number>();
  for (const c of cards) {
    if (isBasicLandName(c.name)) continue;
    owned.set(c.name, (owned.get(c.name) ?? 0) + 1);
  }

  const wanters = new Map<string, SharedCopyWanter[]>();
  const addWant = (cardName: string, kind: 'deck' | 'cube', id: string, containerName: string) => {
    if (isBasicLandName(cardName)) return;
    const list = wanters.get(cardName);
    if (list) {
      if (!list.some((w) => w.kind === kind && w.id === id))
        list.push({ kind, id, name: containerName });
    } else {
      wanters.set(cardName, [{ kind, id, name: containerName }]);
    }
  };

  for (const deck of decks) {
    if (deck.commander) addWant(deck.commander.name, 'deck', deck.id, deck.name);
    if (deck.partnerCommander) addWant(deck.partnerCommander.name, 'deck', deck.id, deck.name);
    for (const dc of deck.cards) addWant(dc.card.name, 'deck', deck.id, deck.name);
  }
  for (const cube of cubes) {
    if (!cube.isPhysical) continue;
    for (const pick of cube.picks ?? []) addWant(pick.card.name, 'cube', cube.id, cube.name);
  }

  const rows: SharedCopyRow[] = [];
  for (const [cardName, wantedBy] of wanters) {
    const ownedCount = owned.get(cardName) ?? 0;
    if (ownedCount === 0) continue;
    const demand = wantedBy.length;
    const shortfall = demand - ownedCount;
    if (shortfall <= 0) continue;
    rows.push({ cardName, owned: ownedCount, demand, shortfall, wantedBy });
  }
  rows.sort((a, b) => b.shortfall - a.shortfall || a.cardName.localeCompare(b.cardName));
  return rows;
}

// ── Close to done ────────────────────────────────────────────────────────────

export interface CloseToDoneRow {
  deckId: string;
  deckName: string;
  deckColor: string;
  missingNames: string[];
  /** Sum of `priceOf` over the missing cards, in `currency`. 0 when every
   *  missing card has no recorded market price — still a real "$0 to add",
   *  not an unknown, since `priceOf` treats "no price" as 0. */
  costToFinish: number;
}

const CLOSE_TO_DONE_MAX_MISSING = 5;

/**
 * Decks missing only 1-5 cards you don't own at ALL (any copy, anywhere in
 * the collection) — the ones a single trip to the store finishes. Basic
 * lands are never counted as missing (assumed always available). Reads
 * `deck.cards` (mainboard) plus both commander slots; sideboard/considering
 * are excluded, same reasoning as `computeSharedCopies`. Deck cards are
 * frozen Scryfall snapshots (see memory
 * project_deck_cards_are_frozen_cache_copies) — `priceOf` reads the price the
 * card carried when it was added, exactly like the decks index's own value.
 */
export function computeCloseToDone(
  decks: Deck[],
  ownedNames: ReadonlySet<string>,
  currency: Currency
): CloseToDoneRow[] {
  const rows: CloseToDoneRow[] = [];
  for (const deck of decks) {
    const missing = new Map<string, ScryfallCard>();
    const consider = (card: ScryfallCard | null) => {
      if (!card) return;
      if (isBasicLandName(card.name)) return;
      if (ownedNames.has(card.name)) return;
      if (!missing.has(card.name)) missing.set(card.name, card);
    };
    consider(deck.commander);
    consider(deck.partnerCommander);
    for (const dc of deck.cards) consider(dc.card);

    if (missing.size === 0 || missing.size > CLOSE_TO_DONE_MAX_MISSING) continue;
    const missingNames = [...missing.keys()];
    const costToFinish = [...missing.values()].reduce((s, c) => s + priceOf(c, currency), 0);
    rows.push({
      deckId: deck.id,
      deckName: deck.name,
      deckColor: deck.color,
      missingNames,
      costToFinish,
    });
  }
  rows.sort((a, b) => a.missingNames.length - b.missingNames.length);
  return rows;
}

// ── Concentration ────────────────────────────────────────────────────────────

export interface ConcentrationInsight {
  /** 0-100, rounded. */
  topSharePct: number;
  topCount: number;
}

const CONCENTRATION_MIN_PRICED = 30;

/**
 * Share of the collection's priced market value held by its most valuable
 * copies (top 10, or every priced copy when fewer than 10 are priced). Only
 * reported once the collection has enough priced copies for a "top 10" to
 * mean anything — a 6-card collection where the top 10 is "all of it" isn't
 * a concentration finding.
 */
export function computeConcentration(cards: EnrichedCard[]): ConcentrationInsight | null {
  const priced = cards
    .map((c) => c.purchasePrice)
    .filter((p) => p > 0)
    .sort((a, b) => b - a);
  if (priced.length < CONCENTRATION_MIN_PRICED) return null;
  const total = priced.reduce((s, p) => s + p, 0);
  if (total <= 0) return null;
  const topCount = Math.min(10, priced.length);
  const top = priced.slice(0, topCount).reduce((s, p) => s + p, 0);
  return { topSharePct: Math.round((top / total) * 100), topCount };
}

// ── Grouped Breakdown card (Color / Type / Rarity / Set / Binder / Deck use) ─

export type BreakdownGroupBy = 'color' | 'type' | 'rarity' | 'set' | 'binder' | 'deckUse';
export type BreakdownMeasure = 'count' | 'value';

export const BREAKDOWN_GROUP_OPTIONS: Array<{ value: BreakdownGroupBy; label: string }> = [
  { value: 'color', label: 'Color' },
  { value: 'type', label: 'Type' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'set', label: 'Set' },
  { value: 'binder', label: 'Binder' },
  { value: 'deckUse', label: 'Deck use' },
];

export interface GroupedBreakdownRow {
  key: string;
  label: string;
  color?: string;
  count: number;
  value: number;
  /** Type grouping only: per-color-bucket counts, for the StackedBar split. */
  colorSplits?: Record<string, number>;
  /** Absent = the row is not a button (no matching collection filter). */
  filterJump?: CollectionFilterJump;
  /**
   * Binder grouping only: the physical pages this binder fills, from the same
   * layout BinderPage and the binders index show (`totalPages`: pocket size,
   * double-sided sheets, page breaks). Absent for "Not in a binder".
   */
  pages?: number;
}

const RARITY_BUCKETS: Array<{ key: string; label: string; color: string }> = [
  { key: 'mythic', label: 'Mythic', color: 'var(--rarity-mythic-to)' },
  { key: 'rare', label: 'Rare', color: 'var(--rarity-rare-to)' },
  { key: 'uncommon', label: 'Uncommon', color: 'var(--rarity-uncommon-to)' },
  { key: 'common', label: 'Common', color: 'var(--rarity-common-to)' },
];

const COLOR_BUCKETS: Array<{ key: string; label: string; color: string }> = [
  { key: 'W', label: 'White', color: COLOR_INFO.W.pip },
  { key: 'U', label: 'Blue', color: COLOR_INFO.U.pip },
  { key: 'B', label: 'Black', color: COLOR_INFO.B.pip },
  { key: 'R', label: 'Red', color: COLOR_INFO.R.pip },
  { key: 'G', label: 'Green', color: COLOR_INFO.G.pip },
  { key: 'M', label: 'Multicolor', color: COLOR_INFO.M.pip },
  { key: 'C', label: 'Colorless', color: COLOR_INFO.C.pip },
];

const TYPE_LABELS: Record<string, string> = {
  creature: 'Creature',
  instant: 'Instant',
  sorcery: 'Sorcery',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  land: 'Land',
  planeswalker: 'Planeswalker',
  battle: 'Battle',
  other: 'Other',
};

export { COLOR_BUCKETS, TYPE_LABELS, RARITY_BUCKETS };

/** Every value-picker chip this app exposes for a single color key EXCEPT
 *  multicolor: 'M' has no chip (the color filter picks literal WUBRG+C
 *  letters), so a Multicolor row is never a button. `colorMode: 'all'` makes
 *  a single-letter selection an EXACT match (mono-that-color only) — 'any'
 *  would include every card that merely contains the color, which is a
 *  bigger set than the bucket this row counted. */
function colorFilterJump(key: string): CollectionFilterJump | undefined {
  return key === 'M' ? undefined : { kind: 'color', key };
}

function typeFilterJump(key: string): CollectionFilterJump | undefined {
  return key === 'other' ? undefined : { kind: 'type', key };
}

export function computeGroupedBreakdown(
  cards: EnrichedCard[],
  groupBy: BreakdownGroupBy,
  ctx: {
    binderDefs?: BinderDef[];
    allocations?: ReadonlyMap<string, AllocationInfo>;
  } = {}
): GroupedBreakdownRow[] {
  if (groupBy === 'color') {
    const buckets = new Map<string, { count: number; value: number }>();
    for (const c of cards) {
      const key = getColorKey(c);
      const b = buckets.get(key) ?? { count: 0, value: 0 };
      b.count++;
      b.value += c.purchasePrice;
      buckets.set(key, b);
    }
    return COLOR_BUCKETS.filter((b) => (buckets.get(b.key)?.count ?? 0) > 0).map((b) => {
      const agg = buckets.get(b.key)!;
      return {
        key: b.key,
        label: b.label,
        color: b.color,
        count: agg.count,
        value: agg.value,
        filterJump: colorFilterJump(b.key),
      };
    });
  }

  if (groupBy === 'type') {
    const totals = new Map<
      string,
      { count: number; value: number; splits: Record<string, number> }
    >();
    for (const c of cards) {
      const t = getCardType(c);
      const colorKey = getColorKey(c);
      const agg = totals.get(t) ?? { count: 0, value: 0, splits: {} };
      agg.count++;
      agg.value += c.purchasePrice;
      agg.splits[colorKey] = (agg.splits[colorKey] ?? 0) + 1;
      totals.set(t, agg);
    }
    return TYPE_ORDER.filter((t) => (totals.get(t)?.count ?? 0) > 0).map((t) => {
      const agg = totals.get(t)!;
      return {
        key: t,
        label: TYPE_LABELS[t] ?? t,
        count: agg.count,
        value: agg.value,
        colorSplits: agg.splits,
        filterJump: typeFilterJump(t),
      };
    });
  }

  if (groupBy === 'rarity') {
    const buckets = new Map<string, { count: number; value: number }>();
    for (const c of cards) {
      const key = (c.rarity || '').toLowerCase();
      const b = buckets.get(key) ?? { count: 0, value: 0 };
      b.count++;
      b.value += c.purchasePrice;
      buckets.set(key, b);
    }
    return RARITY_BUCKETS.filter((b) => (buckets.get(b.key)?.count ?? 0) > 0).map((b) => {
      const agg = buckets.get(b.key)!;
      return {
        key: b.key,
        label: b.label,
        color: b.color,
        count: agg.count,
        value: agg.value,
        filterJump: { kind: 'rarity', key: b.key },
      };
    });
  }

  if (groupBy === 'set') {
    const buckets = new Map<string, { label: string; count: number; value: number }>();
    for (const c of cards) {
      const key = c.setCode || '?';
      const b = buckets.get(key) ?? { label: c.setName || key.toUpperCase(), count: 0, value: 0 };
      b.count++;
      b.value += c.purchasePrice;
      buckets.set(key, b);
    }
    return [...buckets.entries()].map(([key, b]) => ({
      key,
      label: b.label,
      count: b.count,
      value: b.value,
      filterJump: { kind: 'set', code: key },
    }));
  }

  if (groupBy === 'binder') {
    // Same construction as CardListTable's cardToBinder / ownership-lens's
    // materializeBinders call: route every physical copy to at most one
    // binder, via the shared binder-routing engine. `allocatedCopyIds`
    // matches BinderPage's own chain (a hideDeckAllocated=false binder skips
    // those copies entirely) — `cards` itself must already be the DECORATED
    // list `useBinderLayoutInputs()` produces (tags/SLD drops/release
    // dates), which is the caller's job; see this module's allowlist entry
    // in src/test/one-binder-layout-chain.test.ts.
    const { binders } = materializeBinders(cards, ctx.binderDefs ?? [], {
      search: '',
      allocatedCopyIds: ctx.allocations ? new Set(ctx.allocations.keys()) : undefined,
    });
    const copyToBinder = new Map<string, { name: string }>();
    const pagesByName = new Map<string, number>();
    for (const b of binders) {
      if (b.totalPages > 0) pagesByName.set(b.def.name, b.totalPages);
      for (const section of b.sections) {
        for (const c of section.cards) {
          if (!copyToBinder.has(c.copyId)) copyToBinder.set(c.copyId, { name: b.def.name });
        }
      }
    }
    const buckets = new Map<string, { count: number; value: number }>();
    for (const c of cards) {
      const name = copyToBinder.get(c.copyId)?.name ?? 'Not in a binder';
      const b = buckets.get(name) ?? { count: 0, value: 0 };
      b.count++;
      b.value += c.purchasePrice;
      buckets.set(name, b);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => (a === 'Not in a binder' ? 1 : b === 'Not in a binder' ? -1 : 0))
      .map(([name, b]) => ({
        key: name,
        label: name,
        count: b.count,
        value: b.value,
        pages: pagesByName.get(name),
        filterJump: {
          kind: 'binder',
          name: name === 'Not in a binder' ? UNCATEGORIZED_BINDER : name,
        },
      }));
  }

  // 'deckUse' — reuses computeAllocationSplit so the Breakdown card's own
  // numbers never disagree with the "In decks vs idle" insight above it. No
  // collection filter distinguishes "any allocation" from "none" (see that
  // function's doc), so neither row is a button.
  const split = computeAllocationSplit(cards, ctx.allocations ?? new Map());
  if (!split) return [];
  return [
    { key: 'in-deck', label: 'In decks', count: split.boundCount, value: split.boundValue },
    { key: 'idle', label: 'Idle', count: split.idleCount, value: split.idleValue },
  ];
}
