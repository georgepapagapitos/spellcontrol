import { create } from 'zustand';

/**
 * Global open/close state for the Rules Reference sheet. The sheet is rendered
 * once in Layout; every entry point (header, mobile bar, native FAB, the play
 * screen) just calls `open()` so there's a single instance and no prop drilling.
 */
interface RulesReferenceState {
  isOpen: boolean;
  open(): void;
  close(): void;
}

export const useRulesReferenceStore = create<RulesReferenceState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
