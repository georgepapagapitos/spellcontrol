import type { EnrichedCard } from '../types';
import type { Deck } from '../store/decks';
import type { SavedCube, CubePickSlot } from '../store/cube';
import type { Pick } from './cube/generate';
import {
  buildAllocationMap,
  pickCollectionCopy,
  makeDeckAllocationInfo,
  type AllocationInfo,
} from './allocations';
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
