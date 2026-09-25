// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckColorPanel } from './DeckColorPanel';

// The panel led with a share-of-deck donut ("57% white", an unlabelled "67"
// in the middle) that answered a question nobody asks. It now leads with the
// deck's colors in words and goes straight to the mana base: each color's
// cards against the sources that make it, every count opening its list.

describe('DeckColorPanel', () => {
  it('names the deck colors in words with the non-land count, and no donut', () => {
    const { container } = render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, B: 0, R: 0, G: 0, C: 4 }, total: 20 }}
        manaProduction={{ counts: { W: 8, U: 5, B: 0, R: 0, G: 0, C: 2 }, total: 15 }}
      />
    );
    expect(screen.getByText('White and blue')).toBeTruthy();
    expect(screen.getByText('20 non-land cards')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText('Distribution')).toBeNull();
  });

  it('reads a one-color deck as mono', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 38, C: 29 }, total: 67 }}
        manaProduction={{ counts: { W: 34, C: 5 }, total: 39 }}
      />
    );
    expect(screen.getByText('Mono-white')).toBeTruthy();
  });

  it('shows each color as cards against sources, colorless included', () => {
    const { container } = render(
      <DeckColorPanel
        colorDist={{ counts: { W: 38, C: 29 }, total: 67 }}
        manaProduction={{ counts: { W: 34, C: 5 }, total: 39 }}
      />
    );
    const rows = Array.from(container.querySelectorAll('.deck-color-balance-row')).map((row) =>
      [
        row.querySelector('.deck-color-balance-row-name')?.textContent,
        ...Array.from(row.querySelectorAll('.deck-color-balance-value')).map((v) => v.textContent),
      ].join(' | ')
    );
    expect(rows).toEqual(['White | 38 cards | 34 sources', 'Colorless | 29 cards | 5 sources']);
  });

  it('opens the sources or the cards behind each count when the lists are known', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, C: 4 }, total: 20 }}
        manaProduction={{
          counts: { W: 8, U: 5, C: 2 },
          total: 15,
          sourcesByColor: {
            W: [
              { name: 'Plains', count: 6 },
              { name: 'Hallowed Fountain', count: 1 },
            ],
            C: [{ name: 'Wastes', count: 2 }],
          },
        }}
        cardsByColor={{ W: [{ name: 'Wrath of God', count: 1 }] }}
      />
    );
    expect(screen.getByRole('button', { name: 'Show the 8 white mana sources' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the 2 colorless mana sources' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the 10 white cards' })).toBeTruthy();
    // Blue has neither list, so its counts stay plain text.
    expect(screen.queryByRole('button', { name: /blue/ })).toBeNull();
  });

  it('keeps the panel static when no lists are provided', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, C: 4 }, total: 20 }}
        manaProduction={{ counts: { W: 8, U: 5, C: 2 }, total: 15 }}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the empty state and no identity line when there is nothing to read', () => {
    const { container } = render(
      <DeckColorPanel
        colorDist={{ counts: {}, total: 0 }}
        manaProduction={{ counts: {}, total: 0 }}
      />
    );
    expect(screen.getByText('No colored mana to balance.')).toBeTruthy();
    expect(container.querySelector('.deck-color-identity')).toBeNull();
  });
});
