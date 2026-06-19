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
      // ponytail: only working state in localStorage; saved cubes live in IDB/sync now
      partialize: (state) => ({ size: state.size, result: state.result }),
      // Migration: if the OLD localStorage blob carried a `saved` array (feature
      // shipped 2026-06-18), seed it into the in-memory store so the sync subscriber
      // uploads those rows on first boot. Subsequent persists drop `saved` from
      // localStorage via the new partialize above — idempotent on re-hydrate.
      merge: (persisted, current) => {
        const p = persisted as Partial<CubeState & { saved?: SavedCube[] }>;
        const legacySaved = Array.isArray(p.saved) && p.saved.length > 0 ? p.saved : [];
        return {
          ...current,
          size: p.size ?? current.size,
          result: p.result ?? current.result,
          saved: legacySaved,
        };
      },
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
