import { create } from 'zustand';
import {
  applyAction,
  createPlaytestState,
  type PlaytestAction,
  type PlaytestInit,
  type PlaytestState,
} from '@/lib/playtest';

interface PlaytestStore {
  state: PlaytestState | null;
  deckId: string | null;
  init(deckId: string, init: PlaytestInit): void;
  dispatch(action: PlaytestAction): void;
  teardown(): void;
}

export const usePlaytestStore = create<PlaytestStore>((set, get) => ({
  state: null,
  deckId: null,
  init(deckId, init) {
    set({ deckId, state: createPlaytestState(init) });
  },
  dispatch(action) {
    const current = get().state;
    if (!current) return;
    set({ state: applyAction(current, action) });
  },
  teardown() {
    set({ state: null, deckId: null });
  },
}));
