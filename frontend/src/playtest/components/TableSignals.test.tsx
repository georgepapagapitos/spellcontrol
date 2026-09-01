// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { createGameState, makePlayer } from '@/lib/game-state';
import type { GameSignal } from '@/lib/games-api';
import { TableSignals } from './TableSignals';

function onlineGame() {
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
        id: 'me',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 40,
        isHost: true,
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Maya', startingLife: 40 }),
      makePlayer({ id: 'p2', userId: 'u2', seat: 2, name: 'Priya', startingLife: 40 }),
    ],
  });
  return g;
}

function withSignal(seq: number, signal: GameSignal) {
  usePlayStore.setState({ onlineSignal: { seq, signal } });
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' } });
  usePlayStore.setState({ online: onlineGame(), onlineSignal: null, sendSignal: vi.fn() });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TableSignals', () => {
  it('renders nothing in solo playtest (no online game)', () => {
    usePlayStore.setState({ online: null });
    const { container } = render(<TableSignals />);
    expect(container.innerHTML).toBe('');
  });

  it('renders an incoming reaction with the sender name and auto-dismisses', async () => {
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, { kind: 'reaction', seat: 1, ts: 1, emote: '👏' });
    });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Maya reacted: Applause');

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    [
      { kind: 'roll', seat: 1, ts: 1, die: 'd6', value: 4 } satisfies GameSignal,
      'Maya rolled d6: 4',
    ],
    [
      { kind: 'roll', seat: 1, ts: 1, die: 'd20', value: 17 } satisfies GameSignal,
      'Maya rolled d20: 17',
    ],
    [{ kind: 'roll', seat: 1, ts: 1, die: 'coin', value: 0 } satisfies GameSignal, 'Coin: heads'],
    [{ kind: 'roll', seat: 1, ts: 1, die: 'coin', value: 1 } satisfies GameSignal, 'Coin: tails'],
    [
      { kind: 'roll', seat: 1, ts: 1, die: 'first', value: 2 } satisfies GameSignal,
      'Priya goes first!',
    ],
  ])('renders %o as %s and auto-dismisses after 4s', async (signal, expected) => {
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, signal);
    });
    expect(screen.getByRole('status').textContent).toBe(expected);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a repeated identical emote (seq bump) renders again', async () => {
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, { kind: 'reaction', seat: 1, ts: 1, emote: '🔥' });
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);

    await act(async () => {
      withSignal(2, { kind: 'reaction', seat: 1, ts: 2, emote: '🔥' });
    });
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('drops the oldest beyond 4 concurrent moments', async () => {
    render(<TableSignals />);
    for (let i = 1; i <= 5; i++) {
      await act(async () => {
        withSignal(i, { kind: 'reaction', seat: 1, ts: i, emote: '😂' });
      });
    }
    expect(screen.getAllByRole('status')).toHaveLength(4);
  });

  it('a point at my board addresses me in the second person', async () => {
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, { kind: 'point', seat: 1, ts: 1, targetSeat: 0 });
    });
    expect(screen.getByRole('status').textContent).toBe('Maya is pointing at your board');
  });

  it('a point at another seat reads in the third person, so the table can follow', async () => {
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, { kind: 'point', seat: 1, ts: 1, targetSeat: 2 });
    });
    expect(screen.getByRole('status').textContent).toBe("Maya is pointing at Priya's board");
  });

  it('names the pointed card when it is resolvable on the target seat published board', async () => {
    usePlayStore.setState({
      onlineBoards: {
        0: {
          seat: 0,
          turn: 1,
          life: 40,
          commanderTax: {},
          monarch: false,
          initiative: false,
          citysBlessing: false,
          battlefield: [
            {
              card: { id: 'c1', name: 'Sol Ring' },
              tapped: false,
              counters: {},
              stickers: [],
              x: 0,
              y: 0,
              faceDown: false,
            },
          ],
          graveyard: [],
          exile: [],
          command: [],
          handCount: 7,
          libraryCount: 90,
        },
      },
    });
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, { kind: 'point', seat: 1, ts: 1, targetSeat: 0, cardId: 'c1' });
    });
    expect(screen.getByRole('status').textContent).toBe('Maya is pointing at your Sol Ring');
  });

  it('degrades to the board when the pointed card is not on it', async () => {
    // Routine, not exceptional: the card may have changed zones between the
    // point and its delivery, and the server never validates the id.
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, { kind: 'point', seat: 1, ts: 1, targetSeat: 0, cardId: 'gone' });
    });
    expect(screen.getByRole('status').textContent).toBe('Maya is pointing at your board');
  });

  it('a chat message is not flashed as a moment — it lands in the ticker feed instead', async () => {
    render(<TableSignals />);
    await act(async () => {
      withSignal(1, { kind: 'chat', seat: 1, ts: 1, text: 'hold' });
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
