import { beforeEach, describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import { setPrices, _resetForTests } from '@/lib/collection/card-prices';
import { deckValue, priceOf } from './deck-value';

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

describe('priceOf reprices on read', () => {
  const frozen = {
    id: 'abc',
    name: 'Sol Ring',
    prices: { usd: '1.00', eur: '0.80' },
  } as unknown as ScryfallCard;

  beforeEach(() => {
    localStorage.clear();
    _resetForTests();
  });

  it('prefers the device price cache over the frozen price', () => {
    setPrices({ abc: { usd: 3, eur: 2.5, pricedAt: 1 } });
    expect(priceOf(frozen, 'USD')).toBe(3);
    expect(priceOf(frozen, 'EUR')).toBe(2.5);
  });

  it('falls back to the frozen price when the cache has nothing usable', () => {
    expect(priceOf(frozen, 'USD')).toBe(1);
    setPrices({ abc: { usd: 0, pricedAt: 1 } });
    expect(priceOf(frozen, 'USD')).toBe(1);
    expect(priceOf(frozen, 'EUR')).toBe(0.8);
  });

  it('feeds deckValue so the index and hero agree', () => {
    setPrices({ abc: { usd: 3, pricedAt: 1 } });
    expect(deckValue(deck({ cards: cards(frozen) }), 'USD')).toBe(3);
  });
});
