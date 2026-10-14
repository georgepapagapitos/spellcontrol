import { beforeEach, describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import { setPrices, _resetForTests } from '@/lib/collection/card-prices';
import { deckValue, isProxySlot, ownDeckValue, priceOf, proxyCopyIdsOf } from './deck-value';

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

// The owner's value: a proxy counts 0, a real card counts at market whether
// it's owned or still to buy (the user's ruling, 2026-10-13).
describe('ownDeckValue', () => {
  type OwnPart = Parameters<typeof ownDeckValue>[0];
  const slot = (c: ScryfallCard, extra: Partial<DeckCard> = {}) =>
    ({ card: c, allocatedCopyId: null, ...extra }) as DeckCard;
  const own = (part: Partial<OwnPart>): OwnPart =>
    ({
      commander: null,
      partnerCommander: null,
      commanderAllocatedCopyId: null,
      partnerCommanderAllocatedCopyId: null,
      cards: [],
      ...part,
    }) as OwnPart;

  it('leaves a deck-marked proxy out and reports what it would add', () => {
    const d = own({
      cards: [
        slot(card('Mana Crypt', '180.00', null), { proxy: true }),
        slot(card('Sol Ring', '1.50', null)),
      ],
    });
    expect(ownDeckValue(d, new Set(), 'USD')).toEqual({ value: 1.5, proxied: 180 });
  });

  it('leaves out a slot or commander seat holding a collection proxy copy', () => {
    const d = own({
      commander: card('Kenrith', '5.00', null),
      commanderAllocatedCopyId: 'fake-cmdr',
      cards: [
        slot(card('Mana Crypt', '180.00', null), { allocatedCopyId: 'fake' }),
        slot(card('Sol Ring', '1.50', null), { allocatedCopyId: 'real' }),
      ],
    });
    expect(ownDeckValue(d, new Set(['fake', 'fake-cmdr']), 'USD')).toEqual({
      value: 1.5,
      proxied: 185,
    });
  });

  it('counts a real card whether it is owned or still to buy', () => {
    const d = own({
      cards: [
        slot(card('Owned', '2.00', null), { allocatedCopyId: 'real' }),
        slot(card('To buy', '3.00', null)),
      ],
    });
    expect(ownDeckValue(d, new Set(), 'USD')).toEqual({ value: 5, proxied: 0 });
  });

  it('matches deckValue when there are no proxies', () => {
    const d = own({
      commander: card('Zada', '10.00', '8.00'),
      cards: [slot(card('Goblin Bombardment', '5.00', '4.00'))],
    });
    expect(ownDeckValue(d, new Set(), 'EUR').value).toBe(deckValue(d, 'EUR'));
  });

  it('finds proxy copies by id, and a slot by either flag', () => {
    const ids = proxyCopyIdsOf([
      { copyId: 'a', proxy: true },
      { copyId: 'b' },
      { copyId: 'c', proxy: false },
    ]);
    expect([...ids]).toEqual(['a']);
    expect(isProxySlot({ proxy: true, allocatedCopyId: null }, ids)).toBe(true);
    expect(isProxySlot({ allocatedCopyId: 'a' }, ids)).toBe(true);
    expect(isProxySlot({ allocatedCopyId: 'b' }, ids)).toBe(false);
  });
});
