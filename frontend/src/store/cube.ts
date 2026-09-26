import { logger } from '@/lib/logger';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safe-local-storage';
import { isApplyingServer } from '../lib/applying-server';
// `bucketOf` from the leaf module, never `./cube/generate`: this store loads at
// boot, and a value import of the generator drags it (targets, refiner,
// objective) into the entry's boot graph.
import { bucketOf, type CubeCard } from '../lib/cube/core';
import type { GeneratedCube, Pick } from '../lib/cube/generate';
import type { ColorBucket, CubeSize } from '../lib/cube/targets';
import type { PoolFilters } from '../lib/cube/pool-filters';
import { rebindCubePicks } from '../lib/bind-cube-copies';
// Type-only — erased at compile time, so this does NOT create the value-level
// cycle collection.ts -> cube.ts -> collection.ts (see import-cycles.test.ts).
// The store stays a dumb setter otherwise: no store-value cross-imports.
import type { EnrichedCard } from '../types';
import type { Deck } from './decks';

/**
 * The physical binding for one cube pick: which collection copy stands in for
 * it. Parallel to `cube.picks` but a self-contained list so it survives a
 * collection reimport (copyIds are volatile) via the durable `printingFinishKey`
 * shadow, exactly like a deck slot's `allocatedCopyId` + binder pins.
 */
export interface CubePickSlot {
  /** Stable identity within this cube (the pick's index as a string). */
  slotId: string;
  card: CubeCard;
  /** Bound collection copy, or null when no free copy was available. */
  allocatedCopyId: string | null;
  /** Durable `${scryfallId}:${finish}` shadow for remap-on-reimport. */
  printingFinishKey: string | null;
}

/** A cube the user named and kept. Synced via the `cube` entity kind. */
export interface SavedCube {
  id: string;
  name: string;
  size: CubeSize;
  cube: GeneratedCube;
  /**
   * Physical-copy bindings (one per pick). Only meaningful when `isPhysical`.
   * Empty / absent on draft cubes and on legacy cubes saved before the feature.
   */
  picks: CubePickSlot[];
  /**
   * True = this is a real, built cube that claims physical copies (excluded
   * from deck/binder availability). False / absent = a draft that claims nothing.
   */
  isPhysical: boolean;
  savedAt: number;
  /** oracleIds locked against "Rebuild the rest" — stay in the cube across a
   *  rebuild. Absent / [] on cubes saved before this shipped. */
  locked?: string[];
  /** oracleIds banned from this cube (and any rebuild of it) — never comes
   *  back. Absent / [] on cubes saved before this shipped. */
  banned?: string[];
  /** The settings the cube was last built with, reused by "Rebuild the rest"
   *  so it doesn't have to re-ask. Absent on cubes saved before this shipped,
   *  or on a cube that was never (re)built through the settings-aware path —
   *  the caller falls back to defaults. */
  settings?: { synergyLevel: number; filters: PoolFilters };
}

