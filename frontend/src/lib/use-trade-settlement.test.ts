// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import type { TradeListing, TradeOffer } from './trades-client';

const getCardByIdMock = vi.fn<(id: string) => Promise<ScryfallCard | null>>();
vi.mock('./api', () => ({
  getCardById: (id: string) => getCardByIdMock(id),
}));

const getCardsByNamesMock = vi.fn<(names: string[]) => Promise<Map<string, ScryfallCard>>>();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: (names: string[]) => getCardsByNamesMock(names),
}));

const markTradeSettledMock = vi.fn<(id: string) => Promise<TradeOffer>>();
const listTradesMock = vi.fn<() => Promise<TradeListing>>();
vi.mock('./trades-client', () => ({
  markTradeSettled: (id: string) => markTradeSettledMock(id),
  listTrades: () => listTradesMock(),
}));

vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: { status: string }) => unknown) => selector({ status: 'authed' }),
}));

const toastShowMock = vi.fn();
vi.mock('../store/toasts', () => ({
  toast: { show: (input: unknown) => toastShowMock(input) },
}));

const replaceAllCardsMock = vi.fn<(cards: EnrichedCard[]) => Promise<void>>();
const addCardMock = vi.fn<(...args: unknown[]) => Promise<string[]>>();
let storeCards: EnrichedCard[] = [];
let storeHydrating = false;
type StoreShape = { cards: EnrichedCard[]; hydrating: boolean };
const storeListeners = new Set<(s: StoreShape) => void>();
function storeState(): StoreShape & {
  replaceAllCards: typeof replaceAllCardsMock;
  addCard: typeof addCardMock;
} {
  return {
    get cards() {
      return storeCards;
    },
    get hydrating() {
      return storeHydrating;
    },
    replaceAllCards: replaceAllCardsMock,
    addCard: addCardMock,
  };
}
/** Flip the mock store to hydrated (optionally with rows) and notify subscribers. */
function finishHydration(cards?: EnrichedCard[]) {
  if (cards) storeCards = cards;
  storeHydrating = false;
  for (const l of storeListeners) l(storeState());
}

vi.mock('../store/collection', () => ({
  useCollectionStore: {
    getState: () => storeState(),
    subscribe: (listener: (s: StoreShape) => void) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
  },
}));

import { settleTrade, useTradeSettlement } from './use-trade-settlement';

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
  getCardsByNamesMock.mockReset();
  markTradeSettledMock.mockReset();
  listTradesMock.mockReset();
  toastShowMock.mockReset();
  replaceAllCardsMock.mockReset();
  addCardMock.mockReset();
  getCardsByNamesMock.mockResolvedValue(new Map());
  markTradeSettledMock.mockResolvedValue(offer({ settled: true }));
  replaceAllCardsMock.mockResolvedValue(undefined);
  addCardMock.mockResolvedValue(['new-copy']);
  storeHydrating = false;
  storeListeners.clear();
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

  it('refuses to run twice concurrently for the same offer', async () => {
    // The server's settled flag is stamped AFTER the local apply, so it cannot
    // stop an overlap — the inline accept racing the focus sweep would both
    // read "unsettled" and both ADD. The in-flight guard is the only thing
    // between that and a double-added collection.
    getCardByIdMock.mockResolvedValue({ id: 'scry-jud' } as ScryfallCard);

    const [first, second] = await Promise.all([settleTrade(offer()), settleTrade(offer())]);

    expect([first, second].sort()).toEqual([false, true]);
    expect(addCardMock).toHaveBeenCalledTimes(1);
    expect(replaceAllCardsMock).toHaveBeenCalledTimes(1);
    expect(markTradeSettledMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the card by NAME when the pinned printing cannot resolve', async () => {
    // A different printing of the right card beats losing the card entirely —
    // the same ruling the preview carousel applies. The substitution is said
    // out loud, never silent.
    getCardByIdMock.mockResolvedValue(null);
    getCardsByNamesMock.mockResolvedValue(
      new Map([['Rhystic Study', { id: 'scry-fallback', name: 'Rhystic Study' } as ScryfallCard]])
    );

    expect(await settleTrade(offer())).toBe(true);
    expect(addCardMock).toHaveBeenCalledWith(
      { id: 'scry-fallback', name: 'Rhystic Study' },
      'foil',
      { quantity: 1, condition: 'lp', language: undefined }
    );
    expect(markTradeSettledMock).toHaveBeenCalled();
    const messages = toastShowMock.mock.calls.map((c) => (c[0] as { message: string }).message);
    expect(messages.some((m) => m.includes('different printing'))).toBe(true);
  });

  it('announces only the cards that actually arrived', async () => {
    // Two cards promised, one unresolvable: the success toast must say
    // "1 card in", not announce the one that never landed.
    getCardByIdMock.mockImplementation(async (id) =>
      id === 'scry-jud' ? ({ id: 'scry-jud' } as ScryfallCard) : null
    );
    const twoIn = offer({
      receive: [
        {
          oracleId: 'o-rhystic',
          name: 'Rhystic Study',
          quantity: 1,
          copies: [{ scryfallId: 'scry-jud', finish: 'foil' }],
        },
        {
          oracleId: 'o-vault',
          name: 'Mana Vault',
          quantity: 1,
          copies: [{ scryfallId: 'scry-gone', finish: 'nonfoil' }],
        },
      ],
    });

    expect(await settleTrade(twoIn)).toBe(true);
    const messages = toastShowMock.mock.calls.map((c) => (c[0] as { message: string }).message);
    expect(messages.some((m) => m.includes('1 card in'))).toBe(true);
    expect(messages.some((m) => m.includes('Mana Vault'))).toBe(true);
  });
});

