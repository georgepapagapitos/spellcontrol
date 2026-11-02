// @vitest-environment happy-dom
/**
 * Seating a deck publishes the pod-sheet facts: the seat first, then the same
 * facts again with the win turn once the clock lands, and only while that deck
 * still holds the seat.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createGameState, makePlayer } from '@spellcontrol/game-core';
import type { GameAction, GameState } from '@spellcontrol/game-core';
import type { PickedDeck } from './DeckPickerDialog';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/play/games-api', () => ({
  getDiscordStatus: vi.fn(async () => ({ enabled: false })),
  openDiscordTable: vi.fn(async () => ''),
}));

const pick = vi.hoisted(() => ({ current: null as PickedDeck | null }));
vi.mock('./SetupControls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./SetupControls')>()),
  DeckPicker: ({ onChange }: { onChange: (p: PickedDeck | null) => void }) => (
    <button type="button" onClick={() => onChange(pick.current)}>
      Seat the deck
    </button>
  ),
}));

import { OnlineLobby } from './OnlineLobby';

function table(deckId: string | null = null): GameState {
  return createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      {
        ...makePlayer({
          id: 'u0',
          userId: 'u0',
          seat: 0,
          name: 'P0',
          startingLife: 40,
          isHost: true,
        }),
        deckId,
      },
    ],
    ts: 1000,
  });
}

function deckPick(over: Partial<PickedDeck> = {}): PickedDeck {
  return {
    id: 'd1',
    name: 'Atraxa',
    commander: 'Atraxa',
    partner: null,
    colorIdentity: ['W'],
    bracket: 4,
    version: null,
    facts: { gameChangers: 3, combos: 1, winTurn: null },
    ...over,
  };
}

function mount(game: GameState, dispatch: (a: GameAction | GameAction[]) => void) {
  return render(
    <MemoryRouter>
      <OnlineLobby
        game={game}
        decks={[]}
        userId="u0"
        mySeat={game.players[0]}
        dispatch={dispatch}
        onLeave={() => {}}
      />
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('seating a deck publishes the pod-sheet facts', () => {
  it('sends the facts with the seat, then the win turn when the clock lands', async () => {
    const dispatch = vi.fn();
    pick.current = deckPick({ resolveWinTurn: async () => 6 });
    // The seat already holds the deck by the time the clock lands.
    mount(table('d1'), dispatch);
    fireEvent.click(screen.getByRole('button', { name: 'Seat the deck' }));

    const first = dispatch.mock.calls[0][0] as Extract<GameAction, { type: 'update-player' }>;
    expect(first.patch.deckFacts).toEqual({ gameChangers: 3, combos: 1, winTurn: null });
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    const second = dispatch.mock.calls[1][0] as Extract<GameAction, { type: 'update-player' }>;
    expect(second.patch.deckFacts).toEqual({ gameChangers: 3, combos: 1, winTurn: 6 });
  });

  it('drops a win turn that lands after the seat moved to another deck', async () => {
    const dispatch = vi.fn();
    pick.current = deckPick({ resolveWinTurn: async () => 6 });
    mount(table('some-other-deck'), dispatch);
    fireEvent.click(screen.getByRole('button', { name: 'Seat the deck' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('sends nothing more for a deck with no facts (a friend’s or starter)', async () => {
    const dispatch = vi.fn();
    pick.current = deckPick({ facts: null, resolveWinTurn: async () => 6 });
    mount(table('d1'), dispatch);
    fireEvent.click(screen.getByRole('button', { name: 'Seat the deck' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const only = dispatch.mock.calls[0][0] as Extract<GameAction, { type: 'update-player' }>;
    expect(only.patch.deckFacts).toBeNull();
  });
});
