import type { EnrichedCard } from '../types';
import { useCubeStore, type CubePickSlot } from '../store/cube';
import { pickCollectionCopy, makeDeckAllocationInfo, type AllocationInfo } from './allocations';
import { printingFinishKey } from './collection-mutations';

/**
 * Re-resolve every physical cube's pick→copy bindings against a replaced
 * collection. copyIds are regenerated on every import, so without this a
 * reimport would orphan all cube claims. Mirrors decks.ts `remapAllocations`:
 *
 *  - Phase A: keep every still-valid binding (copyId still present, same name,
 *    not already taken) so stable bindings get first dibs across ALL cubes.
 *  - Phase B: rebind broken/unbound slots via the durable `printingFinishKey`
 *    shadow first (same printing+finish), then any free copy by name; leave a
 *    gap when nothing's free.
 *
 * Non-physical cubes (and cubes with no picks) are skipped. Only writes a cube
 * back when a binding actually changed, so it won't spam the sync subscriber.
 */
export function remapCubeAllocations(newCollection: EnrichedCard[]): void {
  const { saved, updateSaved } = useCubeStore.getState();
  const physical = saved.filter((c) => c.isPhysical && (c.picks?.length ?? 0) > 0);
  if (physical.length === 0) return;

  const byCopyId = new Map<string, EnrichedCard>();
  for (const c of newCollection) byCopyId.set(c.copyId, c);

  // Presence map shared across all physical cubes (kind is irrelevant here —
  // pickCollectionCopy only checks membership).
  const claimed = new Map<string, AllocationInfo>();
  const take = (copyId: string, cardName: string) =>
    claimed.set(copyId, makeDeckAllocationInfo('__cube_remap__', '', '', cardName));

  // Phase A — preserve still-valid bindings first.
  const stable = new Set<string>(); // `${cubeId}:${slotId}`
  for (const cube of physical) {
    for (const slot of cube.picks) {
      if (!slot.allocatedCopyId) continue;
      const cur = byCopyId.get(slot.allocatedCopyId);
      if (cur && cur.name === slot.card.name && !claimed.has(cur.copyId)) {
        take(cur.copyId, cur.name);
        stable.add(`${cube.id}:${slot.slotId}`);
      }
    }
  }

  // Phase B — rebind everything else (shadow → name → gap).
  for (const cube of physical) {
    let changed = false;
    const next: CubePickSlot[] = cube.picks.map((slot) => {
      if (stable.has(`${cube.id}:${slot.slotId}`)) return slot;
      let pick: EnrichedCard | null = null;
      if (slot.printingFinishKey) {
        pick =
          newCollection.find(
            (c) =>
              !claimed.has(c.copyId) &&
              c.name === slot.card.name &&
              printingFinishKey(c) === slot.printingFinishKey
          ) ?? null;
      }
      if (!pick) pick = pickCollectionCopy(slot.card.name, newCollection, claimed);
      const allocatedCopyId = pick ? pick.copyId : null;
      const newKey = pick ? printingFinishKey(pick) : null;
      if (pick) take(pick.copyId, pick.name);
      if (allocatedCopyId === slot.allocatedCopyId && newKey === slot.printingFinishKey)
        return slot;
      changed = true;
      return { ...slot, allocatedCopyId, printingFinishKey: newKey };
    });
    if (changed) updateSaved(cube.id, { picks: next });
  }
}
