import { describe, expect, it } from 'vitest';
import type { Deck } from '../store/decks';
import { deckPickerLabels } from './deck-picker-labels';

function deck(over: Partial<Deck> & { id: string }): Deck {
  return {
    name: 'Abigale',
    format: 'commander',
    commander: { name: 'Abigale, Eloquent First-Year' } as Deck['commander'],
    cards: Array.from({ length: 99 }, (_, i) => ({ name: `c${i}`, quantity: 1 })),
    createdAt: 1_785_474_403_367,
    updatedAt: 1_785_474_403_367,
    ...over,
  } as Deck;
}

describe('deckPickerLabels', () => {
  it('leaves unique decks alone', () => {
    expect(
      deckPickerLabels([
        deck({ id: 'a' }),
        deck({
          id: 'b',
          name: 'Krenko',
          commander: { name: 'Krenko, Mob Boss' } as Deck['commander'],
        }),
      ])
    ).toEqual(['Abigale · Abigale, Eloquent First-Year', 'Krenko · Krenko, Mob Boss']);
  });

  it('never returns two identical rows, even for generated decks that share name, commander, size and day', () => {
    // The dev account's four Abigales, as measured in playtest batch 7: all 99
    // cards, so the card count alone left four identical rows.
    const sameDay = 1_785_474_403_367;
    const labels = deckPickerLabels([
      deck({ id: 'a', updatedAt: sameDay }),
      deck({ id: 'b', updatedAt: sameDay + 60_000 }),
      deck({ id: 'c', updatedAt: sameDay + 7 * 86_400_000 }),
      deck({ id: 'd', cards: [{ quantity: 1 }] as unknown as Deck['cards'] }),
    ]);
    expect(new Set(labels).size).toBe(4);
    // the 1-card deck is told apart by its size alone …
    expect(labels[3]).toBe('Abigale · Abigale, Eloquent First-Year · 1 cards');
    // … the two same-day 99-card decks get the date AND a number, the other day only the date
    expect(labels[0]).toMatch(/· 99 cards · edited .+ \(1\)$/);
    expect(labels[1]).toMatch(/· 99 cards · edited .+ \(2\)$/);
    expect(labels[2]).toMatch(/· 99 cards · edited .+$/);
    expect(labels[2]).not.toMatch(/\(\d\)$/);
  });
});