interface CubeState {
  /** Picker selection / last-generated size. */
  size: CubeSize;
  /** The current working cube (unsaved until the user names it). */
  result: GeneratedCube | null;
  /**
   * Which saved cube `result` IS, when the user loaded one (or just saved the
   * working cube). null = a fresh, unsaved build. The result view reads this
   * to show the cube's name instead of "N-card cube", to drop "Save cube" (it
   * is already saved), and to skip badging a physical cube's own reserved
   * copies as "in a cube" — they are in THIS cube.
   */
  loadedId: string | null;
  /** Named cubes the user kept, newest first. Synced via IDB; NOT in localStorage. */
  saved: SavedCube[];
  setResult: (size: CubeSize, cube: GeneratedCube) => void;
  /** Clear only the working result (used before a regenerate) — keeps saved cubes. */
  clear: () => void;
  /** Snapshot the current working cube into the saved list under `name`. When
   *  `isPhysical`, pass the bound `picks` (built by `bindCubeCopies` at the call
   *  site, where the live collection/decks are in scope). `settings` records
   *  what it was built with, for a later "Rebuild the rest". */
  saveCurrent: (
    name: string,
    isPhysical?: boolean,
    picks?: CubePickSlot[],
    settings?: SavedCube['settings']
  ) => void;
  /** Insert a cube into the saved list directly (e.g. copying a shared cube),
   *  WITHOUT touching the working `result` — so a copy never clobbers an
   *  in-progress generate. Returns the new id. */
  saveDirectly: (
    name: string,
    size: CubeSize,
    cube: GeneratedCube,
    isPhysical?: boolean,
    picks?: CubePickSlot[],
    settings?: SavedCube['settings']
  ) => string;
  /** Make a saved cube the current working result. */
  loadSaved: (id: string) => void;
  renameSaved: (id: string, name: string) => void;
  removeSaved: (id: string) => void;
  /** Toggle a saved cube's physical flag. Pass the freshly-bound `picks` when
   *  turning ON (claims copies); pass `[]` when turning OFF (releases them). */
  setPhysical: (id: string, isPhysical: boolean, picks: CubePickSlot[]) => void;
  /** Release one bound pick (by the collection copy it holds) so a deck can pull
   *  that copy out of a physical cube — a conscious leave-gap. Nulls the pick's
   *  `allocatedCopyId` + `printingFinishKey`; the pick stays listed (the cube
   *  just loses one physical slot). No-op if no pick holds `copyId`. */
  releaseCubePick: (cubeId: string, copyId: string) => void;
  /** Low-level patch of a saved cube (used by remap-on-reimport to rebind picks). */
  updateSaved: (id: string, patch: Partial<SavedCube>) => void;
  /** Toggle a lock on `oracleId` — a locked card stays in the cube across
   *  "Rebuild the rest" and the refiner never swaps it out. Doesn't touch the
   *  picks; the cube itself only changes on the next (re)build. */
  toggleLock: (id: string, oracleId: string) => void;
  /** Ban `oracleId` from this cube: unlocks it (a banned card can't also be
   *  locked), drops its pick if it's currently in the cube, and — for a
   *  physical cube — releases the copy that pick held (a drop never needs a
   *  new binding, so unlike swap/add this needs no live collection/decks).
   *  Never re-added by a rebuild. */
  banCard: (id: string, oracleId: string) => void;
  /** Un-ban `oracleId`. Doesn't re-add the card — that's a fresh `addPick` or
   *  a rebuild. */
  unbanCard: (id: string, oracleId: string) => void;
  /** Replace the pick at `pickIndex` with `card`. For a physical cube, pass
   *  the live collection/decks (as `confirmPhysical` does) so the new card
   *  can claim a free copy; the old card's copy is released. */
  swapPick: (
    id: string,
    pickIndex: number,
    card: CubeCard,
    collection?: EnrichedCard[],
    decks?: Deck[]
  ) => void;
  /** Drop the pick at `pickIndex`. For a physical cube its copy is released. */
  removePick: (id: string, pickIndex: number) => void;
  /** Append `card` as a new pick (e.g. "add from your collection"). A no-op if
   *  the card is already in the cube or is banned. For a physical cube, pass
   *  the live collection/decks so it can claim a free copy. */
  addPick: (id: string, card: CubeCard, collection?: EnrichedCard[], decks?: Deck[]) => void;
  /** Replace the whole generated cube (e.g. "Rebuild the rest"). `locked` /
   *  `banned` / `settings` are untouched — only the generated result and, for
   *  a physical cube, its bindings change (existing bindings are preserved
   *  for every card that survives the rebuild; pass the live collection/decks
   *  so a genuinely new pick can claim a copy). */
  replaceCube: (
    id: string,
    cube: GeneratedCube,
    collection?: EnrichedCard[],
    decks?: Deck[]
  ) => void;
  /** Full wipe (logout) — drops the working result AND every saved cube. */
  reset: () => void;
}

/** Recompute byBucket/shortfall from an edited pick list; drop the objective
 *  score (it described the OLD picks and would otherwise keep lying about
 *  the new ones — an absent score is a handled, honest UI state). Everything
 *  else derived from the original build (gaps, targetByBucket) is left as-is:
 *  recomputing gaps needs the owned pool, which a saved cube doesn't carry. */
function withEditedPicks(cube: GeneratedCube, picks: Pick[]): GeneratedCube {
  const byBucket = {} as Record<ColorBucket, number>;
  for (const b of Object.keys(cube.byBucket) as ColorBucket[]) byBucket[b] = 0;
  for (const p of picks) byBucket[p.bucket] = (byBucket[p.bucket] ?? 0) + 1;
  return {
    ...cube,
    picks,
    byBucket,
    shortfall: Math.max(0, cube.size - picks.length),
    score: undefined,
  };
}

