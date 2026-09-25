import type { EnrichedCard } from '../types';
import type { Deck } from '../store/decks';
import type { SavedCube, CubePickSlot } from '../store/cube';
import type { Pick } from './cube/generate';
// Import from allocations-core, not ./allocations — the latter's `useAllocations`
// hook imports `useCubeStore` at value scope, which would cycle back through
// store/cube.ts now that it imports this module. allocations-core is the
// pure, store-free leaf (types only) this module's own contract requires.
import {
  buildAllocationMap,
  pickCollectionCopy,
  makeDeckAllocationInfo,
  type AllocationInfo,
} from './allocations-core';
import { printingFinishKey } from './collection-mutations';

/**
 * Bind each pick of a (physical) cube to a free collection copy, mirroring
 * {@link saveGeneratedDeck}'s allocation pass. Pure — it reads no stores; the
 * caller passes the live collection / decks / other physical cubes so this
 * stays unit-testable and the cube store stays a dumb setter (no cross-store
 * imports / cycles).
 *
 * `otherPhysicalCubes` must already EXCLUDE the cube being bound (a cube can't
 * contend with itself). Decks + those cubes pre-seed the claimed set so a copy
 * already committed elsewhere is never double-claimed. Each returned slot keeps
 * a durable `printingFinishKey` shadow so the binding survives a collection
 * reimport (copyIds are regenerated on import) via {@link remapCubeAllocations}.
 *
 * CubeCard has no scryfallId (only oracleId), so there's no printing preference
 * to honor — the allocator picks the best free copy by finish/price.
 */
export function bindCubeCopies(
  picks: Pick[],
  collection: EnrichedCard[],
  decks: Deck[],
  otherPhysicalCubes: SavedCube[]
): CubePickSlot[] {
  const claimed = new Map<string, AllocationInfo>(buildAllocationMap(decks, otherPhysicalCubes));
  return picks.map((pick, i) => {
    const copy = pickCollectionCopy(pick.card.name, collection, claimed);
    if (!copy) {
      return { slotId: `${i}`, card: pick.card, allocatedCopyId: null, printingFinishKey: null };
    }
    // Mark claimed so a duplicate name later in the same cube can't grab it too.
    claimed.set(copy.copyId, makeDeckAllocationInfo('__cube_pending__', '', '', pick.card.name));
    return {
      slotId: `${i}`,
      card: pick.card,
      allocatedCopyId: copy.copyId,
      printingFinishKey: printingFinishKey(copy),
    };
  });
}

/**
 * Rebind a cube's picks after an edit (swap / add / remove / "Rebuild the
 * rest"), preserving the binding for any pick whose card is unchanged — only
 * a genuinely new card searches for a free copy, and a card that dropped out
 * simply has no slot left to claim it (released by omission). Same live-state
 * contract as {@link bindCubeCopies}: caller supplies the collection/decks/
 * other-physical-cubes state read at action time.
 *
 * `otherPhysicalCubes` must already EXCLUDE the cube being rebound.
 */
export function rebindCubePicks(
  newPicks: Pick[],
  oldSlots: CubePickSlot[],
  collection: EnrichedCard[],
  decks: Deck[],
  otherPhysicalCubes: SavedCube[]
): CubePickSlot[] {
  const oldByOracle = new Map(oldSlots.map((s) => [s.card.oracleId, s]));
  const liveCopyIds = new Set(collection.map((c) => c.copyId));
  const claimed = new Map<string, AllocationInfo>(buildAllocationMap(decks, otherPhysicalCubes));

  // Decide, per new pick, whether it preserves an old binding — consumed from
  // oldByOracle (by array order) so two picks that coincidentally share an
  // oracleId can't both claim the same old slot. Reserve every preserved
  // binding BEFORE any fresh search runs, so a fresh pick can't steal a copy
  // a later-in-array preserved pick still needs.
  const preserved = new Map<number, CubePickSlot>();
  newPicks.forEach((pick, i) => {
    const old = oldByOracle.get(pick.card.oracleId);
    if (old?.allocatedCopyId && liveCopyIds.has(old.allocatedCopyId)) {
      preserved.set(i, old);
      oldByOracle.delete(pick.card.oracleId);
    }
  });
  for (const old of preserved.values()) {
    claimed.set(
      old.allocatedCopyId!,
      makeDeckAllocationInfo('__cube_pending__', '', '', old.card.name)
    );
  }

  return newPicks.map((pick, i) => {
    const old = preserved.get(i);
    if (old) {
      return {
        slotId: `${i}`,
        card: pick.card,
        allocatedCopyId: old.allocatedCopyId,
        printingFinishKey: old.printingFinishKey,
      };
    }
    const copy = pickCollectionCopy(pick.card.name, collection, claimed);
    if (!copy) {
      return { slotId: `${i}`, card: pick.card, allocatedCopyId: null, printingFinishKey: null };
    }
    claimed.set(copy.copyId, makeDeckAllocationInfo('__cube_pending__', '', '', pick.card.name));
    return {
      slotId: `${i}`,
      card: pick.card,
      allocatedCopyId: copy.copyId,
      printingFinishKey: printingFinishKey(copy),
    };
  });
}
