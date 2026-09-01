// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayStore, type TickerItem } from '@/store/play';
import type { PublicBoard, TickerEntry } from '@/lib/playtest/projection';
import type { OnlineTable } from '../hooks/use-online-table';
import { GLANCE_QUERY } from './OpponentRail';
import { TableTicker, tickerSeatName } from './TableTicker';

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

function table(overrides: Partial<OnlineTable> = {}): OnlineTable {
  return {
    activeSeat: null,
    mySeat: 0,
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

describe('TableTicker — glance panel', () => {
  it('renders the feed with seat names and line text', () => {
    mockGlance(true);
    usePlayStore.setState({
      onlineTicker: [
        item(1, { text: 'Sol Ring played from hand' }),
        item(0, { text: 'Drew 1 card' }),
      ],
    });
    render(<TableTicker onlineTable={table()} />);
    expect(screen.getByRole('log')).toBeTruthy();
    expect(screen.getByText('Sol Ring played from hand')).toBeTruthy();
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('Drew 1 card')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('shows the empty state before any line arrives', () => {
    mockGlance(true);
    render(<TableTicker onlineTable={table()} />);
    expect(screen.getByText('Plays and messages will appear here.')).toBeTruthy();
    expect(screen.queryByRole('log')).toBeNull();
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
