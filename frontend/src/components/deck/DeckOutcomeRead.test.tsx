// @vitest-environment happy-dom
/**
 * DeckOutcomeRead: the forecast beside the games played with the same list.
 * Every state the panel has: no games with this list, too few to compare,
 * enough to compare (against the bracket's turn), no forecast, and the forecast
 * still running.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameRecord } from '@spellcontrol/game-core';
import { deckVersionOf } from '@/lib/deck/deck-version';

let clockState: { clock: unknown; pending: boolean } = { clock: null, pending: false };
vi.mock('@/lib/mana-sim/use-assembly-clock', () => ({ useAssemblyClock: () => clockState }));

import { DeckOutcomeRead } from './DeckOutcomeRead';

const deck = {
  id: 'd1',
  commander: { oracle_id: 'o-c', name: 'C' },
  partnerCommander: null,
  cards: [{ card: { oracle_id: 'o-a', name: 'A' } }],
  bracketOverride: 3,
} as never;
const VERSION = deckVersionOf(deck);
const CLOCK = { runs: 1000, typicalTurn: 6, p90Turn: 11, assembledBy: [], byTurn: [] };
const PATH = { assembly: [{ names: ['A'], need: 1 }], tutors: [] } as never;

function game(over: { turns?: number; version?: string | null; won?: boolean } = {}): GameRecord {
  return {
    id: Math.random().toString(36),
    code: 'C',
    format: 'commander',
    startingLife: 40,
    players: [0, 1].map((seat) => ({
      seat,
      userId: null,
      name: `P${seat}`,
      deckId: seat === 0 ? 'd1' : 'x',
      deckName: null,
      commander: null,
      ...(seat === 0 && over.version !== null ? { deckVersion: over.version ?? VERSION } : {}),
      finalLife: 1,
      eliminated: false,
    })),
    winnerSeat: over.won ? 0 : 1,
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    mode: 'local',
    summary: { turns: over.turns ?? 16, durationMs: 1 } as GameRecord['summary'],
  };
}

function renderRead(history: GameRecord[], speedPath: unknown = PATH) {
  return render(
    <DeckOutcomeRead
      deck={deck}
      history={history}
      userId={null}
      clockLibrary={[{ name: 'A' }] as never}
      speedPath={speedPath as never}
    />
  );
}

beforeEach(() => {
  clockState = { clock: CLOCK, pending: false };
});

describe('DeckOutcomeRead', () => {
  it('says so when no game used this list, and counts the ones that predate versions', () => {
    renderRead([game({ version: null }), game({ version: '90:cccccccc' })]);
    expect(screen.getAllByText('No tracked games with this list yet.')).toHaveLength(2);
    expect(screen.getByText(/1 game used an earlier list and is not counted here/)).toBeTruthy();
    expect(screen.getByText(/1 game was tracked before lists were recorded/)).toBeTruthy();
  });

  it('says plainly that it is too few to compare, with the count and the minimum', () => {
    renderRead([game({ won: true }), game(), game()]);
    expect(screen.getByText(/1 win with turns tracked so far\. 5 are needed/)).toBeTruthy();
    expect(screen.getByText(/3 games with turns tracked so far\. 5 are needed/)).toBeTruthy();
    // The forecast still shows: it does not depend on the games.
    expect(screen.getByText(/Win path in place by turn 6 in half of games/)).toBeTruthy();
  });

  it('sets observed turns and the bracket turn beside the forecast once there are enough games', () => {
    const wins = [10, 12, 14, 16, 20].map((t) => game({ turns: t, won: true }));
    renderRead([...wins, game({ turns: 30 })]);
    const won = screen.getByText('Games won').parentElement as HTMLElement;
    expect(
      within(won).getByText(/Won by turn 7 in half of them, turns 5 to 10 in all/)
    ).toBeTruthy();
    expect(within(won).getByText('from 5 wins')).toBeTruthy();
    const len = screen.getByText('Game length').parentElement as HTMLElement;
    expect(within(len).getByText('from 6 games')).toBeTruthy();
    // Bracket 3 expects turn 6 or later, and the median game went past it.
    expect(
      within(len).getByText(
        /Bracket 3 expects games to last to turn 6 or later; half of these lasted to turn 7\./
      )
    ).toBeTruthy();
    expect(within(len).getByText(/half of these lasted to turn 7/)).toBeTruthy();
  });

  it('says there is no forecast when the deck has no win path to time', () => {
    clockState = { clock: null, pending: false };
    renderRead([], null);
    expect(screen.getByText(/No win path to time for this deck/)).toBeTruthy();
  });

  it('marks the forecast busy while it runs', () => {
    clockState = { clock: null, pending: true };
    const { container } = renderRead([]);
    expect(screen.getByText('Running the forecast')).toBeTruthy();
    expect(container.querySelector('dl')?.getAttribute('aria-busy')).toBe('true');
  });
});
