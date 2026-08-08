import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import type { TradeOffer } from './trades-client';

const getCardByIdMock = vi.fn<(id: string) => Promise<ScryfallCard | null>>();
vi.mock('./api', () => ({
  getCardById: (id: string) => getCardByIdMock(id),
}));

const markTradeSettledMock = vi.fn<(id: string) => Promise<TradeOffer>>();
vi.mock('./trades-client', () => ({
  markTradeSettled: (id: string) => markTradeSettledMock(id),
  listTrades: vi.fn(),
}));

const toastShowMock = vi.fn();
vi.mock('../store/toasts', () => ({
  toast: { show: (input: unknown) => toastShowMock(input) },
}));

const replaceAllCardsMock = vi.fn<(cards: EnrichedCard[]) => Promise<void>>();
const addCardMock = vi.fn<(...args: unknown[]) => Promise<string[]>>();
let storeCards: EnrichedCard[] = [];

vi.mock('../store/collection', () => ({
  useCollectionStore: {
    getState: () => ({
      get cards() {
        return storeCards;
      },
      replaceAllCards: replaceAllCardsMock,
      addCard: addCardMock,
    }),
  },
}));

import { settleTrade } from './use-trade-settlement';

function owned(over: Partial<EnrichedCard> & { copyId: string; name: string }): EnrichedCard {
  return {
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: 'scry-default',
    purchasePrice: 0,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

function offer(over: Partial<TradeOffer> = {}): TradeOffer {
  return {
    id: 'offer-1',
    mine: true,
    counterpartyId: 'friend-1',
    counterpartyUsername: 'bob',
    counterpartyDisplayName: 'Bob',
    status: 'accepted',
    note: '',
    give: [
      {
        oracleId: 'o-sol',
        name: 'Sol Ring',
        quantity: 1,
        copies: [{ scryfallId: 'scry-c21', finish: 'nonfoil' }],
      },
    ],
    receive: [
      {
        oracleId: 'o-rhystic',
        name: 'Rhystic Study',
        quantity: 1,
        copies: [{ scryfallId: 'scry-jud', finish: 'foil', condition: 'LP' }],
      },
    ],
    settled: false,
    createdAt: 1,
    updatedAt: 2,
    resolvedAt: 2,
    ...over,
  };
}

beforeEach(() => {
  getCardByIdMock.mockReset();
  markTradeSettledMock.mockReset();
  toastShowMock.mockReset();
  replaceAllCardsMock.mockReset();
  addCardMock.mockReset();
  markTradeSettledMock.mockResolvedValue(offer({ settled: true }));
  replaceAllCardsMock.mockResolvedValue(undefined);
  addCardMock.mockResolvedValue(['new-copy']);
  storeCards = [
    owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
  ];
});

describe('settleTrade', () => {
  it('removes what was given and adds what was received, then records it', async () => {
    getCardByIdMock.mockResolvedValue({ id: 'scry-jud', name: 'Rhystic Study' } as ScryfallCard);

    const applied = await settleTrade(offer());

    expect(applied).toBe(true);
    // The given copy left the collection.
    expect(replaceAllCardsMock).toHaveBeenCalledWith([]);
    // The received copy arrived at the printing that changed hands.
    expect(getCardByIdMock).toHaveBeenCalledWith('scry-jud');
    expect(addCardMock).toHaveBeenCalledWith({ id: 'scry-jud', name: 'Rhystic Study' }, 'foil', {
      quantity: 1,
      condition: 'lp',
      language: undefined,
    });
    expect(markTradeSettledMock).toHaveBeenCalledWith('offer-1');
  });

  it('applies locally BEFORE telling the server', async () => {
    getCardByIdMock.mockResolvedValue({ id: 'scry-jud' } as ScryfallCard);
    const order: string[] = [];
    replaceAllCardsMock.mockImplementation(async () => {
      order.push('local');
    });
    markTradeSettledMock.mockImplementation(async () => {
      order.push('server');
      return offer({ settled: true });
    });

    await settleTrade(offer());

    // A crash between the two must lose nothing — so the collection change
    // has to land first.
    expect(order).toEqual(['local', 'server']);
  });

  it('does nothing for an offer that was not accepted', async () => {
    expect(await settleTrade(offer({ status: 'proposed' }))).toBe(false);
    expect(replaceAllCardsMock).not.toHaveBeenCalled();
    expect(markTradeSettledMock).not.toHaveBeenCalled();
  });

  it('does nothing for an offer this device already settled', async () => {
    expect(await settleTrade(offer({ settled: true }))).toBe(false);
    expect(replaceAllCardsMock).not.toHaveBeenCalled();
  });

  it('still settles when the collection no longer has a card it owed', async () => {
    storeCards = [];
    getCardByIdMock.mockResolvedValue({ id: 'scry-jud' } as ScryfallCard);

    expect(await settleTrade(offer())).toBe(true);
    // Nothing to remove, but the incoming card still arrives and the trade is
    // recorded rather than wedging.
    expect(replaceAllCardsMock).not.toHaveBeenCalled();
    expect(addCardMock).toHaveBeenCalled();
    expect(markTradeSettledMock).toHaveBeenCalled();
    const warned = toastShowMock.mock.calls.some(
      (c) => (c[0] as { tone?: string }).tone === 'warn'
    );
    expect(warned).toBe(true);
  });

  it('warns instead of silently dropping a printing it cannot look up', async () => {
    getCardByIdMock.mockResolvedValue(null);

    expect(await settleTrade(offer())).toBe(true);
    expect(addCardMock).not.toHaveBeenCalled();
    const messages = toastShowMock.mock.calls.map((c) => (c[0] as { message: string }).message);
    expect(messages.some((m) => m.includes('Rhystic Study'))).toBe(true);
  });

  it('keeps the local change when recording it fails', async () => {
    getCardByIdMock.mockResolvedValue({ id: 'scry-jud' } as ScryfallCard);
    markTradeSettledMock.mockRejectedValue(new Error('offline'));

    // The cards are already in the collection; a failed report is not a
    // failed settlement.
    expect(await settleTrade(offer())).toBe(true);
    expect(replaceAllCardsMock).toHaveBeenCalled();
    expect(addCardMock).toHaveBeenCalled();
  });
});
