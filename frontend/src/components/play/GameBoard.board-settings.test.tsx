// @vitest-environment happy-dom
/**
 * The remaining Lotus board settings: low life warning (threshold + pref
 * gate), underlined 6/9, and minimalist mode. Mirrors the mock harness
 * already proven out by GameBoard.test.tsx / GameBoard.ux321.test.tsx, with
 * one addition — the mocked play store is a mutable object so each test can
 * flip the three new prefs without a fresh `vi.mock` factory per case.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
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
    id: 'game-settings',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
  return { ...state, status: 'active', startedAt: Date.now() };
}

const mockPrefs = {
  hapticsEnabled: false,
  setHaptics: vi.fn(),
  preferredLayouts: {},
  setPreferredLayout: vi.fn(),
  gameTimerEnabled: false,
  turnTrackerEnabled: false,
  setGameTimerEnabled: vi.fn(),
  setTurnTrackerEnabled: vi.fn(),
  lowLifeWarningEnabled: true,
  underlineSixNine: false,
  minimalistMode: false,
};

vi.mock('../../store/play', () => {
  const getState = vi.fn(() => ({ stopPolling: vi.fn(), startPolling: vi.fn() }));
  const usePlayStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockPrefs as unknown as Record<string, unknown>);
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

function resetPrefs() {
  mockPrefs.lowLifeWarningEnabled = true;
  mockPrefs.underlineSixNine = false;
  mockPrefs.minimalistMode = false;
}

describe('Low life warning', () => {
  it('fires below 10 (not just below 6), on by default', () => {
    resetPrefs();
    const game = makeTestState([makeTestPlayer({ life: 8 })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.player-panel.is-low-life')).toBeTruthy();
  });

  it('does not fire at 10 or above', () => {
    resetPrefs();
    const game = makeTestState([makeTestPlayer({ life: 10 })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.player-panel.is-low-life')).toBeNull();
  });

  it('is suppressed entirely when the device pref is off', () => {
    resetPrefs();
    mockPrefs.lowLifeWarningEnabled = false;
    const game = makeTestState([makeTestPlayer({ life: 3 })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.player-panel.is-low-life')).toBeNull();
  });
});

describe('Underlined 6 and 9', () => {
  it('off by default: the numeral renders as plain text, no digit spans', () => {
    resetPrefs();
    const game = makeTestState([makeTestPlayer({ life: 69 })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.pp-digit-underline')).toBeNull();
    expect(screen.getByText('69')).toBeTruthy();
  });

  it('on: wraps the 6 and the 9 each in their own span, and the aria-label stays the plain number', () => {
    resetPrefs();
    mockPrefs.underlineSixNine = true;
    const game = makeTestState([makeTestPlayer({ life: 69 })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    const spans = document.querySelectorAll('.pp-digit-underline');
    expect(Array.from(spans).map((s) => s.textContent)).toEqual(['6', '9']);
    // The set-life button's aria-label still reads the plain number.
    expect(screen.getByRole('button', { name: 'Set life: currently 69' })).toBeTruthy();
  });

  it('leaves digits other than 6/9 alone', () => {
    resetPrefs();
    mockPrefs.underlineSixNine = true;
    const game = makeTestState([makeTestPlayer({ life: 40 })]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.pp-digit-underline')).toBeNull();
    expect(screen.getByText('40')).toBeTruthy();
  });
});

describe('Minimalist mode', () => {
  it('off by default: the ± step buttons are plain, unhidden buttons', () => {
    resetPrefs();
    const game = makeTestState([makeTestPlayer()]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.player-panel.is-minimalist')).toBeNull();
    expect(screen.getByRole('button', { name: '-1 life' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+1 life' })).toBeTruthy();
  });

  it('on: the step buttons stay in the DOM (accessible) but the panel is flagged for CSS to visually hide them', () => {
    resetPrefs();
    mockPrefs.minimalistMode = true;
    const game = makeTestState([makeTestPlayer()]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.player-panel.is-minimalist')).toBeTruthy();
    // Still real, focusable buttons — screen reader / keyboard access intact.
    const minus = screen.getByRole('button', { name: '-1 life' });
    const plus = screen.getByRole('button', { name: '+1 life' });
    expect(minus).toBeTruthy();
    expect(plus).toBeTruthy();
    expect((minus as HTMLButtonElement).disabled).toBe(false);
    expect((plus as HTMLButtonElement).disabled).toBe(false);
  });
});
