// @vitest-environment happy-dom
/**
 * The board hub's ring (board T155, Direction A): six keys and a dock, the
 * sheets they open, and the two table moments the ring acts on directly
 * (board-level Restart and High Roll). Mock harness mirrors
 * GameBoard.gestures.test.tsx.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function seat(n: number, name: string, over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({ id: `p${n}`, userId: null, seat: n, name, startingLife: 40 }),
    ...over,
  };
}

function makeTestState(players: GamePlayer[], over: Partial<GameState> = {}): GameState {
  const state = createGameState({
    id: 'game-hub',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
  return { ...state, status: 'active', startedAt: Date.now() - 60_000, ...over };
}

vi.mock('../../store/play', () => {
  const getState = vi.fn(() => ({ stopPolling: vi.fn(), startPolling: vi.fn() }));
  const usePlayStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      hapticsEnabled: false,
      setHaptics: vi.fn(),
      preferredLayouts: {},
      setPreferredLayout: vi.fn(),
      gameTimerEnabled: true,
      turnTrackerEnabled: true,
      setGameTimerEnabled: vi.fn(),
      setTurnTrackerEnabled: vi.fn(),
      lowLifeWarningEnabled: true,
      setLowLifeWarningEnabled: vi.fn(),
      underlineSixNine: false,
      setUnderlineSixNine: vi.fn(),
      minimalistMode: false,
      setMinimalistMode: vi.fn(),
    });
  usePlayStore.getState = getState;
  return { usePlayStore };
});

vi.mock('../../lib/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn(), bump: vi.fn() },
}));

vi.mock('../../lib/use-wake-lock', () => ({ useWakeLock: vi.fn() }));

vi.mock('../../lib/undo-stack', () => ({
  capture: vi.fn(),
  clearUndo: vi.fn(),
  peekLabel: vi.fn(() => null),
  popRestore: vi.fn(() => []),
  runSuppressed: vi.fn((fn: () => void) => fn()),
}));

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

vi.mock('../../lib/game-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/game-tools')>();
  return { ...actual, highRoll: vi.fn() };
});

import { highRoll } from '../../lib/game-tools';
import { useRulesReferenceStore } from '../../store/rules-reference';
import { GameBoard } from './GameBoard';

const pair = () => [seat(0, 'Alice'), seat(1, 'Bob')];

beforeEach(() => {
  vi.mocked(highRoll).mockReset();
  localStorage.setItem('sc-board-gestures-seen', '1');
});

afterEach(() => {
  vi.useRealTimers();
});

function openRing() {
  fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
}

const labels = (sel: string) =>
  [...document.querySelectorAll(sel)].map((el) => el.textContent?.trim());
const keys = () => labels('.board-hub-key');
const dockItems = () => labels('.board-hub-dock-item');

const handlers = () => ({
  onEnd: vi.fn(),
  onMinimize: vi.fn(),
  onLeave: vi.fn(),
  onRematch: vi.fn(),
});

describe('the hub ring', () => {
  it('places six keys clockwise from High roll, Restart last, and the dock after them', () => {
    render(
      <GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll {...handlers()} />
    );
    openRing();
    expect(keys()).toEqual(['High roll', 'Dice', 'Players', 'Settings', 'Help', 'Restart']);
    expect(dockItems()).toEqual(['History', 'Rules', 'Leave']);
    // One menu, one order: keys, then the dock.
    const ring = screen.getByRole('menu', { name: 'Board menu' });
    expect(
      within(ring)
        .getAllByRole('menuitem')
        .map((el) => el.textContent?.trim())
    ).toEqual([
      'High roll',
      'Dice',
      'Players',
      'Settings',
      'Help',
      'Restart',
      'History',
      'Rules',
      'Leave',
    ]);
  });

  it('lands focus on High roll, never on a destructive key', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }), { detail: 0 });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'High roll' }));
  });

  it('drops the host-only keys for a viewer who cannot control the table', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll={false} />);
    openRing();
    expect(keys()).toEqual(['High roll', 'Dice', 'Settings', 'Help']);
  });

  it('has no Leave in the dock when the board has no way off it', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    expect(dockItems()).toEqual(['History', 'Rules']);
  });

  it('turns the hub into a close (✕) button while open', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Game menu' })).toBeTruthy();
  });

  it('closes on an outside tap', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.pointerDown(document.querySelector('.board-hub-backdrop')!);
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
  });

  it('hides the undo satellite while open, and brings it back on close', async () => {
    const undoStack = await import('../../lib/undo-stack');
    vi.mocked(undoStack.peekLabel).mockReturnValue('Alice −1');
    try {
      render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
      expect(screen.getByRole('button', { name: 'Undo Alice −1' })).toBeTruthy();
      openRing();
      expect(screen.queryByRole('button', { name: 'Undo Alice −1' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
      expect(screen.getByRole('button', { name: 'Undo Alice −1' })).toBeTruthy();
    } finally {
      vi.mocked(undoStack.peekLabel).mockReturnValue(null);
    }
  });

  // F12a: the hub button reads the triggering click's `detail` (0 for a
  // keyboard-synthesized click, >=1 for a real pointer click) and passes it
  // through as BoardHubMenu's `openedByKeyboard`.
  it("suppresses the first key's ring on a pointer-triggered open, not on a keyboard one", () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }), { detail: 1 });
    expect(
      document.querySelector('.board-hub-ring')?.classList.contains('board-hub-ring-pointer-opened')
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }), { detail: 0 });
    expect(
      document.querySelector('.board-hub-ring')?.classList.contains('board-hub-ring-pointer-opened')
    ).toBe(false);
  });
});

describe('each key and dock item opens one sheet', () => {
  for (const [item, dialog] of [
    ['Dice', 'Dice'],
    ['Players', 'Players'],
    ['Settings', 'Settings'],
    ['Help', 'How the board works'],
    ['History', 'History'],
    ['Leave', 'Leave the board'],
  ] as const) {
    it(`${item} opens the ${dialog} sheet, and closing it hands focus back to the hub`, () => {
      render(
        <GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll {...handlers()} />
      );
      const hub = screen.getByRole('button', { name: 'Game menu' });
      openRing();
      fireEvent.click(screen.getByRole('menuitem', { name: item }));
      // The ring closes as the sheet opens: one tap in, one tap out.
      expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
      const sheet = screen.getByRole('dialog', { name: dialog });
      // Focus lands inside the sheet, on something that does something.
      expect(sheet.contains(document.activeElement)).toBe(true);
      expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Close');

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: dialog })).toBeNull();
      expect(document.activeElement).toBe(hub);
    });
  }

  it('Rules opens the rules reference', () => {
    useRulesReferenceStore.getState().close();
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rules' }));
    expect(useRulesReferenceStore.getState().isOpen).toBe(true);
    useRulesReferenceStore.getState().close();
  });

  it('the Players lock note carries Restart, which asks first', () => {
    const dispatch = vi.fn();
    const game = makeTestState([seat(0, 'Alice', { life: 31 }), seat(1, 'Bob')]);
    render(<GameBoard game={game} dispatch={dispatch} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Players' }));
    expect(screen.getByText(/Seats lock once the game starts/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart…' }));
    expect(screen.getByText('Restart the game?')).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('a finished board', () => {
  const finished = () => makeTestState(pair(), { status: 'finished', winnerSeat: 0 });

  function openFinishedRing() {
    // The win celebration covers the board first; dismissing it reveals the hub.
    fireEvent.click(screen.getByRole('dialog', { name: 'Alice wins' }).parentElement!);
    openRing();
  }

  beforeEach(() => sessionStorage.clear());

  it('makes Rematch the one filled key, and drops High roll, Players and Restart', () => {
    render(<GameBoard game={finished()} dispatch={vi.fn()} canControlAll {...handlers()} />);
    openFinishedRing();
    expect(keys()).toEqual(['Rematch', 'Dice', 'Settings', 'Help']);
    expect(document.querySelectorAll('.board-hub-key.is-primary')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Rematch' }).classList).toContain('is-primary');
  });

  it("swaps the dock's Leave for Clear the table, which acts at once", () => {
    const h = handlers();
    render(<GameBoard game={finished()} dispatch={vi.fn()} canControlAll {...h} />);
    openFinishedRing();
    expect(dockItems()).toEqual(['History', 'Rules', 'Clear the table']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear the table' }));
    expect(h.onLeave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Leave the board' })).toBeNull();
  });

  it('Rematch re-seats the table', () => {
    const h = handlers();
    render(<GameBoard game={finished()} dispatch={vi.fn()} canControlAll {...h} />);
    openFinishedRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rematch' }));
    expect(h.onRematch).toHaveBeenCalledTimes(1);
  });
});

describe('Restart, reached from the ring', () => {
  it('asks first, then dispatches reset', () => {
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(pair())} dispatch={dispatch} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart' }));
    expect(screen.getByText('Restart the game?')).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Restart the game?')).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();

    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'reset', id: expect.stringMatching(/^game_/) });
  });
});

describe('High Roll, reached from the ring', () => {
  it('shows each seat its own d20 and marks the winner', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: [11], 1: [20] }, winnerSeat: 1 });
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));

    const overlays = document.querySelectorAll('.pp-highroll');
    expect(overlays).toHaveLength(2);
    expect(overlays[0].textContent).toContain('11');
    expect(overlays[1].textContent).toContain('20');
    expect(overlays[1].classList.contains('is-winner')).toBe(true);
    expect(overlays[1].textContent).toContain('goes first');
  });

  it('records the winner exactly like the quiet first-player tool', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: [11], 1: [20] }, winnerSeat: 1 });
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(pair())} dispatch={dispatch} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));

    const sent = dispatch.mock.calls.map(([a]) => a as GameAction);
    expect(sent).toContainEqual({ type: 'settings', patch: { startingSeat: 1 } });
    expect(sent).toContainEqual({ type: 'pass-turn', actorSeat: null, toSeat: 1 });
  });

  it('freezes every panel’s life taps while showing', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: [11], 1: [20] }, winnerSeat: 1 });
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));

    for (const btn of screen.getAllByRole('button', { name: '+1 life' })) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('dismisses on a tap without leaking into a life change', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: [11], 1: [20] }, winnerSeat: 1 });
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(pair())} dispatch={dispatch} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));
    dispatch.mockClear();

    fireEvent.click(document.querySelectorAll('.pp-highroll')[0]);
    expect(document.querySelectorAll('.pp-highroll')).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'life' }));
  });

  it('dismisses itself after a few seconds', () => {
    vi.useFakeTimers();
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: [11], 1: [20] }, winnerSeat: 1 });
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));
    expect(document.querySelectorAll('.pp-highroll')).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(4001);
    });
    expect(document.querySelectorAll('.pp-highroll')).toHaveLength(0);
  });

  it('shows a tied seat’s first roll with its tiebreak(s) beneath it, so the winner reads highest', () => {
    // Rolls 20/20/18: both 20s tied and re-rolled 7 and 15. The winner (seat
    // 1, final 15) must not read lower than the loser's single 18.
    vi.mocked(highRoll).mockReturnValue({
      rolls: { 0: [20, 7], 1: [20, 15], 2: [18] },
      winnerSeat: 1,
    });
    const dispatch = vi.fn();
    render(
      <GameBoard
        game={makeTestState([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Cara')])}
        dispatch={dispatch}
        canControlAll
      />
    );
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));

    const overlays = document.querySelectorAll('.pp-highroll');
    expect(overlays).toHaveLength(3);
    // The two tied seats show their first roll AND their tiebreak; the
    // untied seat shows only its single roll.
    expect(overlays[0].textContent).toContain('20');
    expect(overlays[0].textContent).toContain('then 7');
    expect(overlays[1].textContent).toContain('20');
    expect(overlays[1].textContent).toContain('then 15');
    expect(overlays[1].classList.contains('is-winner')).toBe(true);
    expect(overlays[2].textContent).toContain('18');
    expect(overlays[2].textContent).not.toContain('then');

    const sent = dispatch.mock.calls.map(([a]) => a as GameAction);
    const note = sent.find((a) => a.type === 'note') as Extract<GameAction, { type: 'note' }>;
    expect(note.message).toBe('High roll: Bob goes first (rolled 20, then 15)');
  });
});
