// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { GameLogEntry } from '@/lib/playtest/game-log';
import type { TickerItem } from '@/store/play';
import { PlaytestLogSheet } from './PlaytestLogSheet';

const log: GameLogEntry[] = [
  { seq: 1, turn: 1, kind: 'turn', text: 'Turn 1 begins' },
  { seq: 2, turn: 1, kind: 'draw', text: 'Drew 7 cards' },
];

const tableItems: TickerItem[] = [
  { id: 1, seat: 1, entry: { seq: 1, kind: 'play', text: 'Sol Ring played from hand' } },
  { id: 2, seat: 0, entry: { seq: 1, kind: 'draw', text: 'Drew 1 card' } },
];

const nameFor = (seat: number) => (seat === 0 ? 'You' : 'Maya');

describe('PlaytestLogSheet — Table tab', () => {
  it('renders no tab strip in solo playtest (no table prop)', () => {
    render(<PlaytestLogSheet log={log} onClose={() => {}} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Drew 7 cards')).toBeTruthy();
  });

  it('shows the You/Table strip when seated online and defaults to the own log', () => {
    render(
      <PlaytestLogSheet log={log} table={{ items: tableItems, nameFor }} onClose={() => {}} />
    );
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByText('Drew 7 cards')).toBeTruthy();
    expect(screen.queryByText('Sol Ring played from hand')).toBeNull();
  });

  it('the Table tab lists the feed newest-first with seat names', () => {
    render(
      <PlaytestLogSheet log={log} table={{ items: tableItems, nameFor }} onClose={() => {}} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    const lines = screen.getAllByRole('listitem').map((li) => li.textContent);
    // Newest (id 2, own draw) first.
    expect(lines[0]).toContain('You');
    expect(lines[0]).toContain('Drew 1 card');
    expect(lines[1]).toContain('Maya');
    expect(lines[1]).toContain('Sol Ring played from hand');
    // The own-log copy affordance belongs to the own view only.
    expect(screen.queryByRole('button', { name: 'Copy log' })).toBeNull();
  });

  it('the Table tab shows an empty state before any table line arrives', () => {
    render(<PlaytestLogSheet log={log} table={{ items: [], nameFor }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByText('No table activity yet.')).toBeTruthy();
  });
});
