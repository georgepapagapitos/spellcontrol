// @vitest-environment happy-dom
/**
 * The playtest page's init effect must be idempotent under React StrictMode:
 * the dev-mode mount → cleanup → mount cycle tears the session store down in
 * between, and an earlier "already handled this deck" ref latch then skipped
 * the second init — leaving "Shuffling…" on screen forever with no board.
 */
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

vi.mock('@/playtest/components/PlaytestBoard', () => ({
  PlaytestBoard: () => <div data-testid="board">board</div>,
}));
vi.mock('@/playtest/lib/deck-to-playtest', () => ({
  deckToPlaytestInit: () => ({ library: [] }),
}));
vi.mock('@/lib/playtest/session-snapshot', () => ({
  clearPlaytestSnapshot: () => {},
  fingerprintDeck: () => 'fp',
  isResumeWorthy: () => false,
  loadPlaytestSnapshot: () => null,
}));
vi.mock('@/styles/playtest.css', () => ({}));

interface FakePlaytestStore {
  state: { turn: number } | null;
  deckId: string | null;
  init: (deckId: string) => void;
  hydrate: (deckId: string) => void;
  teardown: () => void;
}
const fakePlaytestStore = create<FakePlaytestStore>((set) => ({
  state: null,
  deckId: null,
  init: (deckId) => set({ state: { turn: 1 }, deckId }),
  hydrate: (deckId) => set({ state: { turn: 3 }, deckId }),
  teardown: () => set({ state: null, deckId: null }),
}));
vi.mock('@/playtest/store', () => ({
  usePlaytestStore: (selector: (s: FakePlaytestStore) => unknown) => fakePlaytestStore(selector),
  flushPendingPlaytestSnapshot: () => {},
  tryRecordSession: () => null,
}));

const deck = {
  id: 'deck-1',
  name: 'Krenko',
  cards: [{ name: 'Mountain', quantity: 1 }],
};
vi.mock('@/store/decks', () => ({
  useDecksStore: (selector: (s: { decks: unknown[]; hydrated: boolean }) => unknown) =>
    selector({ decks: [deck], hydrated: true }),
}));

import { PlaytestPage } from './PlaytestPage';

function renderAt(path: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/decks/:id/playtest" element={<PlaytestPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>
  );
}

describe('PlaytestPage', () => {
  it('deals the board under StrictMode instead of sticking on "Shuffling…"', async () => {
    renderAt('/decks/deck-1/playtest');
    expect(await screen.findByTestId('board')).toBeTruthy();
    expect(screen.queryByText('Shuffling…')).toBeNull();
    expect(fakePlaytestStore.getState().deckId).toBe('deck-1');
  });
});
