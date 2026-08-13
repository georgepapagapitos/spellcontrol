// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { createGameState, makePlayer } from '@/lib/game-state';
import { DiceRoller } from './DiceRoller';

function onlineGame() {
  return createGameState({
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
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Priya', startingLife: 40 }),
    ],
  });
}

beforeEach(() => {
  usePlayStore.setState({ online: null, onlineSignal: null, sendSignal: vi.fn() });
  useAuth.setState({ user: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiceRoller — solo (unlinked)', () => {
  it('rolls locally for every die including ones with no broadcast equivalent, and never sends', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const sendSignal = vi.fn();
    usePlayStore.setState({ sendSignal });
    render(<DiceRoller onClose={() => {}} />);

    for (const label of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Coin flip' }));

    expect(sendSignal).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Who goes first?' })).toBeNull();
    // Last click was the coin flip — solo copy stays "Coin: Heads"/"Tails".
    expect(screen.getByRole('status').textContent).toMatch(/^Coin: (Heads|Tails)$/);
  });
});

describe('DiceRoller — online table linked', () => {
  beforeEach(() => {
    useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' } });
    usePlayStore.setState({ online: onlineGame(), onlineSignal: null, sendSignal: vi.fn() });
  });

  it.each([
    ['d6', { kind: 'roll', die: 'd6' }],
    ['d20', { kind: 'roll', die: 'd20' }],
    ['Coin flip', { kind: 'roll', die: 'coin' }],
    ['Who goes first?', { kind: 'roll', die: 'first' }],
  ] as const)(
    '%s sends %o via sendSignal, and shows "Rolling…" while pending',
    (label, payload) => {
      const sendSignal = vi.fn();
      usePlayStore.setState({ sendSignal });
      render(<DiceRoller onClose={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(sendSignal).toHaveBeenCalledWith(payload);
      expect(screen.getByRole('status').textContent).toBe('Rolling…');
    }
  );

  it('unsupported solo dice (d4/d8/d10/d12) still roll locally, never broadcast', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const sendSignal = vi.fn();
    usePlayStore.setState({ sendSignal });
    render(<DiceRoller onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'd4' }));
    expect(sendSignal).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('d4: 3');
  });

  it('resolves this seat’s own echoed roll into the result', async () => {
    render(<DiceRoller onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'd20' }));

    await act(async () => {
      usePlayStore.setState({
        onlineSignal: { seq: 1, signal: { kind: 'roll', seat: 0, ts: 1, die: 'd20', value: 17 } },
      });
    });
    expect(screen.getByRole('status').textContent).toBe('d20: 17');
  });

  it('resolves a "first" echo by naming the chosen seat', async () => {
    render(<DiceRoller onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Who goes first?' }));

    await act(async () => {
      usePlayStore.setState({
        onlineSignal: { seq: 1, signal: { kind: 'roll', seat: 0, ts: 1, die: 'first', value: 1 } },
      });
    });
    expect(screen.getByRole('status').textContent).toBe('Who goes first?: Priya');
  });

  it('ignores another seat’s roll — that is TableSignals’ job, not this sheet’s', async () => {
    render(<DiceRoller onClose={() => {}} />);
    await act(async () => {
      usePlayStore.setState({
        onlineSignal: { seq: 1, signal: { kind: 'roll', seat: 1, ts: 1, die: 'd6', value: 3 } },
      });
    });
    expect(screen.getByRole('status').textContent).toBe('Tap a die or the coin to roll.');
  });
});
