// @vitest-environment happy-dom
/**
 * Swipe-to-log-commander-damage.
 *
 * Covers the gesture (swipe up on your own panel opens the counters cover,
 * swipe back down dismisses it), the per-opponent tiles inside it, and the
 * seat-color tinting that makes each tile readable as "that player".
 *
 * Mock harness mirrors GameBoard.test.tsx — GameBoard unconditionally touches
 * usePlayStore / haptics / wake-lock / undo-stack / dnd-kit regardless of
 * scenario, so those have to be stubbed before importing it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
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

/** Alice (seat 0) plus two opponents, one with a color identity, one without. */
function renderPod(dispatch = vi.fn()) {
  const game = makeTestState([
    makeTestPlayer(),
    makeTestPlayer({ id: 'p1', seat: 1, name: 'Bob', commander: 'Atraxa', colorIdentity: ['G'] }),
    makeTestPlayer({ id: 'p2', seat: 2, name: 'Carol', commander: null, colorIdentity: [] }),
  ]);
  render(<GameBoard game={game} dispatch={dispatch} canControlAll />);
  return { dispatch };
}

/**
 * Tap zones in seat order. In the default 3p layout ("wide top + 2 bottom")
 * seat 0 is rotated 180° and seats 1–2 are upright, which is exactly why the
 * gesture is interpreted in panel-local space rather than screen space.
 */
function tapZone(seat: number) {
  // The +1 step button carries the same label as the tap zone, so filter to
  // the zones themselves before indexing by seat.
  return screen
    .getAllByLabelText('+1 life')
    .filter((el) => el.classList.contains('player-panel-tapzone'))[seat];
}

/** Drag `dy` px in SCREEN space (negative = toward the top of the display). */
function drag(el: Element, dy: number) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 200, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 200 + dy, pointerId: 1 });
}

/** Alice (seat 0) is rotated 180°, so "up" for her is screen-DOWN. */
const ALICE_UP = 60;
const ALICE_DOWN = -60;

describe('swipe to log commander damage', () => {
  it('swiping up on your own panel opens the counters cover', () => {
    renderPod();
    expect(screen.queryByRole('dialog', { name: 'Alice counters' })).toBeNull();

    drag(tapZone(0), ALICE_UP);

    expect(screen.getByRole('dialog', { name: 'Alice counters' })).toBeTruthy();
  });

  it('reads the gesture in panel space, so an upright seat swipes screen-up', () => {
    renderPod();

    // Bob (seat 1) is upright: his "up" is the opposite screen direction to
    // Alice's. Same physical motion toward each player, opposite dy.
    drag(tapZone(1), -60);

    expect(screen.getByRole('dialog', { name: 'Bob counters' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Alice counters' })).toBeNull();
  });

  it('swiping back down on the cover dismisses it', () => {
    renderPod();
    drag(tapZone(0), ALICE_UP);
    const cover = screen.getByRole('dialog', { name: 'Alice counters' });

    drag(cover, ALICE_DOWN);

    expect(screen.queryByRole('dialog', { name: 'Alice counters' })).toBeNull();
  });

  it('ignores a drag that is short or predominantly horizontal', () => {
    renderPod();
    const zone = tapZone(0);

    // Under the 40px threshold.
    drag(zone, 20);
    expect(screen.queryByRole('dialog', { name: 'Alice counters' })).toBeNull();

    // Far enough vertically, but the horizontal component dominates.
    fireEvent.pointerDown(zone, { clientX: 100, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(zone, { clientX: 300, clientY: 250, pointerId: 1 });
    expect(screen.queryByRole('dialog', { name: 'Alice counters' })).toBeNull();
  });

  it('shows one tile per opponent, labelled by commander with a name fallback', () => {
    renderPod();
    drag(tapZone(0), ALICE_UP);

    // Bob has a commander; Carol does not, so she falls back to her name.
    expect(screen.getByRole('button', { name: '+1 commander damage from Atraxa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+1 commander damage from Carol' })).toBeTruthy();
    // No self-tile: you can't deal commander damage to yourself.
    expect(screen.queryByRole('button', { name: '+1 commander damage from Alice' })).toBeNull();
  });

  it('tapping a tile dispatches cmd-dmg attributed to that opponent seat', () => {
    const { dispatch } = renderPod();
    drag(tapZone(0), ALICE_UP);

    const plus = screen.getByRole('button', { name: '+1 commander damage from Atraxa' });
    fireEvent.pointerDown(plus, { clientX: 10, clientY: 10, pointerId: 2 });
    fireEvent.pointerUp(plus, { clientX: 10, clientY: 10, pointerId: 2 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'cmd-dmg',
      seat: 0,
      fromSeat: 1,
      delta: 1,
      actorSeat: 0,
    });
  });

  it('decrements from the minus half of the tile', () => {
    const { dispatch } = renderPod();
    drag(tapZone(0), ALICE_UP);

    const minus = screen.getByRole('button', { name: '-1 commander damage from Atraxa' });
    fireEvent.pointerDown(minus, { clientX: 10, clientY: 10, pointerId: 3 });
    fireEvent.pointerUp(minus, { clientX: 10, clientY: 10, pointerId: 3 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'cmd-dmg',
      seat: 0,
      fromSeat: 1,
      delta: -1,
      actorSeat: 0,
    });
  });

  it('tints each tile with that opponent color: identity class, else seat palette', () => {
    renderPod();
    drag(tapZone(0), ALICE_UP);

    // Bob is mono-green → the shared pp-color-g palette class.
    const bobTile = screen
      .getByRole('button', { name: '+1 commander damage from Atraxa' })
      .closest('.pp-cmd-tile') as HTMLElement;
    expect(bobTile.classList.contains('pp-color-g')).toBe(true);
    expect(bobTile.style.getPropertyValue('--pp-base')).toBe('');

    // Carol has no identity and no override → inline seat-palette vars.
    const carolTile = screen
      .getByRole('button', { name: '+1 commander damage from Carol' })
      .closest('.pp-cmd-tile') as HTMLElement;
    expect(carolTile.className).not.toContain('pp-color-');
    expect(carolTile.style.getPropertyValue('--pp-base')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
