// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createPlaytestState } from '@/lib/playtest';
import { usePlaytestStore } from '../store';
import type { OnlineTable } from '../hooks/use-online-table';
import { PlaytestBoard } from './PlaytestBoard';

// Same seams PlaytestBoard.test.tsx mocks — see its own comments for why
// each one is unavoidable for any render of the real board.
let onlineTable: OnlineTable | null = null;
vi.mock('../hooks/use-online-table', () => ({
  useOnlineTable: () => onlineTable,
}));
vi.mock('@/components/deck/use-deck-tokens', () => ({
  useDeckTokens: () => [],
}));
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  searchTokens: async () => [],
  resolveTokenOption: async () => null,
}));
vi.mock('@/lib/card-thumbs', () => ({
  useCardThumb: () => undefined,
  cachedCardThumb: () => undefined,
}));

const dispatch = vi.fn();

function seededState() {
  return createPlaytestState({
    library: Array.from({ length: 10 }, (_, i) => ({ id: `card-${i}`, name: `Card ${i}` })),
    openingHandSize: 7,
  });
}

/** A hand card moved to the battlefield: one fewer in hand, one more on the
 *  felt. The board reads this transition off the `state` prop alone (see
 *  PlaytestBoard.tsx's `dragHintCounts` effect) — it never inspects HOW the
 *  card got there, so a fixture is enough; no real drag or menu action
 *  needs simulating. */
function afterAPlay(state: ReturnType<typeof seededState>) {
  const [played, ...restHand] = state.zones.hand;
  return {
    ...state,
    zones: { ...state.zones, hand: restHand },
    battlefield: [
      ...state.battlefield,
      { card: played, tapped: false, counters: {}, stickers: [], x: 0.4, y: 0.4, faceDown: false },
    ],
  };
}

function stubPointer(coarse: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: /pointer:\s*coarse/.test(query) ? coarse : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeEach(() => {
  dispatch.mockReset();
  onlineTable = null;
  localStorage.clear();
  usePlaytestStore.setState({ phase: 'playing', dispatch });
  stubPointer(false);
});

describe('PlaytestBoard drag-to-play hint (E484)', () => {
  it('shows once on a fresh profile with a hand after keep', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Play a card')).toBeTruthy();
  });

  it('is hidden during the opening-hand / mulligan phase', () => {
    usePlaytestStore.setState({ phase: 'opening', dispatch });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Play a card')).toBeNull();
  });

  it('dismiss hides it and persists across a remount', () => {
    const { unmount } = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Play a card')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss hint' }));
    expect(screen.queryByText('Play a card')).toBeNull();
    expect(localStorage.getItem('sc-hint-playtest-drag-v1')).toBe('1');

    unmount();
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Play a card')).toBeNull();
  });

  it('hides after the first card moves from hand to the battlefield', () => {
    const state = seededState();
    const { rerender } = render(
      <MemoryRouter>
        <PlaytestBoard state={state} />
      </MemoryRouter>
    );
    expect(screen.getByText('Play a card')).toBeTruthy();

    rerender(
      <MemoryRouter>
        <PlaytestBoard state={afterAPlay(state)} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Play a card')).toBeNull();
    expect(localStorage.getItem('sc-hint-playtest-drag-v1')).toBe('1');
  });

  it('does not fire on a hand-only change that never reaches the battlefield (a discard)', () => {
    const state = seededState();
    const { rerender } = render(
      <MemoryRouter>
        <PlaytestBoard state={state} />
      </MemoryRouter>
    );
    expect(screen.getByText('Play a card')).toBeTruthy();

    const [, ...restHand] = state.zones.hand;
    const discarded = {
      ...state,
      zones: {
        ...state.zones,
        hand: restHand,
        graveyard: [...state.zones.graveyard, state.zones.hand[0]],
      },
    };
    rerender(
      <MemoryRouter>
        <PlaytestBoard state={discarded} />
      </MemoryRouter>
    );
    expect(screen.getByText('Play a card')).toBeTruthy();
  });

  it('wording names the touch gesture on a coarse pointer', () => {
    stubPointer(true);
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText(/hold it for the menu/)).toBeTruthy();
  });

  it('wording names the mouse gesture on a fine pointer', () => {
    stubPointer(false);
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText(/right-click it for the menu/)).toBeTruthy();
  });
});
