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

  it('leads with the oracle name when asked, for a decklist', () => {
    const { container } = render(<CardName card={promise} oracleFirst />);
    const [first, , second] = Array.from(container.querySelectorAll('.card-name > span'));
    expect(first.textContent).toBe('Light Up the Stage');
    expect(second.textContent).toBe('A Promise Fulfilled');
    expect(second.className).toBe('card-name-printed');
  });

  // A deck row passes `row`, whose set and collector number come from the
  // owned copy. The stored card was Marvel's renamed Dauthi Voidwalker; the
  // copy in the binder is a plain printing, so no printed name shows.
  it('names the owned printing, not the stored one', () => {
    const stored = { name: 'Dauthi Voidwalker', set: 'mar', collector_number: '63' };
    expect(render(<CardName card={stored} oracleFirst />).container.textContent).toContain(
      'Widow-Making Infiltrator'
    );
    const owned = { name: 'Dauthi Voidwalker', setCode: 'h1r', collectorNumber: '2' };
    expect(render(<CardName card={owned} oracleFirst />).container.innerHTML).toBe(
      'Dauthi Voidwalker'
    );
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

  // A decklist sorts by the oracle name it leads with (2026-09-29); the
  // printed-name sort still holds on collection and binder surfaces.
  it('sort by the oracle name', () => {
    expect(names('')).toEqual(['Abrade', 'Light Up the Stage', 'Lightning Bolt']);
  });

  it('find a flavor-named printing by either name', () => {
    expect(names('promise')).toEqual(['Light Up the Stage']);
    expect(names('light up')).toEqual(['Light Up the Stage']);
  });
});
