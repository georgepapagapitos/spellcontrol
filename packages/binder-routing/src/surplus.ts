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
 * Which unallocated copy of a name is kept: a real card before a proxy, a
 * foil or etched copy before a nonfoil, then the lowest `copyId`. Every key is
 * a physical fact of the copy, never its price, so the kept copy does not
 * flip when a price refresh reorders two printings, and a server projection
 * (whose prices are stamped differently from the device's) picks the same
 * copy as the owner's app.
 */
function keepOrder(a: EnrichedCard, b: EnrichedCard): number {
  const proxy = Number(Boolean(a.proxy)) - Number(Boolean(b.proxy));
  if (proxy !== 0) return proxy;
  const finish = (FINISH_KEEP_RANK[a.finish] ?? 1) - (FINISH_KEEP_RANK[b.finish] ?? 1);
  if (finish !== 0) return finish;
  return a.copyId < b.copyId ? -1 : a.copyId > b.copyId ? 1 : 0;
}

/**
 * Deterministically decides WHICH physical copies of each card name are
 * spare — a per-copy answer, not just a per-name count, so binder routing can
 * place each copy independently (a binder rule matches or doesn't match a
 * SPECIFIC copy).
 *
 * The definition, per card name (basic lands excluded entirely):
 * 1. A copy allocated to a deck or cube is never spare. It is already
 *    claimed, which is a stronger status than "kept aside", and it does not
 *    use up the kept slot either (this is `computeSurplusByName`'s
 *    long-standing count: copies bound to no deck or cube, beyond the first).
 * 2. Of the remaining copies, `keepCopies` (default `SURPLUS_KEEP_COPIES`) are
 *    kept, picked by `keepOrder` (real before proxy, foil/etched before
 *    nonfoil, then lowest `copyId`). The rest are spare.
 *
 * The same input always gives the same answer regardless of collection array
 * order. Frontend `computeSurplusByName` is a per-name tally over this, so
 * "spare" has one definition app-wide; `allocations.test.ts` pins the two
 * agreeing.
 */
export function computeSpareCopyIds(
  cards: readonly EnrichedCard[],
  allocatedCopyIds: ReadonlySet<string>,
  keepCopies = SURPLUS_KEEP_COPIES
): Set<string> {
  const byName = new Map<string, EnrichedCard[]>();
  for (const c of cards) {
    if (isBasicLandName(c.name)) continue;
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
