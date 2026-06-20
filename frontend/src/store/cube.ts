import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isApplyingServer } from '../lib/applying-server';
import type { GeneratedCube } from '../lib/cube/generate';
import type { CubeSize } from '../lib/cube/targets';

/** A cube the user named and kept. Synced via the `cube` entity kind. */
export interface SavedCube {
  id: string;
  name: string;
  size: CubeSize;
  cube: GeneratedCube;
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
  /** Snapshot the current working cube into the saved list under `name`. */
  saveCurrent: (name: string) => void;
  /** Insert a cube into the saved list directly (e.g. copying a shared cube),
   *  WITHOUT touching the working `result` — so a copy never clobbers an
   *  in-progress generate. Returns the new id. */
  saveDirectly: (name: string, size: CubeSize, cube: GeneratedCube) => string;
  /** Make a saved cube the current working result. */
  loadSaved: (id: string) => void;
  renameSaved: (id: string, name: string) => void;
  removeSaved: (id: string) => void;
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
      saveCurrent: (name) =>
        set((s) => {
          if (!s.result) return s;
          const entry: SavedCube = {
            id: crypto.randomUUID(),
            name,
            size: s.result.size,
            cube: s.result,
            savedAt: Date.now(),
          };
          return { saved: [entry, ...s.saved] };
        }),
      saveDirectly: (name, size, cube) => {
        const id = crypto.randomUUID();
        set((s) => ({ saved: [{ id, name, size, cube, savedAt: Date.now() }, ...s.saved] }));
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
