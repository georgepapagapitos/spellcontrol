// @vitest-environment happy-dom
/**
 * The one rule every playtest↔table seam asks. It used to be derived
 * independently in four places (this hook's two callers, HoldBanner and
 * PlaytestPage), and three of them never learned about the deck — which is
 * how goldfishing an unrelated deck came to publish itself to a live table.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { applyAction, createGameState, makePlayer, type GameState } from '@/lib/game-state';
import { usePlaytestStore } from '../store';
import { useTableSeat } from './use-table-seat';

const MY_DECK = 'deck-mine';

function game(overrides: Partial<GameState> = {}): GameState {
  const g = createGameState({
    id: 'game1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'me-id',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      makePlayer({
        id: 'me-id',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 40,
        isHost: true,
        deckId: MY_DECK,
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Rival', startingLife: 40 }),
    ],
  });
  return { ...applyAction(g, { type: 'start' }), ...overrides };
}

function signIn(id: string | null) {
  if (id == null) useAuth.setState({ user: null, status: 'unknown' });
  else useAuth.setState({ user: { id, username: id, role: 'user' }, status: 'authed' });
}

beforeEach(() => {
  usePlayStore.getState().clearOnline();
  usePlayStore.setState({ online: null });
  usePlaytestStore.setState({ deckId: null });
  signIn(null);
});

describe('useTableSeat', () => {
  it('links when the game, the seat and the deck all agree', () => {
    signIn('me-id');
    usePlayStore.setState({ online: game() });
    usePlaytestStore.setState({ deckId: MY_DECK });
    const { result } = renderHook(() => useTableSeat());
    expect(result.current?.seat.seat).toBe(0);
    expect(result.current?.online.code).toBe('ABCD');
  });

  it('does not link with no online game at all', () => {
    signIn('me-id');
    usePlaytestStore.setState({ deckId: MY_DECK });
    expect(renderHook(() => useTableSeat()).result.current).toBeNull();
  });

  it('does not link when signed out, or signed in as someone with no seat', () => {
    usePlayStore.setState({ online: game() });
    usePlaytestStore.setState({ deckId: MY_DECK });
    expect(renderHook(() => useTableSeat()).result.current).toBeNull();

    signIn('a-stranger');
    expect(renderHook(() => useTableSeat()).result.current).toBeNull();
  });

  // The regression this hook exists for.
  it('does not link while goldfishing a deck that is not the seat deck', () => {
    signIn('me-id');
    usePlayStore.setState({ online: game() });
    usePlaytestStore.setState({ deckId: 'a-different-deck' });
    expect(renderHook(() => useTableSeat()).result.current).toBeNull();
  });

  it('does not link before the board knows what it is playing', () => {
    signIn('me-id');
    usePlayStore.setState({ online: game() });
    usePlaytestStore.setState({ deckId: null });
    expect(renderHook(() => useTableSeat()).result.current).toBeNull();
  });

  it('does not link when the seat has picked no deck, even playing one', () => {
    signIn('me-id');
    const g = game();
    usePlayStore.setState({
      online: { ...g, players: g.players.map((p) => (p.seat === 0 ? { ...p, deckId: null } : p)) },
    });
    usePlaytestStore.setState({ deckId: MY_DECK });
    expect(renderHook(() => useTableSeat()).result.current).toBeNull();
  });

  // A finished game stays linked on purpose: TableMoments runs the win
  // ceremony off the status transition and needs the link alive to do it.
  it('stays linked once the game is finished', () => {
    signIn('me-id');
    usePlayStore.setState({ online: applyAction(game(), { type: 'end', winnerSeat: 0 }) });
    usePlaytestStore.setState({ deckId: MY_DECK });
    expect(renderHook(() => useTableSeat()).result.current).not.toBeNull();
  });
});
