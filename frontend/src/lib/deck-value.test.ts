import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import { deckValue } from './deck-value';

function card(name: string, usd: string | null, eur: string | null): ScryfallCard {
  return { name, prices: { usd, eur } } as unknown as ScryfallCard;
}

type DeckPart = Pick<Deck, 'commander' | 'partnerCommander' | 'cards'>;

function deck(part: Partial<DeckPart>): DeckPart {
  return { cards: [], ...part } as DeckPart;
}

const cards = (...cs: ScryfallCard[]) => cs.map((c) => ({ card: c })) as DeckPart['cards'];

describe('deckValue', () => {
  it('counts both commanders as well as the mainboard', () => {
    const d = deck({
      commander: card('Haldan', '2.00', null),
      partnerCommander: card('Pako', '3.00', null),
      cards: cards(card('Sol Ring', '1.50', null), card('Arcane Signet', '0.50', null)),
    });
    expect(deckValue(d, 'USD')).toBe(7);
  });

  // The regression: the index and the owner's hero summed USD whatever the
  // currency, so a EUR viewer read a dollar total under a euro sign.
  it('prices in the currency it is given', () => {
    const d = deck({
      commander: card('Zada', '10.00', '8.00'),
      cards: cards(card('Goblin Bombardment', '5.00', '4.00')),
    });
    expect(deckValue(d, 'USD')).toBe(15);
    expect(deckValue(d, 'EUR')).toBe(12);
  });

  it('reads an unpriced card as zero, never NaN', () => {
    const d = deck({ cards: cards(card('Obscure Promo', null, null), card('Opt', '0.25', null)) });
    expect(deckValue(d, 'USD')).toBe(0.25);
  });

  it('is zero for an empty deck', () => {
    expect(deckValue(deck({}), 'USD')).toBe(0);
  });
});