/** Reindex CubePickSlots for a released-only edit (ban / remove): every
 *  surviving card keeps its existing binding; a dropped card's slot is simply
 *  gone, which IS the release (nothing else references that copyId anymore). */
function reindexReleased(newPicks: Pick[], oldSlots: CubePickSlot[]): CubePickSlot[] {
  const oldByOracle = new Map(oldSlots.map((s) => [s.card.oracleId, s]));
  return newPicks.map((p, i) => {
    const old = oldByOracle.get(p.card.oracleId);
    return {
      slotId: `${i}`,
      card: p.card,
      allocatedCopyId: old?.allocatedCopyId ?? null,
      printingFinishKey: old?.printingFinishKey ?? null,
    };
  });
}

export const useCubeStore = create<CubeState>()(
  persist(
    (set) => ({
      size: 540,
      result: null,
      loadedId: null,
      saved: [],
      setResult: (size, result) => set({ size, result, loadedId: null }),
      clear: () => set({ result: null, loadedId: null }),
      saveCurrent: (name, isPhysical = false, picks = [], settings) =>
        set((s) => {
          if (!s.result) return s;
          const entry: SavedCube = {
            id: crypto.randomUUID(),
            name,
            size: s.result.size,
            cube: s.result,
            picks: isPhysical ? picks : [],
            isPhysical,
            savedAt: Date.now(),
            ...(settings ? { settings } : {}),
          };
          return { saved: [entry, ...s.saved], loadedId: entry.id };
        }),
      saveDirectly: (name, size, cube, isPhysical = false, picks = [], settings) => {
        const id = crypto.randomUUID();
        set((s) => ({
          saved: [
            {
              id,
              name,
              size,
              cube,
              picks: isPhysical ? picks : [],
              isPhysical,
              savedAt: Date.now(),
              ...(settings ? { settings } : {}),
            },
            ...s.saved,
          ],
        }));
        return id;
      },
      loadSaved: (id) =>
        set((s) => {
          const found = s.saved.find((c) => c.id === id);
          return found ? { result: found.cube, size: found.size, loadedId: id } : s;
        }),
      renameSaved: (id, name) =>
        set((s) => ({
          saved: s.saved.map((c) => (c.id === id ? { ...c, name } : c)),
        })),
      // Deleting the cube on screen takes the view with it — a result that
      // claims to be a cube that no longer exists would be the same confusion
      // loadedId exists to end.
      removeSaved: (id) =>
        set((s) => ({
          saved: s.saved.filter((c) => c.id !== id),
          ...(s.loadedId === id ? { result: null, loadedId: null } : {}),
        })),
      setPhysical: (id, isPhysical, picks) =>
        set((s) => ({
          saved: s.saved.map((c) =>
            c.id === id ? { ...c, isPhysical, picks: isPhysical ? picks : [] } : c
          ),
        })),
      releaseCubePick: (cubeId, copyId) =>
        set((s) => ({
          saved: s.saved.map((c) =>
            c.id === cubeId
              ? {
                  ...c,
                  picks: c.picks.map((p) =>
                    p.allocatedCopyId === copyId
                      ? { ...p, allocatedCopyId: null, printingFinishKey: null }
                      : p
                  ),
                }
              : c
          ),
        })),
      updateSaved: (id, patch) =>
        set((s) => ({
          saved: s.saved.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      toggleLock: (id, oracleId) =>
        set((s) => ({
          saved: s.saved.map((c) => {
            if (c.id !== id) return c;
            const locked = c.locked ?? [];
            return {
              ...c,
              locked: locked.includes(oracleId)
                ? locked.filter((x) => x !== oracleId)
                : [...locked, oracleId],
            };
          }),
        })),
      banCard: (id, oracleId) =>
        set((s) => ({
          saved: s.saved.map((c) => {
            if (c.id !== id) return c;
            const banned = (c.banned ?? []).includes(oracleId)
              ? (c.banned ?? [])
              : [...(c.banned ?? []), oracleId];
            const locked = (c.locked ?? []).filter((x) => x !== oracleId);
            if (!c.cube.picks.some((p) => p.card.oracleId === oracleId)) {
              return { ...c, banned, locked };
            }
            const newGenPicks = c.cube.picks.filter((p) => p.card.oracleId !== oracleId);
            return {
              ...c,
              banned,
              locked,
              cube: withEditedPicks(c.cube, newGenPicks),
              picks: c.isPhysical ? reindexReleased(newGenPicks, c.picks) : [],
            };
          }),
        })),
      unbanCard: (id, oracleId) =>
        set((s) => ({
          saved: s.saved.map((c) =>
            c.id === id ? { ...c, banned: (c.banned ?? []).filter((x) => x !== oracleId) } : c
          ),
        })),
      swapPick: (id, pickIndex, card, collection = [], decks = []) =>
        set((s) => ({
          saved: s.saved.map((c) => {
            if (c.id !== id || pickIndex < 0 || pickIndex >= c.cube.picks.length) return c;
            // Singleton: refuse a swap that would duplicate a card already elsewhere in the cube.
            if (c.cube.picks.some((p, i) => i !== pickIndex && p.card.oracleId === card.oracleId))
              return c;
            const newGenPicks = c.cube.picks.slice();
            newGenPicks[pickIndex] = { card, bucket: bucketOf(card), reason: 'Swapped in' };
            const others = s.saved.filter((oc) => oc.isPhysical && oc.id !== id);
            return {
              ...c,
              cube: withEditedPicks(c.cube, newGenPicks),
              picks: c.isPhysical
                ? rebindCubePicks(newGenPicks, c.picks, collection, decks, others)
                : [],
            };
          }),
        })),
      removePick: (id, pickIndex) =>
        set((s) => ({
          saved: s.saved.map((c) => {
            if (c.id !== id || pickIndex < 0 || pickIndex >= c.cube.picks.length) return c;
            const newGenPicks = c.cube.picks.filter((_, i) => i !== pickIndex);
            return {
              ...c,
              cube: withEditedPicks(c.cube, newGenPicks),
              picks: c.isPhysical ? reindexReleased(newGenPicks, c.picks) : [],
            };
          }),
        })),
      addPick: (id, card, collection = [], decks = []) =>
        set((s) => ({
          saved: s.saved.map((c) => {
            if (c.id !== id) return c;
            if ((c.banned ?? []).includes(card.oracleId)) return c;
            if (c.cube.picks.some((p) => p.card.oracleId === card.oracleId)) return c;
            const newGenPicks = [
              ...c.cube.picks,
              { card, bucket: bucketOf(card), reason: 'Added from your collection' },
            ];
            const others = s.saved.filter((oc) => oc.isPhysical && oc.id !== id);
            return {
              ...c,
              cube: withEditedPicks(c.cube, newGenPicks),
              picks: c.isPhysical
                ? rebindCubePicks(newGenPicks, c.picks, collection, decks, others)
                : [],
            };
          }),
        })),
      replaceCube: (id, cube, collection = [], decks = []) =>
        set((s) => ({
          saved: s.saved.map((c) => {
            if (c.id !== id) return c;
            const others = s.saved.filter((oc) => oc.isPhysical && oc.id !== id);
            return {
              ...c,
              cube,
              size: cube.size,
              picks: c.isPhysical
                ? rebindCubePicks(cube.picks, c.picks, collection, decks, others)
                : [],
            };
          }),
        })),
      reset: () => set({ result: null, loadedId: null, saved: [] }),
    }),
    {
      name: 'spellcontrol-cube',
      storage: createJSONStorage(() => safeLocalStorage),
      // ponytail: only working state in localStorage; saved cubes live in IDB/sync
      // now. Legacy localStorage cubes (pre-sync, #737) are migrated into IDB by
      // sync.ts's migrateLegacyCubes() before the first hydrate — NOT seeded via a
      // persist `merge`, which runs before the subscriber attaches and would be
      // clobbered by the authoritative IDB hydrate (losing them for guests, who
      // have no pull to restore them).
      partialize: (state) => ({ size: state.size, result: state.result, loadedId: state.loadedId }),
    }
  )
);

/**
 * Sync subscriber: every in-memory change to the saved cubes array flows through
 * the per-row sync layer, mirroring the pattern in store/decks.ts.
 */
useCubeStore.subscribe((state, prev) => {
  if (state.saved === prev.saved) return;
  if (isApplyingServer()) return;
  void import('../lib/sync')
    .then((s) => s.persistCubesState(state.saved))
    // Best-effort, but a swallowed rejection means an IDB write silently
    // stopped happening and the change never reached the sync queue —
    // invisible data loss. Log it, as collection.ts's persist helpers do.
    .catch((err) => logger.warn('[store] Failed to persist cubes:', err));
});
