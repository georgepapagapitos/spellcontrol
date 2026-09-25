// @vitest-environment happy-dom
/**
 * The life keypad is a board-level dialog (Lotus's model), not an in-panel
 * cover — `GameBoard` owns which seat it's open for and renders it once,
 * rotated to face that seat. Covers the dialog contract (role/aria-modal,
 * initial focus, Escape, focus restore, backdrop-dismiss-only-on-self) and
 * the rotation attribute, mirroring the mock harness GameBoard.test.tsx
 * already proved out (GameBoard unconditionally touches usePlayStore/
 * haptics/wake-lock/undo-stack/dnd-kit regardless of scenario).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function makeTestPlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({ id: 'p0', userId: null, seat: 0, name: 'Alice', startingLife: 40 }),
    ...overrides,
  };
}

function makeTestState(players: GamePlayer[]): GameState {
  const state = createGameState({
    id: 'game-test',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
  return { ...state, status: 'active' };
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

describe('life keypad — board-level dialog', () => {
  it('is a real dialog: role, aria-modal, and initial focus lands inside it', () => {
    const game = makeTestState([makeTestPlayer({ name: 'Alice' })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    const trigger = screen.getByRole('button', { name: 'Set life: currently 40' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Set life for Alice' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('is rendered board-level, not inside the seat panel it was opened from', () => {
    const game = makeTestState([makeTestPlayer({ name: 'Alice' })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Set life: currently 40' }));
    const dialog = screen.getByRole('dialog', { name: 'Set life for Alice' });
    expect(dialog.closest('.player-panel')).toBeNull();
    expect(dialog.closest('.game-board')).toBeTruthy();
  });

  it('Escape closes it and returns focus to the numeral button', () => {
    const game = makeTestState([makeTestPlayer({ name: 'Alice' })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    const trigger = screen.getByRole('button', { name: 'Set life: currently 40' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Set life for Alice' })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Set life for Alice' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses on the dimmed backdrop, never on a click that bubbled from inside', () => {
    const game = makeTestState([makeTestPlayer({ name: 'Alice' })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Set life: currently 40' }));
    const dialog = screen.getByRole('dialog', { name: 'Set life for Alice' });
    const backdrop = dialog.parentElement!;
    expect(backdrop.className).toContain('life-keypad-backdrop');

    // A click that bubbles up from inside the dialog must not close it.
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog', { name: 'Set life for Alice' })).toBeTruthy();

    // A click on the backdrop itself does.
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog', { name: 'Set life for Alice' })).toBeNull();
  });

  it('carries the opening seat rotation for a shared (local) board', () => {
    // 4p-sides (the default 4-player local layout) seats two players
    // sideways (90/270) — the keypad should read that same rotation so it
    // faces whoever opened it.
    const game = makeTestState([
      makeTestPlayer({ id: 'p0', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', seat: 1, name: 'Bob' }),
      makeTestPlayer({ id: 'p2', seat: 2, name: 'Carol' }),
      makeTestPlayer({ id: 'p3', seat: 3, name: 'Dave' }),
    ]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    const rotated = [
      ...document.querySelectorAll('.player-panel[data-sideways]'),
    ][0] as HTMLElement;
    expect(rotated).toBeTruthy();
    const seat = rotated.dataset.seat;
    const player = game.players.find((p) => String(p.seat) === seat)!;
    fireEvent.click(
      within(rotated).getByRole('button', { name: `Set life: currently ${player.life}` })
    );
    const dialog = screen.getByRole('dialog', { name: `Set life for ${player.name}` });
    expect(dialog.getAttribute('data-rot')).toMatch(/^(90|270)$/);
  });

  it('sends the confirmed value for the seat it was opened from', () => {
    const dispatch = vi.fn();
    const game = makeTestState([
      makeTestPlayer({ id: 'p0', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', seat: 1, name: 'Bob' }),
    ]);
    render(<GameBoard game={game} dispatch={dispatch} canControlAll />);
    const panel0 = document.querySelector('.player-panel[data-seat="0"]') as HTMLElement;
    fireEvent.click(within(panel0).getByRole('button', { name: 'Set life: currently 40' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set life' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-life',
      seat: 0,
      value: 27,
      actorSeat: 0,
    });
  });
});
