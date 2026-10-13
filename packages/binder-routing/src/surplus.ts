import type { EnrichedCard } from './types.js';

/**
 * Basic-land names — fungible across printings, never worth flagging as spare
 * (a deck slot for a Swamp doesn't care which physical Swamp it gets). The
 * canonical list: `frontend/src/lib/allocations-core.ts` re-exports this pair
 * rather than keeping its own copy, so the allocator/deck-builder side and the
 * binder-routing side can never drift apart.
 */
export const BASIC_LAND_NAMES: ReadonlySet<string> = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
  'Snow-Covered Plains',
  'Snow-Covered Island',
  'Snow-Covered Swamp',
  'Snow-Covered Mountain',
  'Snow-Covered Forest',
  'Snow-Covered Wastes',
]);

export function isBasicLandName(name: string): boolean {
  return BASIC_LAND_NAMES.has(name);
}

/**
 * Copies kept aside before the rest of a card's unallocated stock counts as
 * spare/tradeable. 1 is the simplest defensible default: decks here are
 * predominantly Commander (singleton), so a card only ever needs one
 * "working" copy — anything past that, once nothing has claimed it, is free
 * to trade. Constructed playsets (up to 4) would need per-format awareness
 * this collection doesn't track, so the floor stays flat and card-agnostic.
 * Re-exported by `frontend/src/lib/allocations-core.ts`, not duplicated.
 */
export const SURPLUS_KEEP_COPIES = 1;

/** Finish rank for the kept-copy pick: the premium finish is the one you keep. */
const FINISH_KEEP_RANK: Record<string, number> = { foil: 0, etched: 0, nonfoil: 1 };

/**
 * Which available copy of a name is kept: a foil or etched copy before a
 * nonfoil, then the lowest `copyId`. Every key is
 * a physical fact of the copy, never its price, so the kept copy does not
 * flip when a price refresh reorders two printings, and a server projection
 * (whose prices are stamped differently from the device's) picks the same
 * copy as the owner's app.
 */
function keepOrder(a: EnrichedCard, b: EnrichedCard): number {
  const finish = (FINISH_KEEP_RANK[a.finish] ?? 1) - (FINISH_KEEP_RANK[b.finish] ?? 1);
  if (finish !== 0) return finish;
  return a.copyId < b.copyId ? -1 : a.copyId > b.copyId ? 1 : 0;
}

/**
 * Available: owned copies no deck, cube or binder-held allocation has
 * claimed. `allocatedCopyIds` is the allocation map's key set (frontend
 * `buildAllocationMap`) or `collectAllocatedCopyIds` over raw rows on the
 * server; both claim a copy from any deck zone (commander, partner, mainboard,
 * sideboard, considering) and from a physical cube. Every other count in the
 * app ("N free", the cube pool's Available filter, the AI's uncommitted
 * scope, the friend hub's spare flag) reads this one function or the spare
 * rule built on it, so a copy cannot be available on one screen and claimed
 * on another.
 *
 * Counts every available copy, basics and proxies included: a proxy is a
 * card you can put in a deck, which is what "available" asks. What a proxy
 * cannot be is a spare, see `computeSpareCopyIds`.
 */
