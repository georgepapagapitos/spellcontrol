// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameLogEntry } from '@/lib/playtest/game-log';
import type { TickerItem } from '@/store/play';
import { useToastsStore } from '@/store/toasts';
import { LogDock } from './LogDock';

const log: GameLogEntry[] = [
  { seq: 1, turn: 1, kind: 'turn', text: 'Turn 1 begins' },
  { seq: 2, turn: 1, kind: 'draw', text: 'Drew 7 cards' },
  { seq: 3, turn: 2, kind: 'turn', text: 'Turn 2 begins' },
  { seq: 4, turn: 2, kind: 'play', text: 'Sol Ring played from hand' },
  { seq: 5, turn: 2, kind: 'life', text: 'Your life: 40 → 37' },
];

const tableItems: TickerItem[] = [
  {
    id: 1,
    seat: 1,
    kind: 'play',
    entry: { seq: 1, kind: 'play', text: 'Sol Ring played from hand' },
  },
];

const nameFor = (seat: number) => (seat === 0 ? 'You' : 'Maya');

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  writeText.mockClear();
  localStorage.clear();
  useToastsStore.getState().clear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('LogDock', () => {
  it('renders entries oldest first under their turn divider', () => {
    render(<LogDock log={log} onClose={() => {}} />);
    const text = screen.getByRole('region', { name: 'Game log' }).textContent ?? '';
    expect(text.indexOf('Turn 1')).toBeLessThan(text.indexOf('Drew 7 cards'));
    expect(text.indexOf('Drew 7 cards')).toBeLessThan(text.indexOf('Turn 2'));
    expect(text.indexOf('Turn 2')).toBeLessThan(text.indexOf('Sol Ring played from hand'));
    // The divider carries the turn, so the 'turn' entry is not also a bubble.
    expect(screen.queryByText('Turn 1 begins')).toBeNull();
  });

  it('a filter chip narrows the list and is remembered', () => {
    const { unmount } = render(<LogDock log={log} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Life' }));
    expect(screen.getByText('Your life: 40 → 37')).toBeTruthy();
    expect(screen.queryByText('Sol Ring played from hand')).toBeNull();
    expect(localStorage.getItem('spellcontrol:playtest:log-filter')).toBe('life');

    unmount();
    render(<LogDock log={log} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Life' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Drew 7 cards')).toBeNull();
  });

  it('offers the Table chip only when seated at an online table', () => {
    const { unmount } = render(<LogDock log={log} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    unmount();

    render(<LogDock log={log} table={{ items: tableItems, nameFor }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByText('Maya')).toBeTruthy();
  });

  it('copies the log and says so', async () => {
    render(<LogDock log={log} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Drew 7 cards');
    await waitFor(() =>
      expect(useToastsStore.getState().toasts[0]?.message).toBe('Game log copied to clipboard.')
    );
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(<LogDock log={log} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close log' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape inside the dock, and ignores Escape aimed at the board', () => {
    const onClose = vi.fn();
    render(<LogDock log={log} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close log' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the empty states', () => {
    const { unmount } = render(<LogDock log={[]} onClose={() => {}} />);
    expect(screen.getByText('Nothing logged yet.')).toBeTruthy();
    unmount();

    render(<LogDock log={[]} table={{ items: [], nameFor }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByText('No table activity yet.')).toBeTruthy();
  });

  it('offers a pop-out window only when given the route, and opens it as a named popup', () => {
    const open = vi.fn();
    Object.defineProperty(window, 'open', { value: open, configurable: true });
    const { rerender } = render(<LogDock log={log} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open the log in its own window' })).toBeNull();
    rerender(<LogDock log={log} onClose={() => {}} popoutHref="/decks/d1/playtest/log" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the log in its own window' }));
    expect(open).toHaveBeenCalledWith(
      '/decks/d1/playtest/log',
      'spellcontrol-playtest-log',
      expect.stringContaining('popup')
    );
  });

  it('renders the page variant as a full-window panel with no pop-out of its own', () => {
    render(<LogDock log={log} onClose={() => {}} variant="page" />);
    const region = screen.getByRole('region', { name: 'Game log' });
    expect(region.className).toContain('playtest-log-dock--page');
    expect(screen.queryByRole('button', { name: 'Open the log in its own window' })).toBeNull();
  });
});

// The phase strip: five icons, the current one lit; buttons on your turn only.
describe('LogDock — phase strip', () => {
  it('is absent off the table and read-only on someone else’s turn', () => {
    const { unmount } = render(<LogDock log={log} onClose={() => {}} />);
    expect(screen.queryByLabelText(/^Phase:/)).toBeNull();
    unmount();
    render(
      <LogDock
        log={log}
        onClose={() => {}}
        phase={{ current: 'combat', mine: false, onSet: () => {} }}
      />
    );
    const strip = screen.getByRole('status', { name: 'Phase: Combat phase' });
    expect(strip).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Combat phase' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Combat phase' }).className).toContain('is-current');
  });

  it('on your turn each icon sets the clock to that phase', () => {
    const onSet = vi.fn();
    render(
      <LogDock log={log} onClose={() => {}} phase={{ current: 'main1', mine: true, onSet }} />
    );
    const main1 = screen.getByRole('button', { name: 'First main phase' });
    expect(main1.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'End phase' }));
    expect(onSet).toHaveBeenCalledWith('end');
  });

  it('reads as unlit before the clock starts', () => {
    render(
      <LogDock
        log={log}
        onClose={() => {}}
        phase={{ current: undefined, mine: false, onSet: () => {} }}
      />
    );
    expect(screen.getByRole('status', { name: 'The phase clock has not started' })).toBeTruthy();
  });
});
