// @vitest-environment happy-dom
/**
 * Commander-damage focus mode.
 *
 * Covers entry (⚔ chip / swipe up on your own panel), the board-level meaning
 * flip (every OTHER panel becomes "damage this player dealt to me", the
 * focused player keeps their life), the dispatch attribution, and the ways
 * out. The dangerous failure here is a number that still reads as life, so
 * the labelling is asserted as hard as the wiring.
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

import { GameBoard, cmdDamageFillRatio, cmdDamageToLethal } from './GameBoard';

/** Alice (seat 0) plus two opponents, one with a color identity, one without. */
function renderPod(dispatch = vi.fn(), alice: Partial<GamePlayer> = {}) {
  const game = makeTestState([
    makeTestPlayer(alice),
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
function tapZone(seat: number, label = '+1 life') {
  // The +1 step button carries the same label as the tap zone, so filter to
  // the zones themselves before indexing by seat.
  const zones = screen
    .getAllByLabelText(label)
    .filter((el) => el.classList.contains('player-panel-tapzone'));
  return zones[seat];
}

/** Drag `dy` px in SCREEN space (negative = toward the top of the display). */
function drag(el: Element, dy: number) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 200, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 200 + dy, pointerId: 1 });
}

function tap(el: Element, pointerId = 9) {
  fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId });
  fireEvent.pointerUp(el, { clientX: 10, clientY: 10, pointerId });
}

/** Alice (seat 0) is rotated 180°, so "up" for her is screen-DOWN. */
const ALICE_UP = 60;
const ALICE_DOWN = -60;

/** Present only while the board is in commander-damage focus mode. */
function focusBar() {
  return document.querySelector('.pp-cmd-focus-bar');
}