export function availableCountsByName(
  cards: readonly EnrichedCard[],
  allocatedCopyIds: ReadonlySet<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cards) {
    if (allocatedCopyIds.has(c.copyId)) continue;
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Deterministically decides WHICH physical copies of each card name are
 * spare: a per-copy answer, not just a per-name count, so binder routing can
 * place each copy independently (a binder rule matches or doesn't match a
 * SPECIFIC copy).
 *
 * The one definition of spare, per card name:
 * 1. Start from the available copies (`availableCountsByName`): anything a deck
 *    (any zone, considering included) or physical cube claims is never spare,
 *    and does not use up the kept slot either.
 * 2. Basic lands are excluded entirely (fungible) and proxies never count:
 *    a proxy is not the card, so it is neither spare nor the copy kept.
 * 3. Of what remains, `keepCopies` (default `SURPLUS_KEEP_COPIES`) are kept,
 *    picked by `keepOrder` (foil/etched before nonfoil, then lowest `copyId`).
 *    The rest are spare.
 *
 * The same input always gives the same answer regardless of collection array
 * order. Every surface takes its answer from this function: the collection's
 * spare filter and chip (`computeSurplusByName`), the spare value
 * (`computeSparesSummary`), the cube pool's Spares only filter, the binder
 * "Spare copies" rule, the shared-binder projection and the friend hub's spare
 * flag on the server. `allocations.test.ts` and `spare-parity.test.ts` pin them.
 */
export function computeSpareCopyIds(
  cards: readonly EnrichedCard[],
  allocatedCopyIds: ReadonlySet<string>,
  keepCopies = SURPLUS_KEEP_COPIES
): Set<string> {
  const byName = new Map<string, EnrichedCard[]>();
  for (const c of cards) {
    if (isBasicLandName(c.name) || c.proxy) continue;
    if (allocatedCopyIds.has(c.copyId)) continue;
    const list = byName.get(c.name);
    if (list) list.push(c);
    else byName.set(c.name, [c]);
  }
  const spare = new Set<string>();
  for (const list of byName.values()) {
    if (list.length <= keepCopies) continue;
    const ordered = [...list].sort(keepOrder);
    for (const c of ordered.slice(keepCopies)) spare.add(c.copyId);
  }
  return spare;
}

/**
 * `cards` decorated with `.spareCopy`, EVERY card explicit true/false (never
 * left `undefined`) — a `spareCopies: false` (IS NOT) rule must match every
 * kept copy, not just the ones a partial decoration bothered to touch.
 */
export function decorateWithSpareCopies(
  cards: readonly EnrichedCard[],
  allocatedCopyIds: ReadonlySet<string>,
  keepCopies = SURPLUS_KEEP_COPIES
): EnrichedCard[] {
  const spare = computeSpareCopyIds(cards, allocatedCopyIds, keepCopies);
  return cards.map((c) => ({ ...c, spareCopy: spare.has(c.copyId) }));
}

type Loose = Record<string, unknown>;
const asLoose = (v: unknown): Loose | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : null;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Cheap walk of binder defs (typed or raw JSONB): does any rule read
 * `spareCopies`? Gates the decoration pass, which needs the whole collection
 * plus the owner's decks and cubes, so nothing pays for it unless a binder
 * asks.
 */
export function anyBinderUsesSpareCopies(binders: unknown): boolean {
  return asArray(binders).some((b) =>
    asArray(asLoose(b)?.filterGroups).some(
      (g) => asLoose(asLoose(g)?.filter)?.spareCopies !== undefined
    )
  );
}

/**
 * Every copyId a deck or physical cube claims, from raw deck/cube JSON. The
 * same claim list as frontend `buildAllocationMap` (commander, partner,
 * mainboard, sideboard, considering; physical cubes' picks), without the
 * per-claim labels — the server has no store, so shared-binder projections
 * and the game-night trade board decide spare copies from this.
 * `allocations.test.ts` pins it to `buildAllocationMap`'s key set.
 */
export function collectAllocatedCopyIds(decks: unknown, cubes: unknown): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v) out.add(v);
  };
  for (const raw of asArray(decks)) {
    const deck = asLoose(raw);
    if (!deck) continue;
    if (deck.commander) add(deck.commanderAllocatedCopyId);
    if (deck.partnerCommander) add(deck.partnerCommanderAllocatedCopyId);
    for (const zone of [deck.cards, deck.sideboard, deck.considering]) {
      for (const slot of asArray(zone)) add(asLoose(slot)?.allocatedCopyId);
    }
  }
  for (const raw of asArray(cubes)) {
    const cube = asLoose(raw);
    if (!cube || cube.isPhysical !== true) continue;
    for (const slot of asArray(cube.picks)) add(asLoose(slot)?.allocatedCopyId);
  }
  return out;
}
