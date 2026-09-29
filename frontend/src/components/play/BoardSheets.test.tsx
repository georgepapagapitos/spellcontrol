// @vitest-environment happy-dom
/**
 * The hub's destination sheets (board T155): Players, Settings, History, Help
 * and Leave, each on the one BoardSheet shell. (Dice has its own file.)
 * These replaced the tabbed game menu, so the old Setup-tab and Game-tab
 * assertions live on here against the sheet that now owns each control.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameAction, GameState } from '../../lib/game-state';
import { applyAction, createGameState, makePlayer } from '../../lib/game-state';

const mockPlayState = {
  hapticsEnabled: false,
  setHaptics: vi.fn(),
  preferredLayouts: {} as Record<number, string>,
  setPreferredLayout: vi.fn(),
  gameTimerEnabled: false,
  setGameTimerEnabled: vi.fn(),
  turnTrackerEnabled: false,
  setTurnTrackerEnabled: vi.fn(),
  lowLifeWarningEnabled: true,
  setLowLifeWarningEnabled: vi.fn(),
  underlineSixNine: false,
  setUnderlineSixNine: vi.fn(),
  minimalistMode: false,
  setMinimalistMode: vi.fn(),
};

vi.mock('../../store/play', () => {
  const usePlayStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockPlayState as unknown as Record<string, unknown>);
  return { usePlayStore };
});
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  PointerSensor: class {},
  closestCenter: vi.fn(),
  useDraggable: () => ({ setNodeRef: vi.fn(), attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...args: unknown[]) => args),
}));

import { HelpSheet, HistorySheet, LeaveSheet, PlayersSheet, SettingsSheet } from './BoardSheets';

function activeGame(actions: GameAction[] = [], seats = 3): GameState {
  const base = createGameState({
    id: 'game-test',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: Array.from({ length: seats }, (_, seat) =>
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('the sheet shell', () => {
  it('is a labelled modal dialog with its meta line as its description', () => {
    render(<HistorySheet game={activeGame()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'History' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const described = document.getElementById(dialog.getAttribute('aria-describedby')!);
    expect(described?.textContent).toBe('Commander · 40 life · Commander damage');
  });

  it('closes on the ✕, on Escape, and on a backdrop tap, never on a tap inside', () => {
    const onClose = vi.fn();
    render(<HistorySheet game={activeGame()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(document.querySelector('.board-sheet-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('Players', () => {
  const players = (game: GameState, dispatch = vi.fn()) =>
    render(<PlayersSheet game={game} dispatch={dispatch} onClose={vi.fn()} onRestart={vi.fn()} />);

  it('states the count and the layout by name in its meta line', () => {
    players(activeGame([], 4));
    expect(document.querySelector('.board-sheet-meta')?.textContent).toBe(
      '4 players · Sides layout'
    );
  });

  it('adds and removes seats before life moves', () => {
    const dispatch = vi.fn();
    players(activeGame(), dispatch);
    fireEvent.click(screen.getByRole('button', { name: 'Add player' }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'add-player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove P1' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'remove-player', seat: 1 });
  });

  it('keeps remove visible but disabled at two seats, and says why', () => {
    players(activeGame([], 2));
    expect((screen.getByRole('button', { name: 'Remove P0' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText('A game needs at least 2 players.')).toBeTruthy();
  });

  it('drops Add player at ten seats, and says why', () => {
    players(activeGame([], 10));
    expect(screen.queryByRole('button', { name: 'Add player' })).toBeNull();
    expect(screen.getByText('A table seats up to 10 players.')).toBeTruthy();
  });

  it('opens on the current layout, never on a seat’s remove button or Restart…', () => {
    players(activeGame([], 4));
    const focused = document.activeElement as HTMLInputElement;
    expect(focused.type).toBe('radio');
    expect(focused.checked).toBe(true);
    cleanup();
    players(activeGame([{ type: 'life', seat: 1, delta: -3, actorSeat: 1 }]));
    expect((document.activeElement as HTMLInputElement).checked).toBe(true);
  });

  it('locks the roster once life moves, and the lock note offers Restart', () => {
    const onRestart = vi.fn();
    const game = activeGame([{ type: 'life', seat: 1, delta: -3, actorSeat: 1 }]);
    render(<PlayersSheet game={game} dispatch={vi.fn()} onClose={vi.fn()} onRestart={onRestart} />);
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add player' })).toBeNull();
    expect(screen.getByText(/Seats lock once the game starts\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart…' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('applies a picked layout at once, with no primary and no footer', () => {
    const dispatch = vi.fn();
    players(activeGame([], 4), dispatch);
    fireEvent.click(screen.getByRole('radio', { name: 'Pod' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'settings', patch: { layout: '4p-pod' } });
    expect(document.querySelector('.board-sheet-foot')).toBeNull();
    expect(document.querySelector('.board-sheet .btn-primary')).toBeNull();
  });

  it('sets the current layout as the default for this player count', () => {
    players(activeGame());
    const row = screen.getByRole('switch', { name: 'Default for 3-player games' });
    expect(row.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(row);
    expect(mockPlayState.setPreferredLayout).toHaveBeenCalledWith(3, expect.any(String));
  });

  it('opens the custom layout editor from Custom…', () => {
    players(activeGame([], 4));
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(screen.getByRole('button', { name: 'Apply layout' })).toBeTruthy();
  });
});

describe('Settings', () => {
  const settings = (over: Partial<Parameters<typeof SettingsSheet>[0]> = {}) =>
    render(
      <SettingsSheet
        game={activeGame()}
        dispatch={vi.fn()}
        onClose={vi.fn()}
        fullscreenSupported={false}
        isFullscreen={false}
        onToggleFullscreen={vi.fn()}
        {...over}
      />
    );

  it('groups the settings by what they are about', () => {
    settings();
    expect(
      [...document.querySelectorAll('.form-section-heading')].map((h) => h.textContent)
    ).toEqual(['Taps', 'Clock strip', 'Seats', 'This device']);
  });

  it('flips every device pref switch to its own setter', () => {
    settings();
    const haptics = screen.getByRole('switch', { name: 'Haptic feedback' });
    expect(haptics.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(haptics);
    expect(mockPlayState.setHaptics).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Game timer' }));
    expect(mockPlayState.setGameTimerEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Turn tracker' }));
    expect(mockPlayState.setTurnTrackerEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Low life warning' }));
    expect(mockPlayState.setLowLifeWarningEnabled).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Underlined 6 and 9' }));
    expect(mockPlayState.setUnderlineSixNine).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Minimalist mode' }));
    expect(mockPlayState.setMinimalistMode).toHaveBeenCalledWith(true);
  });

  // STYLE_GUIDE § Table settings / § Config surfaces: an on/off row states
  // what On does in one line under the label, not just its own name.
  it('describes what On does for every switch', () => {
    settings({ fullscreenSupported: true });
    for (const row of screen.getAllByRole('switch')) {
      const describedBy = row.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent).toBeTruthy();
    }
  });

  it('sets the tap orientation on the game', () => {
    const dispatch = vi.fn();
    settings({ dispatch });
    fireEvent.click(screen.getByRole('button', { name: 'Vertical taps' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { tapOrientation: 'vertical' },
    });
  });

  it('shows Full screen as an On / Off switch only where the browser can do it', () => {
    const onToggleFullscreen = vi.fn();
    const { unmount } = settings();
    expect(screen.queryByRole('switch', { name: 'Full screen' })).toBeNull();
    unmount();

    settings({ fullscreenSupported: true, isFullscreen: true, onToggleFullscreen });
    const row = screen.getByRole('switch', { name: 'Full screen' });
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(row.textContent).toContain('On');
    fireEvent.click(row);
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('drops the tap zones on a finished table', () => {
    settings({ game: { ...activeGame(), status: 'finished', winnerSeat: 0 } });
    expect(screen.queryByLabelText('Tap zone orientation')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Haptic feedback' })).toBeTruthy();
  });
});

describe('History', () => {
  it('is a one-line empty state before anything has happened', () => {
    render(<HistorySheet game={activeGame()} onClose={vi.fn()} />);
    expect(screen.getByText('Nothing to show yet.')).toBeTruthy();
    expect(screen.queryByText('Key moments')).toBeNull();
    // Nothing to act on, so the dialog itself takes focus (never the ✕).
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'History' }));
  });

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
    render(<HistorySheet game={noisyGame()} onClose={vi.fn()} />);
    expect(screen.getByText('Key moments')).toBeTruthy();
    expect(screen.getAllByText(/eliminated/).length).toBeGreaterThan(0);
    // Each -1 tap is its own row here (5s apart, so grouping can't fold them).
    expect(screen.queryByText('-1')).toBeNull();
  });

  it('reveals the raw log on demand and switches back', () => {
    render(<HistorySheet game={noisyGame()} onClose={vi.fn()} />);
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
    render(<HistorySheet game={game} onClose={vi.fn()} />);
    expect(screen.getByText(/First blood: P1 — P0/)).toBeTruthy();
    const rowFor = (name: string) =>
      [...document.querySelectorAll('.game-stats-row')].find((r) =>
        r.textContent?.startsWith(name)
      );
    expect(rowFor('P1')?.textContent).toContain('12 taken');
    expect(rowFor('P2')?.textContent).toContain('3rd'); // first out of three
    expect(rowFor('P2')?.textContent).toContain('KO by P0');
  });
});

describe('Help', () => {
  const rows = () => [...document.querySelectorAll('.board-help-row')].map((r) => r.textContent);

  it("shows the first-run card's rows, with Pass only while the turn tracker is on", () => {
    const { unmount } = render(
      <HelpSheet vertical={false} showTurnTracker={false} onClose={vi.fn()} />
    );
    expect(rows()).toHaveLength(5);
    expect(rows()[0]).toBe("Tap a seat's left or right half for −1 or +1.");
    unmount();

    render(<HelpSheet vertical showTurnTracker onClose={vi.fn()} />);
    expect(rows()).toHaveLength(6);
    expect(rows()[0]).toContain('bottom or top');
  });

  it('lands focus on Got it, which closes the sheet and counts as seen', () => {
    const onClose = vi.fn();
    render(<HelpSheet vertical={false} showTurnTracker={false} onClose={onClose} />);
    const done = screen.getByRole('button', { name: 'Got it' });
    expect(document.activeElement).toBe(done);
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sc-board-gestures-seen')).toBe('1');
  });
});

describe('Leave', () => {
  const leave = () => {
    const h = { onClose: vi.fn(), onEnd: vi.fn(), onMinimize: vi.fn(), onDiscard: vi.fn() };
    render(<LeaveSheet game={activeGame()} {...h} />);
    return h;
  };

  it('ranks the ways off: End game… primary, Minimize secondary, Discard danger below a divider', () => {
    leave();
    const sheet = screen.getByRole('dialog', { name: 'Leave the board' });
    const body = sheet.querySelector('.board-sheet-body') as HTMLElement;
    const buttons = within(body).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['End game…', 'Minimize', 'Discard game']);
    expect(buttons[0].className).toContain('btn-primary');
    expect(buttons[1].className).not.toMatch(/btn-(primary|danger)/);
    expect(buttons[2].className).toContain('btn-danger');
    expect(sheet.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(sheet.querySelector('.board-sheet-divider + .board-leave-item')?.textContent).toContain(
      'Discard game'
    );
  });

  it('lands focus on End game…', () => {
    leave();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End game…' }));
  });

  it('closes the sheet before handing off to each exit', () => {
    const h = leave();
    fireEvent.click(screen.getByRole('button', { name: 'End game…' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(h.onMinimize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard game' }));
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
  });

  it('states the format and the elapsed game time in its meta line', () => {
    leave();
    expect(document.querySelector('.board-sheet-meta')?.textContent).toMatch(
      /^Commander · \d+:\d{2}/
    );
  });
});
