// @vitest-environment happy-dom
/**
 * The playtest page's init effect must be idempotent under React StrictMode:
 * the dev-mode mount → cleanup → mount cycle tears the session store down in
 * between, and an earlier "already handled this deck" ref latch then skipped
 * the second init — leaving "Shuffling…" on screen forever with no board.
 */
import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

// Online seat: `online` is null for a solo playtest; a seated game turns
// the page's back target into the table.
const fakePlay = create<{ online: { code: string; players: { userId: string }[] } | null }>(() => ({
  online: null,
}));
vi.mock('@/store/play', () => ({
  usePlayStore: (selector: (s: ReturnType<typeof fakePlay.getState>) => unknown) =>
    fakePlay(selector),
}));
vi.mock('@/store/auth', () => ({
  useAuth: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
// The first-pull window: a cold device's store is empty while the account's
// rows are still on their way. Flipped per test.
const firstPull = { awaiting: false };
vi.mock('@/lib/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => firstPull.awaiting,
}));

import { PlaytestPage } from './PlaytestPage';

function renderAt(path: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/decks/:id/playtest" element={<PlaytestPage />} />
          <Route path="/decks/:id" element={<div>deck page</div>} />
          <Route path="/play" element={<div>play page</div>} />
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

  it('backs out to the deck when playtesting solo', async () => {
    fakePlay.setState({ online: null });
    renderAt('/decks/deck-1/playtest');
    fireEvent.click(await screen.findByRole('button', { name: '← Krenko' }));
    expect(await screen.findByText('deck page')).toBeTruthy();
  });

  it('backs out to the table when this device holds a seat in an online game', async () => {
    fakePlay.setState({ online: { code: 'JRA4', players: [{ userId: 'me' }] } });
    renderAt('/decks/deck-1/playtest');
    fireEvent.click(await screen.findByRole('button', { name: '← Game JRA4' }));
    expect(await screen.findByText('play page')).toBeTruthy();
  });

  it('ignores an online game this device is not seated in', async () => {
    fakePlay.setState({ online: { code: 'JRA4', players: [{ userId: 'someone-else' }] } });
    renderAt('/decks/deck-1/playtest');
    expect(await screen.findByRole('button', { name: '← Krenko' })).toBeTruthy();
  });

  it('keeps loading, not "Deck not found", while the first pull is in flight (same class as #1937)', async () => {
    // Measured in playtest batch 7: ~1s of "It may have been deleted" with a
    // live "Back to decks" door on every cold deep link.
    firstPull.awaiting = true;
    try {
      renderAt('/decks/not-here-yet/playtest');
      expect(screen.getByRole('status')).toBeTruthy();
      expect(screen.queryByText('Deck not found.')).toBeNull();
    } finally {
      firstPull.awaiting = false;
    }
  });

  it('still reaches "Deck not found" once sync has settled', () => {
    renderAt('/decks/not-here-at-all/playtest');
    expect(screen.getByText('Deck not found.')).toBeTruthy();
  });

  it('names the deck in the tab title', async () => {
    renderAt('/decks/deck-1/playtest');
    await screen.findByTestId('board');
    expect(document.title).toBe('Playtest · Krenko · SpellControl');
  });
});
