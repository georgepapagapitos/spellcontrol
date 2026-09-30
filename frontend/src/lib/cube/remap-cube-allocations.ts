import type { EnrichedCard } from '@/types/index';
import { useCubeStore, type CubePickSlot } from '@/store/cube';
import { useDecksStore } from '@/store/decks';
import {
  buildAllocationMap,
  dedupeCubeAllocations,
  pickCollectionCopy,
  makeDeckAllocationInfo,
  type AllocationInfo,
} from '@/lib/collection/allocations-core';
import { printingFinishKey } from '@/lib/collection/collection-mutations';

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
  // pickCollectionCopy only checks membership). Seeded from the CURRENT deck
  // allocations (`remapDeckAllocations` in store/collection.ts always runs
  // the deck remap immediately before this) so a cube can never hand out a
  // copyId a deck slot already claims — closes the deck↔cube double-claim
  // hole a reimport could otherwise open (E133).
  // Decks only on purpose: Phase A below claims the cubes' own copies.
  const claimed = new Map<string, AllocationInfo>(
    buildAllocationMap(useDecksStore.getState().decks, [])
  );
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

/**
 * Re-match every claim against a replaced collection: decks first (kept away
 * from copies the physical cubes hold), then the cubes. The one entry point
 * for a collection change, so no caller runs the deck half alone and lets it
 * take a cube's copy.
 */
export function remapAllAllocations(newCollection: EnrichedCard[]): void {
  const { decks, remapAllocations } = useDecksStore.getState();
  if (decks.length > 0) remapAllocations(newCollection, useCubeStore.getState().saved);
  remapCubeAllocations(newCollection);
}

/**
 * Self-heal for a copy claimed by both a deck and a physical cube, or by two
 * cubes. The remaps above prevent it, but a sync from another device, or
 * undoing a cube delete, can still bring one in. Mirrors the deck store's
 * deck-vs-deck dedupe subscriber, and lives here because this module already
 * reads both stores (the stores never import each other's values).
 * `installCubeClaimHeal` below attaches it.
 *
 * Deferred one microtask, like that subscriber: a write made while server
 * rows are being applied would be skipped by the cube store's sync
 * subscriber, and by then the guard is down so the release is pushed.
 */
let healQueued = false;
function queueCubeClaimHeal(): void {
  if (healQueued) return;
  healQueued = true;
  queueMicrotask(() => {
    healQueued = false;
    const { cubes, changed } = dedupeCubeAllocations(
      useCubeStore.getState().saved,
      useDecksStore.getState().decks
    );
    if (changed) useCubeStore.setState({ saved: cubes });
  });
}
let healInstalled = false;
/** Start the heal. Called once at boot (main.tsx), not on import, so a test
 *  that mocks a store can still import this module. Idempotent. */
export function installCubeClaimHeal(): void {
  if (healInstalled) return;
  healInstalled = true;
  useDecksStore.subscribe((state, prev) => {
    if (state.decks !== prev.decks) queueCubeClaimHeal();
  });
  useCubeStore.subscribe((state, prev) => {
    if (state.saved !== prev.saved) queueCubeClaimHeal();
  });
  queueCubeClaimHeal();
}