describe('entering commander-damage focus mode', () => {
  it('swiping up on your own panel flips the other panels to damage dealt to you', () => {
    renderPod();
    expect(focusBar()).toBeNull();

    drag(tapZone(0), ALICE_UP);

    expect(focusBar()).toBeTruthy();
    // Bob and Carol's panels now log damage TO Alice, labelled by commander
    // with a name fallback.
    expect(screen.getByLabelText('Atraxa: 0 commander damage dealt to Alice')).toBeTruthy();
    expect(screen.getByLabelText('Carol: 0 commander damage dealt to Alice')).toBeTruthy();
    // Alice's own panel keeps her life — it's the anchor, and it drops live.
    expect(screen.getByLabelText('Alice: 40 life')).toBeTruthy();
  });

  it('reads the gesture in panel space, so an upright seat swipes screen-up', () => {
    renderPod();

    // Bob (seat 1) is upright: his "up" is the opposite screen direction to
    // Alice's. Same physical motion toward each player, opposite dy.
    drag(tapZone(1), -60);

    // Bob is now the anchor (his life), and the OTHER seats became sources.
    expect(screen.getByLabelText('Bob: 40 life')).toBeTruthy();
    expect(screen.getByLabelText('Alice: 0 commander damage dealt to Bob')).toBeTruthy();
    expect(screen.getByLabelText('Carol: 0 commander damage dealt to Bob')).toBeTruthy();
  });

  it('the commander-damage chip opens the same mode on web', () => {
    renderPod();

    fireEvent.click(screen.getAllByLabelText(/^Commander damage, highest/)[0]);

    expect(focusBar()).toBeTruthy();
  });

  it('does NOT re-orient the board — every seat keeps its own rotation', () => {
    renderPod();
    const rotations = () =>
      Array.from(document.querySelectorAll('.player-panel[data-seat]')).map((el) =>
        (el as HTMLElement).style.getPropertyValue('--pp-rot')
      );
    // Default 3p layout: seat 0 rotated 180°, seats 1–2 upright.
    const before = rotations();
    expect(before).toEqual(['180deg', '0deg', '0deg']);

    drag(tapZone(0), ALICE_UP);

    // Turning the panels toward whoever opened the mode reads as the seats
    // themselves moving, which looks broken. A mode changes what a panel
    // says, never where it sits or which way it faces.
    expect(rotations()).toEqual(before);
  });

  it('ignores a drag that is short or predominantly horizontal', () => {
    renderPod();
    const zone = tapZone(0);

    // Under the 40px threshold.
    drag(zone, 20);
    expect(focusBar()).toBeNull();

    // Far enough vertically, but the horizontal component dominates.
    fireEvent.pointerDown(zone, { clientX: 100, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(zone, { clientX: 300, clientY: 250, pointerId: 1 });
    expect(focusBar()).toBeNull();
  });
});

describe('logging damage in focus mode', () => {
  it('tapping an opponent panel dispatches cmd-dmg attributed to that seat', () => {
    const { dispatch } = renderPod();
    drag(tapZone(0), ALICE_UP);

    tap(tapZone(0, '+1 commander damage from Atraxa'));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'cmd-dmg',
      seat: 0,
      fromSeat: 1,
      delta: 1,
      actorSeat: 0,
    });
  });

  it('decrements from the opposite half of the same panel', () => {
    const { dispatch } = renderPod();
    drag(tapZone(0), ALICE_UP);

    tap(tapZone(0, '-1 commander damage from Atraxa'));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'cmd-dmg',
      seat: 0,
      fromSeat: 1,
      delta: -1,
      actorSeat: 0,
    });
  });

  it('leaves the focused player’s own panel adjusting life, not damage', () => {
    const { dispatch } = renderPod();
    drag(tapZone(0), ALICE_UP);

    tap(tapZone(0, '+1 life'));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'life',
      seat: 0,
      delta: 1,
      actorSeat: 0,
    });
  });

  it('shows each source’s damage, their own life as a readout, and the lethal race', () => {
    renderPod(vi.fn(), { commanderDamage: { 1: 9 } });
    drag(tapZone(0), ALICE_UP);

    const bobPanel = screen
      .getByLabelText('Atraxa: 9 commander damage dealt to Alice')
      .closest('.player-panel') as HTMLElement;
    expect(bobPanel.style.getPropertyValue('--fill')).toBe(String(9 / 21));
    // Bob's own life is demoted, not discarded — the board stays readable.
    expect(bobPanel.querySelector('.pp-life-chip')?.textContent).toBe('40 life');
    const hint = screen.getByText('12 to lethal');
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    // ...and the caption names who the damage is going to, so a bare "9"
    // can't be misread as Bob's life total.
    expect(bobPanel.querySelector('.pp-cmd-caption')?.textContent).toContain('dealt to Alice');
  });

  it('marks a source lethal at 21 from that one commander', () => {
    renderPod(vi.fn(), { commanderDamage: { 1: 21 } });
    drag(tapZone(0), ALICE_UP);

    const bobPanel = screen
      .getByLabelText('Atraxa: 21 commander damage dealt to Alice')
      .closest('.player-panel') as HTMLElement;
    expect(bobPanel.classList.contains('is-cmd-lethal')).toBe(true);
  });
});

describe('leaving focus mode', () => {
  it('the return button restores the normal board', () => {
    renderPod();
    drag(tapZone(0), ALICE_UP);

    fireEvent.click(screen.getByRole('button', { name: 'Return to game' }));

    expect(focusBar()).toBeNull();
    expect(screen.getByLabelText('Bob: 40 life')).toBeTruthy();
  });

  it('swiping back down leaves the mode', () => {
    renderPod();
    drag(tapZone(0), ALICE_UP);

    drag(tapZone(0, '+1 life'), ALICE_DOWN);

    expect(focusBar()).toBeNull();
  });

  it('Escape leaves the mode', () => {
    renderPod();
    drag(tapZone(0), ALICE_UP);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(focusBar()).toBeNull();
  });
});

describe('cmdDamageFillRatio / cmdDamageToLethal', () => {
  it('clamps fill to [0, 1] across the value range', () => {
    expect(cmdDamageFillRatio(0)).toBe(0);
    expect(cmdDamageFillRatio(9)).toBeCloseTo(9 / 21);
    expect(cmdDamageFillRatio(21)).toBe(1);
    expect(cmdDamageFillRatio(30)).toBe(1); // clamped past lethal
  });

  it('only surfaces the hint mid-race — hidden at 0 and once already lethal', () => {
    expect(cmdDamageToLethal(0)).toBeNull();
    expect(cmdDamageToLethal(9)).toBe(12);
    expect(cmdDamageToLethal(21)).toBeNull();
    expect(cmdDamageToLethal(30)).toBeNull();
  });
});
