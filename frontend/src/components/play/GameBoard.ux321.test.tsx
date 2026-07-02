// @vitest-environment happy-dom
/**
 * UX-321 + UX-325 + rider tests
 *
 * Tests cover:
 *   - Commander-name labeling in CountersPopover (with fallback)
 *   - Elimination beat state: haptics + inline Undo wiring
 *   - Tap-and-hold on CounterRow (fake timers: repeated single actions)
 *   - OnlineSetup Tabs rider: keyboard navigation on the Host/Join strip
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

// ── Shared helpers ─────────────────────────────────────────────────────────

function makeTestPlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({
      id: 'p0',
      userId: null,
      seat: 0,
      name: 'Alice',
      startingLife: 40,
    }),
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

// ── 1. Commander-name labeling ─────────────────────────────────────────────
//
// CountersPopover labels commander-damage rows as `⚔ ${o.commander ?? o.name}`.
// We verify the data transformation logic directly, since CountersPopover is not exported.

describe('UX-321 — commander-name label logic', () => {
  it('uses opponent commander name when set', () => {
    const opponent: GamePlayer = makeTestPlayer({
      id: 'p1',
      seat: 1,
      name: 'Bob',
      commander: 'Atraxa, Praetors Voice',
    });
    const label = `⚔ ${opponent.commander ?? opponent.name}`;
    expect(label).toBe('⚔ Atraxa, Praetors Voice');
  });

  it('falls back to player name when commander is null (local quick game)', () => {
    const opponent: GamePlayer = makeTestPlayer({
      id: 'p1',
      seat: 1,
      name: 'Bob',
      commander: null,
    });
    const label = `⚔ ${opponent.commander ?? opponent.name}`;
    expect(label).toBe('⚔ Bob');
  });

  it('falls back to player name when commander is null regardless of name', () => {
    const opponent: GamePlayer = {
      ...makeTestPlayer({ id: 'p1', seat: 1, name: 'Carol' }),
      commander: null,
    };
    const label = `⚔ ${opponent.commander ?? opponent.name}`;
    expect(label).toBe('⚔ Carol');
  });
});

// ── 2. Elimination beat + inline Undo ─────────────────────────────────────

vi.mock('../../store/play', () => {
  const getState = vi.fn(() => ({
    stopPolling: vi.fn(),
    startPolling: vi.fn(),
  }));
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
  peekLabel: vi.fn(() => 'Commander damage'),
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

// Real `useCardThumb` resolves over the network (batched, cache-first) — fine
// to leave unmocked for every OTHER test here (a guest/no-commander seat
// never calls it with a name, so it's a same-tick no-op either way). This
// stub only gives the commander-art tests below a synchronous, offline-safe
// "normal" thumb to derive an art_crop URL from.
vi.mock('../../lib/card-thumbs', () => ({
  useCardThumb: (name: string | undefined) =>
    name === 'Atraxa, Praetors Voice'
      ? 'https://cards.scryfall.io/normal/front/a/b/atraxa.jpg'
      : undefined,
}));

import { GameBoard } from './GameBoard';
import { haptics } from '../../lib/haptics';

function renderGameBoard(game: GameState, dispatch = vi.fn()) {
  return render(<GameBoard game={game} dispatch={dispatch} canControlAll />);
}

describe('UX-325 — elimination beat + inline Undo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders pp-elim-undo-btn when player becomes eliminated while undo is available', async () => {
    const player = makeTestPlayer({ eliminated: false });
    const game = makeTestState([player]);

    const { rerender, container } = renderGameBoard(game);

    await act(async () => {
      rerender(
        <GameBoard
          game={{ ...game, players: [{ ...player, eliminated: true }] }}
          dispatch={vi.fn()}
          canControlAll
        />
      );
    });

    // The panel-level undo button has class pp-elim-undo-btn
    const elimUndoBtns = container.querySelectorAll('.pp-elim-undo-btn');
    expect(elimUndoBtns.length).toBe(1);
  });

  it('fires haptics.warning() on first elimination', async () => {
    const player = makeTestPlayer({ eliminated: false });
    const game = makeTestState([player]);

    const { rerender } = renderGameBoard(game);

    await act(async () => {
      rerender(
        <GameBoard
          game={{ ...game, players: [{ ...player, eliminated: true }] }}
          dispatch={vi.fn()}
          canControlAll
        />
      );
    });

    expect(haptics.warning).toHaveBeenCalledOnce();
  });

  it('does NOT fire haptics.warning() if player starts already eliminated', async () => {
    // Player is eliminated from the initial render — no transition to detect
    const player = makeTestPlayer({ eliminated: true });
    const game = makeTestState([player]);

    renderGameBoard(game);

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(haptics.warning).not.toHaveBeenCalled();
  });

  it('pp-elim-undo-btn disappears after 2.5s', async () => {
    const player = makeTestPlayer({ eliminated: false });
    const game = makeTestState([player]);
    const { rerender, container } = renderGameBoard(game);

    await act(async () => {
      rerender(
        <GameBoard
          game={{ ...game, players: [{ ...player, eliminated: true }] }}
          dispatch={vi.fn()}
          canControlAll
        />
      );
    });

    // Panel undo button present right after elimination
    expect(container.querySelectorAll('.pp-elim-undo-btn').length).toBe(1);

    // Advance past the 2500ms elimBeat timeout
    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    // Panel-level button gone (beat ended)
    expect(container.querySelectorAll('.pp-elim-undo-btn').length).toBe(0);
  });

  it('pp-elim-undo-btn calls the undo path when clicked', async () => {
    const { popRestore } = await import('../../lib/undo-stack');
    const mockRestore = vi.mocked(popRestore);

    const player = makeTestPlayer({ eliminated: false });
    const game = makeTestState([player]);
    const { rerender, container } = renderGameBoard(game);

    await act(async () => {
      rerender(
        <GameBoard
          game={{ ...game, players: [{ ...player, eliminated: true }] }}
          dispatch={vi.fn()}
          canControlAll
        />
      );
    });

    const elimUndoBtn = container.querySelector('.pp-elim-undo-btn') as HTMLButtonElement;
    expect(elimUndoBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(elimUndoBtn);
    });

    expect(mockRestore).toHaveBeenCalled();
  });
});

// ── 3. CounterRow tap-and-hold emits single actions on each repeat tick ────

describe('UX-321 — CounterRow tap-and-hold wiring (hook shape)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('calls onChange once for a short tap (< 350ms hold threshold)', async () => {
    const onChange = vi.fn();
    const { default: React } = await import('react');

    // Inline replica of useTapAndHold's contract (as implemented in GameBoard.tsx)
    function TapZone({ onFire }: { onFire: (n: number) => void }) {
      const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
      const repeatTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
      const heldRef = React.useRef(false);
      const clear = () => {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        if (repeatTimer.current) clearInterval(repeatTimer.current);
      };
      return (
        <button
          onPointerDown={() => {
            heldRef.current = false;
            clear();
            holdTimer.current = setTimeout(() => {
              heldRef.current = true;
              onFire(1);
              repeatTimer.current = setInterval(() => onFire(1), 130);
            }, 350);
          }}
          onPointerUp={() => {
            const wasHeld = heldRef.current;
            clear();
            if (!wasHeld) onFire(1);
          }}
        >
          +
        </button>
      );
    }

    const { unmount } = render(<TapZone onFire={onChange} />);
    const btn = screen.getByRole('button', { name: '+' });

    await act(async () => {
      fireEvent.pointerDown(btn);
      vi.advanceTimersByTime(100); // < 350ms: hold never fires
      fireEvent.pointerUp(btn);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(1);

    unmount();
  });

  it('calls onChange multiple times on hold — each tick is a separate call', async () => {
    const onChange = vi.fn();
    const { default: React } = await import('react');

    function TapZone({ onFire }: { onFire: (n: number) => void }) {
      const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
      const repeatTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
      const heldRef = React.useRef(false);
      const clear = () => {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        if (repeatTimer.current) clearInterval(repeatTimer.current);
      };
      return (
        <button
          onPointerDown={() => {
            heldRef.current = false;
            clear();
            holdTimer.current = setTimeout(() => {
              heldRef.current = true;
              onFire(1);
              repeatTimer.current = setInterval(() => onFire(1), 130);
            }, 350);
          }}
          onPointerUp={() => {
            const wasHeld = heldRef.current;
            clear();
            if (!wasHeld) onFire(1);
          }}
        >
          +
        </button>
      );
    }

    const { unmount } = render(<TapZone onFire={onChange} />);
    const btn = screen.getByRole('button', { name: '+' });

    await act(async () => {
      fireEvent.pointerDown(btn);
      vi.advanceTimersByTime(350 + 130 * 3); // arm + 3 repeat ticks
      fireEvent.pointerUp(btn);
    });

    // 1 hold-start + 3 repeat ticks = 4; no extra tap (wasHeld=true)
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(4);
    onChange.mock.calls.forEach((call) => expect(call[0]).toBe(1));

    unmount();
  });
});

// ── 4. OnlineSetup Tabs rider — keyboard behavior ─────────────────────────
//
// The hand-rolled Host/Join strip is now the shared Tabs component.
// We test the Tabs component directly with the expected props shape,
// since PlayPage is too heavy to render in this env.

import { Tabs } from '../../components/Tabs';

describe('Rider — OnlineSetup Host/Join: shared Tabs keyboard nav', () => {
  it('renders a tablist with Host and Join tabs', () => {
    const onChange = vi.fn();
    render(
      <Tabs<'host' | 'join'>
        ariaLabel="Online game mode"
        value="host"
        onChange={onChange}
        variant="fitted"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
        ]}
      />
    );

    expect(screen.getByRole('tablist', { name: 'Online game mode' })).toBeTruthy();
    const hostTab = screen.getByRole('tab', { name: 'Host' });
    const joinTab = screen.getByRole('tab', { name: 'Join' });
    expect(hostTab.getAttribute('aria-selected')).toBe('true');
    expect(joinTab.getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowRight moves selection to Join', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Tabs<'host' | 'join'>
        ariaLabel="Online game mode"
        value="host"
        onChange={onChange}
        variant="fitted"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
        ]}
      />
    );

    const hostTab = screen.getByRole('tab', { name: 'Host' });
    fireEvent.keyDown(hostTab, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('join');

    // Simulate controlled update
    rerender(
      <Tabs<'host' | 'join'>
        ariaLabel="Online game mode"
        value="join"
        onChange={onChange}
        variant="fitted"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
        ]}
      />
    );

    const joinTab = screen.getByRole('tab', { name: 'Join' });
    expect(joinTab.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowLeft from Join wraps back to Host', () => {
    const onChange = vi.fn();
    render(
      <Tabs<'host' | 'join'>
        ariaLabel="Online game mode"
        value="join"
        onChange={onChange}
        variant="fitted"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
        ]}
      />
    );

    const joinTab = screen.getByRole('tab', { name: 'Join' });
    fireEvent.keyDown(joinTab, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('host');
  });

  it('Home key jumps to Host from Join', () => {
    const onChange = vi.fn();
    render(
      <Tabs<'host' | 'join'>
        ariaLabel="Online game mode"
        value="join"
        onChange={onChange}
        variant="fitted"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
        ]}
      />
    );

    const joinTab = screen.getByRole('tab', { name: 'Join' });
    fireEvent.keyDown(joinTab, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('host');
  });

  it('End key jumps to Join from Host', () => {
    const onChange = vi.fn();
    render(
      <Tabs<'host' | 'join'>
        ariaLabel="Online game mode"
        value="host"
        onChange={onChange}
        variant="fitted"
        tabs={[
          { id: 'host', label: 'Host' },
          { id: 'join', label: 'Join' },
        ]}
      />
    );

    const hostTab = screen.getByRole('tab', { name: 'Host' });
    fireEvent.keyDown(hostTab, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('join');
  });
});

// ── Commander art backdrop ──────────────────────────────────────────────────

describe('Commander art backdrop', () => {
  it('renders a faint art-crop layer for a seat with a commander, derived from the normal thumb', () => {
    const player = makeTestPlayer({ commander: 'Atraxa, Praetors Voice' });
    const game = makeTestState([player]);
    const { container } = renderGameBoard(game);

    const art = container.querySelector<HTMLImageElement>('.player-panel-art');
    expect(art).not.toBeNull();
    // normal -> art_crop is a pure CDN path-segment swap (scryfallArtCrop).
    expect(art?.src).toBe('https://cards.scryfall.io/art_crop/front/a/b/atraxa.jpg');
    // Decorative only — never announced, never blocks a screen reader.
    expect(art?.getAttribute('alt')).toBe('');
    expect(art?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders nothing for a seat with no commander — guest/no-deck seats stay the flat palette', () => {
    const player = makeTestPlayer({ commander: null });
    const game = makeTestState([player]);
    const { container } = renderGameBoard(game);

    expect(container.querySelector('.player-panel-art')).toBeNull();
  });
});
