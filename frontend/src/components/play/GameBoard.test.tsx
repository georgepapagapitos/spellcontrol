// @vitest-environment happy-dom
/**
 * GameBoard end-of-game and overlay behaviour. Mirrors the mock harness
 * already proven out by GameBoard.ux321.test.tsx (GameBoard unconditionally
 * touches usePlayStore/haptics/wake-lock/undo-stack/dnd-kit regardless of
 * scenario) — this file adds its own describe blocks rather than growing
 * that ticket-scoped file.
 */ import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function makeTestPlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({ id: 'p0', userId: null, seat: 0, name: 'Alice', startingLife: 40 }),
    ...overrides,
  };
}

function makeTestState(
  players: GamePlayer[],
  opts: { mode?: 'local' | 'online'; status?: GameState['status']; winnerSeat?: number | null } = {}
): GameState {
  const state = createGameState({
    id: 'game-test',
    code: opts.mode === 'online' ? 'ABCD' : '',
    mode: opts.mode ?? 'online',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
  return {
    ...state,
    status: opts.status ?? 'finished',
    winnerSeat: opts.winnerSeat ?? 0,
  };
}

vi.mock('../../store/play', () => {
  const getState = vi.fn(() => ({ stopPolling: vi.fn(), startPolling: vi.fn() }));
  const usePlayStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      hapticsEnabled: false,
      setHaptics: vi.fn(),
      preferredLayouts: {},
      setPreferredLayout: vi.fn(),
    });
  usePlayStore.getState = getState;
  return { usePlayStore };
});

vi.mock('../../lib/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

vi.mock('../../lib/use-wake-lock', () => ({ useWakeLock: vi.fn() }));

vi.mock('../../lib/undo-stack', () => ({
  capture: vi.fn(),
  clearUndo: vi.fn(),
  peekLabel: vi.fn(() => null),
  popRestore: vi.fn(() => []),
  runSuppressed: vi.fn((fn: () => void) => fn()),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  PointerSensor: class {},
  closestCenter: vi.fn(),
  useDraggable: () => ({ setNodeRef: vi.fn(), attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { GameBoard } from './GameBoard';

describe('Win celebration', () => {
  it('does not replay after the board remounts once it was dismissed', () => {
    sessionStorage.clear();
    const game = makeTestState([makeTestPlayer()], {
      mode: 'local',
      status: 'finished',
      winnerSeat: 0,
    });
    const first = render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    // The dialog is the card; dismissal is a backdrop hit (its parent), never
    // a click inside the card itself.
    const overlay = screen.getByRole('dialog', { name: 'Alice wins' });
    fireEvent.click(overlay.parentElement!);
    expect(screen.queryByRole('dialog', { name: 'Alice wins' })).toBeNull();
    first.unmount();

    // Same finished game back on the table (a return to /play, a tab switch):
    // the recap was already seen — no confetti again.
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(screen.queryByRole('dialog', { name: 'Alice wins' })).toBeNull();
  });

  it('labels the finished-game exit by what it does, not "Close"', () => {
    sessionStorage.clear();
    const game = makeTestState([makeTestPlayer()], {
      mode: 'local',
      status: 'finished',
      winnerSeat: 0,
    });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll onLeave={vi.fn()} />);
    fireEvent.click(screen.getByRole('dialog', { name: 'Alice wins' }).parentElement!);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Clear the table' })).toBeTruthy();
    // Exactly one control named "Close" in the sheet — the ✕.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });
});

describe('Board overlays answer Escape', () => {
  // These render in place (the seat menu inherits its panel's rotation, the
  // game menu rises from the board's own edge) rather than through <Modal>,
  // and used to ignore Escape entirely — a keyboard user had to find the ✕.
  it('closes the game menu', () => {
    const game = makeTestState([makeTestPlayer()], { mode: 'local', status: 'active' });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Menu' }));
    expect(screen.getByRole('dialog', { name: 'Local game' })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Local game' })).toBeNull();
  });

  it('closes the hub ring on Escape and returns focus to the hub', () => {
    const game = makeTestState([makeTestPlayer()], { mode: 'local', status: 'active' });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    const hub = screen.getByRole('button', { name: 'Game menu' });
    fireEvent.click(hub);
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
    expect(document.activeElement).toBe(hub);
  });

  it('closes the seat drawer and returns focus to its trigger, the seat name', () => {
    const game = makeTestState([makeTestPlayer({ name: 'Alice' })], {
      mode: 'local',
      status: 'active',
    });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    const trigger = screen.getByRole('button', { name: 'Alice: seat menu' });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole('dialog', { name: 'Seat menu for Alice' });
    expect(menu.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Seat menu for Alice' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Right-click belongs to the board', () => {
  // The board is a game surface, not a document: its own gestures own
  // right-click, so the native browser menu never opens over the felt or the
  // chrome. `fireEvent` returns false when the event was cancelled, which is
  // exactly "no native menu here".
  it('cancels the native menu across the board, chrome included', () => {
    const game = makeTestState([makeTestPlayer()], { mode: 'local', status: 'active' });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);

    const board = document.querySelector('.game-board')!;
    const menuBtn = screen.getByRole('button', { name: 'Game menu' });

    for (const target of [board, menuBtn]) {
      expect(fireEvent.contextMenu(target)).toBe(false);
    }
  });

  it('leaves a text field its own menu, so paste still works', () => {
    const game = makeTestState([makeTestPlayer({ name: 'Alice' })], {
      mode: 'local',
      status: 'active',
    });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Alice: seat menu' }));

    // The seat drawer's name field is a real input on the board — one of the
    // few places a player types rather than taps, and the case the board-wide
    // suppression has to leave alone.
    const nameInput = screen.getByLabelText('Name');
    expect(fireEvent.contextMenu(nameInput)).toBe(true);
  });
});
