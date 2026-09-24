// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayStore, type TickerItem } from '@/store/play';
import type { PublicBoard, TickerEntry } from '@/lib/playtest/projection';
import type { GamePlayer } from '@/lib/game-state';
import type { OnlineTable } from '../hooks/use-online-table';
import { GLANCE_QUERY } from './OpponentRail';
import { TableTicker, TableTickerDock, tickerSeatName } from './TableTicker';

/**
 * The rail's own test-stub lesson (see project history): a matchMedia stub
 * that can't express the exact query being gated on hides regressions.
 * This one matches on the full GLANCE_QUERY string, so a drift between the
 * ticker's gate and the rail's shows up as a failing test, not silence.
 */
function mockGlance(glance: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === GLANCE_QUERY ? glance : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}

function board(seat: number): PublicBoard {
  return { seat } as unknown as PublicBoard;
}

function fakePlayer(seat: number, name = 'Me'): GamePlayer {
  return {
    id: `p${seat}`,
    userId: `u${seat}`,
    seat,
    name,
    deckId: null,
    deckName: null,
    commander: null,
    partner: null,
    colorIdentity: [],
    panelColorKey: null,
    life: 40,
    poison: 0,
    commanderDamage: {},
    eliminated: false,
    isHost: false,
    connected: true,
  };
}

function table(overrides: Partial<OnlineTable> = {}): OnlineTable {
  return {
    activeSeat: null,
    mySeat: 0,
    isHost: false,
    me: fakePlayer(0),
    players: [fakePlayer(0), fakePlayer(1, 'Maya'), fakePlayer(2, 'Rin')],
    phase: undefined,
    poisonEnabled: false,
    commanderDamageEnabled: false,
    mulliganType: 'commander' as const,
    turnTimerEnabled: false,
    turnStartedAt: null,
    designations: { monarch: null, initiative: null },
    dispatch: () => {},
    opponents: [
      { name: 'Maya', board: board(1) },
      { name: 'Rin', board: board(2) },
    ],
    ...overrides,
  };
}

let nextId = 1;
function item(seat: number, entry: Partial<TickerEntry> = {}): TickerItem {
  return {
    id: nextId++,
    seat,
    kind: 'play',
    entry: { seq: nextId, kind: 'play', text: `played something #${nextId}`, ...entry },
  };
}

beforeEach(() => {
  nextId = 1;
  usePlayStore.setState({ onlineTicker: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tickerSeatName', () => {
  it('labels the own seat You, opponents by roster name, unknown seats by number', () => {
    const t = table();
    expect(tickerSeatName(t, 0)).toBe('You');
    expect(tickerSeatName(t, 1)).toBe('Maya');
    expect(tickerSeatName(t, 3)).toBe('Seat 4');
  });
});

describe('TableTicker — glance density', () => {
  it('renders nothing (the feed lives behind TableTickerDock now)', () => {
    mockGlance(true);
    const { container } = render(<TableTicker onlineTable={table()} />);
    expect(container.innerHTML).toBe('');
  });
});

/**
 * The toggle is controlled by the board: `open` is whether the log dock is
 * open. It carries no panel of its own any more (the log dock's Table view
 * is the one feed and the one composer), so these pin the button's contract:
 * it toggles, it reads pressed while the log is open, and it counts unread
 * lines from other seats only while the log is shut.
 */
describe('TableTickerDock', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <TableTickerDock onlineTable={table()} open={open} onToggle={() => setOpen((o) => !o)} />
    );
  }

  function arrive(seat: number, text: string) {
    act(() => {
      usePlayStore.setState((s) => ({ onlineTicker: [...s.onlineTicker, item(seat, { text })] }));
    });
  }

  it('starts closed with a plain label and no badge', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Table log' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders no feed of its own: the log dock holds the only one', () => {
    usePlayStore.setState({ onlineTicker: [item(1, { text: 'Sol Ring played from hand' })] });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Table log' }));
    expect(screen.getByRole('button', { name: 'Table log' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(screen.queryByText('Sol Ring played from hand')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('asks the board to toggle the log', () => {
    const onToggle = vi.fn();
    render(<TableTickerDock onlineTable={table()} open={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table log' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not count backlog already in the feed at mount', () => {
    usePlayStore.setState({ onlineTicker: [item(1, { text: 'old backlog line' })] });
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Table log' })).toBeTruthy();
  });

  it('counts lines that arrive from other seats while closed, and the label carries the count', () => {
    render(<Harness />);
    arrive(1, 'Maya untapped everything');
    expect(screen.getByRole('button', { name: 'Table log, 1 unread' })).toBeTruthy();
    arrive(2, 'Rin drew a card');
    expect(screen.getByRole('button', { name: 'Table log, 2 unread' })).toBeTruthy();
  });

  it("never counts the viewer's own seat lines as unread", () => {
    render(<Harness />);
    arrive(0, 'You played a land');
    expect(screen.getByRole('button', { name: 'Table log' })).toBeTruthy();
  });

  it('reads zero while the log is open, and lines seen while open stay read after it closes', () => {
    render(<Harness />);
    arrive(1, 'Maya untapped everything');
    fireEvent.click(screen.getByRole('button', { name: 'Table log, 1 unread' }));
    arrive(1, 'Maya cast a spell');
    expect(screen.getByRole('button', { name: 'Table log' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Table log' }));
    expect(screen.getByRole('button', { name: 'Table log' }).getAttribute('aria-expanded')).toBe(
      'false'
    );
    arrive(2, 'Rin drew a card');
    expect(screen.getByRole('button', { name: 'Table log, 1 unread' })).toBeTruthy();
  });

  it('reads as open when the log was opened some other way (L, the game menu)', () => {
    render(<TableTickerDock onlineTable={table()} open onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Table log' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
  });
});

describe('TableTicker — presence flash', () => {
  it('never replays backlog on mount, then flashes a newly arrived opponent line', () => {
    mockGlance(false);
    usePlayStore.setState({ onlineTicker: [item(1, { text: 'old backlog line' })] });
    render(<TableTicker onlineTable={table()} />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      usePlayStore.setState((s) => ({
        onlineTicker: [...s.onlineTicker, item(1, { text: 'Lightning Bolt played from hand' })],
      }));
    });
    const flash = screen.getByRole('status');
    expect(flash.textContent).toContain('Maya');
    expect(flash.textContent).toContain('Lightning Bolt played from hand');
  });

  it('does not flash the own seat lines (you just did the thing)', () => {
    mockGlance(false);
    render(<TableTicker onlineTable={table()} />);
    act(() => {
      usePlayStore.setState((s) => ({
        onlineTicker: [...s.onlineTicker, item(0, { text: 'own action' })],
      }));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('auto-dismisses after the flash window, and a newer line resets the timer', () => {
    vi.useFakeTimers();
    mockGlance(false);
    render(<TableTicker onlineTable={table()} />);
    act(() => {
      usePlayStore.setState((s) => ({
        onlineTicker: [...s.onlineTicker, item(1, { text: 'first line' })],
      }));
    });
    expect(screen.getByRole('status')).toBeTruthy();

    // A second line lands mid-window: the flash swaps content and the
    // 5s dismiss restarts from the swap, not the first line's arrival.
    act(() => {
      vi.advanceTimersByTime(3000);
      usePlayStore.setState((s) => ({
        onlineTicker: [...s.onlineTicker, item(2, { text: 'second line' })],
      }));
    });
    expect(screen.getByRole('status').textContent).toContain('second line');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
