import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GeneratedCube } from '../lib/cube/generate';
import type { CubeSize } from '../lib/cube/targets';

interface CubeState {
  size: CubeSize;
  result: GeneratedCube | null;
  setResult: (size: CubeSize, cube: GeneratedCube) => void;
  clear: () => void;
}

export const useCubeStore = create<CubeState>()(
  persist(
    (set) => ({
      size: 540,
      result: null,
      setResult: (size, result) => set({ size, result }),
      clear: () => set({ result: null }),
    }),
    {
      name: 'spellcontrol-cube',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ size: state.size, result: state.result }),
    }
  )
);
