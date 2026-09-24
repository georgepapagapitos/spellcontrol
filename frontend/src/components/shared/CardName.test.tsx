// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { applyFilterSort, type Row } from '@/components/deck/deck-display-rows';
import { CardName } from './CardName';

// The Final Fantasy "through the ages" Light Up the Stage prints "A Promise Fulfilled".
const promise = { name: 'Light Up the Stage', set: 'fca', collector_number: '39' };

describe('CardName', () => {
  it('leads with the printed name and keeps the oracle name alongside', () => {
    const { container } = render(<CardName card={promise} />);
    expect(container.querySelector('.card-name-printed')?.textContent).toBe('A Promise Fulfilled');
    expect(container.querySelector('.card-name-oracle')?.textContent).toBe('Light Up the Stage');
  });

  it('renders a card without a flavor name as its bare name', () => {
    const { container } = render(
      <CardName card={{ name: 'Lightning Bolt', set: 'lea', collector_number: '161' }} />
    );
    expect(container.innerHTML).toBe('Lightning Bolt');
  });
});

function row(card: Partial<ScryfallCard> & { name: string }): Row {
  return { name: card.name, qty: 1, tags: [], card } as unknown as Row;
}

describe('deck list rows', () => {
  const rows = [
    row({ name: 'Lightning Bolt', set: 'lea', collector_number: '161' }),
    row(promise),
    row({ name: 'Abrade', set: 'dmu', collector_number: '114' }),
  ];
  const names = (search: string) =>
    applyFilterSort([{ title: 'Instant', icon: '', rows }], search, 'name', 'asc')[0].rows.map(
      (r) => r.name
    );

  it('sort by the name printed on the card', () => {
    expect(names('')).toEqual(['Light Up the Stage', 'Abrade', 'Lightning Bolt']);
  });

  it('find a flavor-named printing by either name', () => {
    expect(names('promise')).toEqual(['Light Up the Stage']);
    expect(names('light up')).toEqual(['Light Up the Stage']);
  });
});
