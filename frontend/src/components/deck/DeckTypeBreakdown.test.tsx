// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';

describe('DeckTypeBreakdown', () => {
  const typeCounts = { Creature: 30, Land: 37, Instant: 8, Sorcery: 5 };

  it('renders each type with its count, and no percentage beside it', () => {
    const { container } = render(<DeckTypeBreakdown typeCounts={typeCounts} />);
    const rows = container.querySelectorAll('.deck-type-breakdown-row');
    expect(rows.length).toBe(4);

    expect(screen.getByText('Creature')).toBeTruthy();
    expect(screen.getByText('Land')).toBeTruthy();

    // A 100-card deck read "35 · 35.0%"; the bar already shows the share.
    const rowText = (label: string) => {
      const row = Array.from(rows).find(
        (r) => r.querySelector('.deck-type-breakdown-row-name')?.textContent === label
      );
      return row?.textContent ?? '';
    };
    expect(rowText('Land')).toContain('37');
    expect(rowText('Land')).not.toContain('%');
    expect(rowText('Creature')).toContain('30');
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

  // Types said Creature 15 while the list said Creature 14: the list files the
  // commander on its own, the counts filed it as a creature.
  it('shows the command zone as its own Commander row, out of its card type', () => {
    const commander = {
      name: 'Sram, Senior Edificer',
      type_line: 'Legendary Creature — Dwarf Advisor',
    } as unknown as ScryfallCard;
    const { container } = render(
      <DeckTypeBreakdown
        typeCounts={{ Creature: 15, Land: 35 }}
        cardsByType={{
          Creature: [
            { name: 'Sram, Senior Edificer', count: 1 },
            { name: 'Auriok Steelshaper', count: 14 },
          ],
        }}
        commandZone={[commander]}
      />
    );
    const names = Array.from(container.querySelectorAll('.deck-type-breakdown-row')).map((r) =>
      Array.from(
        r.querySelectorAll('.deck-type-breakdown-row-name, .deck-type-breakdown-row-count')
      )
        .map((n) => n.textContent)
        .join(' ')
    );
    expect(names).toEqual(['Commander 1', 'Land 35', 'Creature 14']);
    expect(screen.getByText('50 cards')).toBeTruthy();
  });
});
