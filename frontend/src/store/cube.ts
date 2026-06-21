import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isApplyingServer } from '../lib/applying-server';
import type { CubeCard, GeneratedCube } from '../lib/cube/generate';
import type { CubeSize } from '../lib/cube/targets';

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
}

interface CubeState {
  /** Picker selection / last-generated size. */
  size: CubeSize;
  /** The current working cube (unsaved until the user names it). */
  result: GeneratedCube | null;
  /** Named cubes the user kept, newest first. Synced via IDB; NOT in localStorage. */
  saved: SavedCube[];
  setResult: (size: CubeSize, cube: GeneratedCube) => void;
  /** Clear only the working result (used before a regenerate) — keeps saved cubes. */
  clear: () => void;
  /** Snapshot the current working cube into the saved list under `name`. When
   *  `isPhysical`, pass the bound `picks` (built by `bindCubeCopies` at the call
   *  site, where the live collection/decks are in scope). */
  saveCurrent: (name: string, isPhysical?: boolean, picks?: CubePickSlot[]) => void;
  /** Insert a cube into the saved list directly (e.g. copying a shared cube),
   *  WITHOUT touching the working `result` — so a copy never clobbers an
   *  in-progress generate. Returns the new id. */
  saveDirectly: (
    name: string,
    size: CubeSize,
    cube: GeneratedCube,
    isPhysical?: boolean,
    picks?: CubePickSlot[]
  ) => string;
  /** Make a saved cube the current working result. */
  loadSaved: (id: string) => void;
  renameSaved: (id: string, name: string) => void;
  removeSaved: (id: string) => void;
  /** Toggle a saved cube's physical flag. Pass the freshly-bound `picks` when
   *  turning ON (claims copies); pass `[]` when turning OFF (releases them). */
  setPhysical: (id: string, isPhysical: boolean, picks: CubePickSlot[]) => void;
  /** Low-level patch of a saved cube (used by remap-on-reimport to rebind picks). */
  updateSaved: (id: string, patch: Partial<SavedCube>) => void;
  /** Full wipe (logout) — drops the working result AND every saved cube. */
  reset: () => void;
}

export const useCubeStore = create<CubeState>()(
  persist(
    (set) => ({
      size: 540,
      result: null,
      saved: [],
      setResult: (size, result) => set({ size, result }),
      clear: () => set({ result: null }),
      saveCurrent: (name, isPhysical = false, picks = []) =>
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
          };
          return { saved: [entry, ...s.saved] };
        }),
      saveDirectly: (name, size, cube, isPhysical = false, picks = []) => {
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
            },
            ...s.saved,
          ],
        }));
        return id;
      },
      loadSaved: (id) =>
        set((s) => {
          const found = s.saved.find((c) => c.id === id);
          return found ? { result: found.cube, size: found.size } : s;
        }),
      renameSaved: (id, name) =>
        set((s) => ({
          saved: s.saved.map((c) => (c.id === id ? { ...c, name } : c)),
        })),
      removeSaved: (id) => set((s) => ({ saved: s.saved.filter((c) => c.id !== id) })),
      setPhysical: (id, isPhysical, picks) =>
        set((s) => ({
          saved: s.saved.map((c) =>
            c.id === id ? { ...c, isPhysical, picks: isPhysical ? picks : [] } : c
          ),
        })),
      updateSaved: (id, patch) =>
        set((s) => ({
          saved: s.saved.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      reset: () => set({ result: null, saved: [] }),
    }),
    {
      name: 'spellcontrol-cube',
      storage: createJSONStorage(() => localStorage),
      // ponytail: only working state in localStorage; saved cubes live in IDB/sync
      // now. Legacy localStorage cubes (pre-sync, #737) are migrated into IDB by
      // sync.ts's migrateLegacyCubes() before the first hydrate — NOT seeded via a
      // persist `merge`, which runs before the subscriber attaches and would be
      // clobbered by the authoritative IDB hydrate (losing them for guests, who
      // have no pull to restore them).
      partialize: (state) => ({ size: state.size, result: state.result }),
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
  void import('../lib/sync').then((s) => s.persistCubesState(state.saved)).catch(() => {});
});
