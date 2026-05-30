// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';

describe('DeckTypeBreakdown', () => {
  const typeCounts = { Creature: 30, Land: 37, Instant: 8, Sorcery: 5 };

  it('renders each type with its count and percentage', () => {
    const { container } = render(<DeckTypeBreakdown typeCounts={typeCounts} />);
    const rows = container.querySelectorAll('.deck-type-breakdown-row');
    expect(rows.length).toBe(4);

    expect(screen.getByText('Creature')).toBeTruthy();
    expect(screen.getByText('Land')).toBeTruthy();

    // Total is 80; Land is 37 → 46.3%, Creature 30 → 37.5%.
    const rowText = (label: string) => {
      const row = Array.from(rows).find(
        (r) => r.querySelector('.deck-type-breakdown-row-name')?.textContent === label
      );
      return row?.textContent ?? '';
    };
    expect(rowText('Land')).toContain('37');
    expect(rowText('Land')).toContain('46.3%');
    expect(rowText('Creature')).toContain('30');
    expect(rowText('Creature')).toContain('37.5%');
  });

  it('orders rows by count descending', () => {
    const { container } = render(<DeckTypeBreakdown typeCounts={typeCounts} />);
    const names = Array.from(container.querySelectorAll('.deck-type-breakdown-row-name')).map(
      (n) => n.textContent
    );
    expect(names).toEqual(['Land', 'Creature', 'Instant', 'Sorcery']);
  });

  it('shows the overall card total', () => {
    render(<DeckTypeBreakdown typeCounts={typeCounts} />);
    expect(screen.getByText('80 cards')).toBeTruthy();
  });

  it('makes a row tappable only when its card list is provided', () => {
    render(
      <DeckTypeBreakdown
        typeCounts={typeCounts}
        cardsByType={{ Creature: [{ name: 'Llanowar Elves', count: 1 }] }}
      />
    );
    // Only Creature has a card list → exactly one tappable row.
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(1);
    expect(screen.getByRole('button', { name: /Show the 30 Creature cards/ })).toBeTruthy();
  });

  it('renders static rows when no card lists are provided', () => {
    render(<DeckTypeBreakdown typeCounts={typeCounts} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('omits zero-count types and shows an empty message when nothing is present', () => {
    const { container } = render(<DeckTypeBreakdown typeCounts={{ Creature: 0 }} />);
    expect(container.querySelectorAll('.deck-type-breakdown-row').length).toBe(0);
    expect(screen.getByText('No cards to break down.')).toBeTruthy();
  });
});
