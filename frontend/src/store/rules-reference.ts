import { create } from 'zustand';

/** Where the sheet opens: a tab, its search, and optionally one keyword row already expanded. */
export interface RulesReferenceTarget {
  tab: RulesReferenceTab;
  query: string;
  expand?: string;
}

/**
 * Global open/close state for the Rules Reference sheet — the quick-look
 * overlay of the reference (the linkable version is the /rules page). The
 * sheet is rendered once in Layout; every entry point (Play's hero, the
 * in-game menu) just calls `open()` so there's a single instance and no prop
 * drilling. A keyword in card text calls `openAt()` to land on its own rule.
 */
interface RulesReferenceState {
  isOpen: boolean;
  target: RulesReferenceTarget | null;
  /** Open on the keyword list. Takes no argument, so it can be an `onClick` as is. */
  open(): void;
  openAt(target: RulesReferenceTarget): void;
  close(): void;
}

export const useRulesReferenceStore = create<RulesReferenceState>((set) => ({
  isOpen: false,
  target: null,
  open: () => set({ isOpen: true, target: null }),
  openAt: (target) => set({ isOpen: true, target }),
  close: () => set({ isOpen: false, target: null }),
}));

/** The three sections of the Comprehensive Rules reference. */
export type RulesReferenceTab = 'keywords' | 'glossary' | 'rules';
