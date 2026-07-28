// @vitest-environment happy-dom
/**
 * The in-game menu's Now / Game / Setup split, and the log's key-moments
 * default. The point of the split is that only the active tab mounts — a game
 * with a long log used to pay for the timeline walk, the life-chart replay and
 * every layout preview just to open the sheet — so these assert on what is
 * *absent*, not only on what renders.
 *
 * Mock harness mirrors GameBoard.test.tsx: GameBoard unconditionally touches
 * usePlayStore / haptics / wake-lock / undo-stack / dnd-kit whatever the
 * scenario, so all five are stubbed regardless of what a given test exercises.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameAction, GameState } from '../../lib/game-state';
import { applyAction, createGameState, makePlayer } from '../../lib/game-state';

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

function activeGame(actions: GameAction[] = []): GameState {
  const base = createGameState({
    id: 'game-test',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [0, 1, 2].map((seat) =>
      makePlayer({ id: `p${seat}`, userId: null, seat, name: `P${seat}`, startingLife: 40 })
    ),
    ts: 1000,
  });
  let ts = 2000;
  let state = applyAction(base, { type: 'start', ts });
  for (const a of actions) {
    ts += 5000;
    state = applyAction(state, { ...a, ts } as GameAction);
  }
  return state;
}

function openMenu(game: GameState, canControlAll = true) {
  render(<GameBoard game={game} dispatch={vi.fn()} canControlAll={canControlAll} />);
  fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('game menu tabs', () => {
  it('opens on Now with the mid-game actions and no log or board setup mounted', () => {
    openMenu(activeGame());
    expect(tab('Now').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'End game' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Flip coin/ })).toBeTruthy();
    // The expensive tabs stay unmounted until asked for.
    expect(screen.queryByText('This game')).toBeNull();
    expect(screen.queryByText('Key moments')).toBeNull();
    expect(screen.queryByLabelText('Tap zone orientation')).toBeNull();
  });

  it('mounts stats and the log only once the Game tab is selected', () => {
    openMenu(activeGame([{ type: 'life', seat: 1, delta: -7, actorSeat: 1 }]));
    fireEvent.click(tab('Game'));
    expect(screen.getByText('This game')).toBeTruthy();
    expect(screen.getByText('Key moments')).toBeTruthy();
    // ...and the Now tab's actions are gone, not just hidden.
    expect(screen.queryByRole('button', { name: 'End game' })).toBeNull();
  });

  it('mounts board setup only on the Setup tab', () => {
    openMenu(activeGame());
    fireEvent.click(tab('Setup'));
    expect(screen.getByLabelText('Tap zone orientation')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Haptic feedback/ })).toBeTruthy();
  });

  it('hides Setup from a non-host', () => {
    openMenu(activeGame(), false);
    expect(screen.queryByRole('tab', { name: 'Setup' })).toBeNull();
    expect(tab('Now')).toBeTruthy();
    expect(tab('Game')).toBeTruthy();
  });

  it('hides Setup once the game is finished', () => {
    const game = { ...activeGame(), status: 'finished' as const, winnerSeat: 0 };
    openMenu(game);
    expect(screen.queryByRole('tab', { name: 'Setup' })).toBeNull();
  });
});

describe('game log filtering', () => {
  /** A tap-heavy game: many -1s (noise) plus one real moment. */
  const noisyGame = () =>
    activeGame([
      ...Array.from({ length: 8 }, () => ({
        type: 'life' as const,
        seat: 1,
        delta: -1,
        actorSeat: 1,
      })),
      { type: 'pass-turn', actorSeat: 0 },
      { type: 'eliminate', seat: 2, eliminated: true },
    ]);

  it('defaults to key moments, hiding the ±1 taps and turn passes', () => {
    openMenu(noisyGame());
    fireEvent.click(tab('Game'));
    expect(screen.getByText('Key moments')).toBeTruthy();
    expect(screen.getAllByText(/eliminated/).length).toBeGreaterThan(0);
    // Each -1 tap is its own row here (5s apart, so grouping can't fold them).
    expect(screen.queryByText('-1')).toBeNull();
  });

  it('reveals the raw log on demand and switches back', () => {
    openMenu(noisyGame());
    fireEvent.click(tab('Game'));
    fireEvent.click(screen.getByRole('button', { name: /Show all \d+ events/ }));
    expect(screen.getByText('Full log')).toBeTruthy();
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Show key moments only' }));
    expect(screen.getByText('Key moments')).toBeTruthy();
    expect(screen.queryByText('-1')).toBeNull();
  });

  it('surfaces first blood and a placement in the stats block', () => {
    const game = activeGame([
      { type: 'pass-turn', actorSeat: 0 }, // seat 0 on the play
      { type: 'life', seat: 1, delta: -12, actorSeat: 1 },
      { type: 'life', seat: 2, delta: -40, actorSeat: 2 },
    ]);
    openMenu(game);
    fireEvent.click(tab('Game'));
    expect(screen.getByText(/First blood: P1 — P0/)).toBeTruthy();

    // Scoped to the stats rows — bare numbers also appear as board life totals.
    const rowFor = (name: string) =>
      [...document.querySelectorAll('.game-stats-row')].find((r) =>
        r.textContent?.startsWith(name)
      );
    expect(rowFor('P1')?.textContent).toContain('12 taken');
    expect(rowFor('P2')?.textContent).toContain('3rd'); // first out of three
    expect(rowFor('P2')?.textContent).toContain('KO by P0');
  });
});
