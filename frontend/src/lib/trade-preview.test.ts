import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { TradeCard } from './trades-client';

const getCardById = vi.fn();
vi.mock('./api', () => ({ getCardById: (id: string) => getCardById(id) }));

const getCardsByNames = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: (names: string[]) => getCardsByNames(names),
}));

import { resolveTradePreview } from './trade-preview';

function scry(over: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '1',
    rarity: 'rare',
    type_line: 'Artifact',
    cmc: 1,
    image_uris: { normal: 'n.jpg', small: 's.jpg', large: 'l.jpg', art_crop: 'a.jpg' },
    ...over,
  } as ScryfallCard;
}

function tradeCard(over: Partial<TradeCard> & { name: string }): TradeCard {
  return { oracleId: `o-${over.name}`, quantity: 1, copies: [], ...over };
}

beforeEach(() => {
  getCardById.mockReset();
  getCardsByNames.mockReset();
  getCardsByNames.mockResolvedValue(new Map());
});

describe('resolveTradePreview', () => {
  it('prefers the EXACT pinned printing over a by-name lookup', async () => {
    // A proposer's side is pinned from the moment it is sent — the carousel
    // should show the card actually crossing the table, not Scryfall's default.
    getCardById.mockResolvedValue(scry({ id: 'lea-233', name: 'Sol Ring', set: 'lea' }));
    const card = tradeCard({
      name: 'Sol Ring',
      copies: [{ scryfallId: 'lea-233', finish: 'foil' }],
    });

    const { cards } = await resolveTradePreview([card]);

    expect(getCardById).toHaveBeenCalledWith('lea-233');
    expect(cards[0].scryfallId).toBe('lea-233');
    // The finish rides along, so a foil renders as the foil it is.
    expect(cards[0].finish).toBe('foil');
  });

  it('falls back to the card BY NAME when its pinned printing no longer resolves', async () => {
    // An old offer whose printing Scryfall later merged away, or a cold cache.
    // Dropping the card would make the tapped chip open someone else's card —
    // a different printing of the right card is strictly better.
    getCardById.mockResolvedValue(null);
    getCardsByNames.mockResolvedValue(
      new Map([['Arcane Signet', scry({ id: 'other-print', name: 'Arcane Signet' })]])
    );
    const card = tradeCard({
      name: 'Arcane Signet',
      copies: [{ scryfallId: 'gone', finish: 'nonfoil' }],
    });

    const { cards, indexOf } = await resolveTradePreview([card]);

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Arcane Signet');
    expect(indexOf(card)).toBe(0);
  });

  it('falls back to one batched by-name call for an unresolved ask side', async () => {
    getCardsByNames.mockResolvedValue(
      new Map([
        ['Rhystic Study', scry({ id: 'r1', name: 'Rhystic Study' })],
        ['Sol Ring', scry({ id: 's1', name: 'Sol Ring' })],
      ])
    );

    const { cards } = await resolveTradePreview([
      tradeCard({ name: 'Rhystic Study' }),
      tradeCard({ name: 'Sol Ring' }),
    ]);

    // One call for the whole offer, not one per card.
    expect(getCardsByNames).toHaveBeenCalledTimes(1);
    expect(getCardsByNames).toHaveBeenCalledWith(['Rhystic Study', 'Sol Ring']);
    expect(cards.map((c) => c.name)).toEqual(['Rhystic Study', 'Sol Ring']);
  });

  it('drops a card it cannot resolve, and indexOf still finds the others', async () => {
    // A slide with no art is worse than one fewer slide — but a naive
    // positional index would then open the WRONG card.
    getCardsByNames.mockResolvedValue(
      new Map([['Sol Ring', scry({ id: 's1', name: 'Sol Ring' })]])
    );
    const missing = tradeCard({ name: 'Nonexistent' });
    const present = tradeCard({ name: 'Sol Ring' });

    const { cards, indexOf } = await resolveTradePreview([missing, present]);

    expect(cards).toHaveLength(1);
    expect(indexOf(present)).toBe(0);
    expect(indexOf(missing)).toBe(-1);
  });

  it('survives a lookup that throws rather than failing the whole carousel', async () => {
    getCardById.mockRejectedValue(new Error('offline'));
    getCardsByNames.mockResolvedValue(
      new Map([['Sol Ring', scry({ id: 's1', name: 'Sol Ring' })]])
    );

    const { cards } = await resolveTradePreview([
      tradeCard({ name: 'Broken', copies: [{ scryfallId: 'boom', finish: 'nonfoil' }] }),
      tradeCard({ name: 'Sol Ring' }),
    ]);

    expect(cards.map((c) => c.name)).toEqual(['Sol Ring']);
  });

  it('returns nothing when the batched name lookup itself fails', async () => {
    getCardsByNames.mockRejectedValue(new Error('network'));
    const { cards } = await resolveTradePreview([tradeCard({ name: 'Sol Ring' })]);
    expect(cards).toEqual([]);
  });

  it('keeps give-then-get order so a swipe crosses the whole deal', async () => {
    getCardsByNames.mockResolvedValue(
      new Map([
        ['Give', scry({ id: 'g', name: 'Give' })],
        ['Get', scry({ id: 'r', name: 'Get' })],
      ])
    );
    const { cards, indexOf } = await resolveTradePreview([
      tradeCard({ name: 'Give' }),
      tradeCard({ name: 'Get' }),
    ]);
    expect(cards.map((c) => c.name)).toEqual(['Give', 'Get']);
    expect(indexOf(tradeCard({ name: 'Get' }))).toBe(1);
  });
});