describe('settleTrade before the collection has hydrated', () => {
  it('waits for hydration instead of planning against an empty collection', async () => {
    // Fresh page load: the store is still reading IndexedDB (cards = []).
    storeHydrating = true;
    storeCards = [];
    getCardByIdMock.mockResolvedValue({ id: 'scry-jud', name: 'Rhystic Study' } as ScryfallCard);

    const pending = settleTrade(offer());
    await Promise.resolve();
    await Promise.resolve();
    // Nothing may touch the collection yet — planning now would report Sol
    // Ring as "no longer owned" and the first write would tombstone every row
    // that hadn't loaded.
    expect(replaceAllCardsMock).not.toHaveBeenCalled();
    expect(addCardMock).not.toHaveBeenCalled();

    finishHydration([
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
      owned({ copyId: 'b', name: 'Counterspell', oracleId: 'o-cs', scryfallId: 'scry-cs' }),
    ]);
    expect(await pending).toBe(true);
    // Planned against the REAL collection: Sol Ring out, Counterspell kept.
    expect(replaceAllCardsMock).toHaveBeenCalledWith([
      expect.objectContaining({ copyId: 'b', name: 'Counterspell' }),
    ]);
    expect(toastShowMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('no longer had') })
    );
  });
});

describe('useTradeSettlement', () => {
  it('re-lists between settles and stops when a settle could not be recorded', async () => {
    // The sweep re-fetches before EVERY settle so another device settling in
    // the window is seen — and when recording fails (the offer keeps listing
    // as unsettled), it must stop after one attempt rather than spin against
    // the rate limiter.
    getCardByIdMock.mockResolvedValue({ id: 'scry-jud' } as ScryfallCard);
    markTradeSettledMock.mockRejectedValue(new Error('offline'));
    listTradesMock.mockResolvedValue({ offers: [offer()], truncated: false });

    renderHook(() => useTradeSettlement());

    await vi.waitFor(() => expect(addCardMock).toHaveBeenCalledTimes(1));
    // Re-listed once after the settle, saw the same offer still unsettled and
    // already attempted, and stopped.
    await vi.waitFor(() => expect(listTradesMock).toHaveBeenCalledTimes(2));
    expect(addCardMock).toHaveBeenCalledTimes(1);
    expect(markTradeSettledMock).toHaveBeenCalledTimes(1);
  });
});
