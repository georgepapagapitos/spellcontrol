// @vitest-environment happy-dom
/**
 * Answering an ask that names a printing: the sheet opens on THAT printing, and
 * says so plainly when the viewer cannot give it.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '../../types';
import type { TradeOffer } from '@/lib/trade/trades-client';

vi.mock('@/lib/cards/card-thumbs', () => ({
  useCardThumb: () => undefined,
  usePrintingThumb: () => ({ src: undefined, id: undefined }),
}));
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('@/lib/binder/card-locations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/binder/card-locations')>(
    '@/lib/binder/card-locations'
  );
  return {
    ...actual,
    useCardLocations: () => ({
      byOracleId: new Map([['o-llanowar', { binderName: 'Green Staples', pageNum: 4 }]]),
    }),
  };
});
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
});
const acceptTrade = vi.fn();
const declineTrade = vi.fn();
vi.mock('@/lib/trade/trades-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade/trades-client')>(
    '@/lib/trade/trades-client'
  );
  return {
    ...actual,
    acceptTrade: (...a: unknown[]) => acceptTrade(...a),
    declineTrade: (id: string) => declineTrade(id),
  };
});
const settleTrade = vi.fn();
vi.mock('@/lib/trade/use-trade-settlement', () => ({
  settleTrade: (o: unknown) => settleTrade(o),
}));
vi.mock('@/lib/trade/trade-preview', () => ({ resolveTradePreview: vi.fn() }));
const getCardById = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, getCardById: (...a: unknown[]) => getCardById(...a) };
});
vi.mock('@/components/card/CardPreview', () => ({ CardPreview: () => null }));

let storeState: { cards: EnrichedCard[]; binders: never[] } = { cards: [], binders: [] };
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel(storeState),
}));
let decks: unknown[] = [];
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks }),
}));
vi.mock('../../store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));

import { TradeOfferList } from './TradeOfferList';

function copyOf(over: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Sol Ring',
    oracleId: 'o-sol',
    setName: 'Set',
    rarity: 'rare',
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

// Beta FIRST in collection order, so a correct seed must sort, not slice.
const beta = copyOf({
  copyId: 'beta',
  scryfallId: 'scry-lea',
  setCode: 'lea',
  collectorNumber: '233',
  purchasePrice: 500,
});
const cheap = copyOf({
  copyId: 'cheap',
  scryfallId: 'scry-cmd',
  setCode: 'cmd',
  collectorNumber: '120',
  purchasePrice: 2,
});

const askFor = (scryfallId: string): TradeOffer => ({
  id: 't1',
  mine: false,
  counterpartyId: 'f1',
  counterpartyUsername: 'tradepal',
  counterpartyDisplayName: 'Trade Pal',
  status: 'proposed',
  note: '',
  give: [
    {
      oracleId: 'o-sol',
      name: 'Sol Ring',
      quantity: 1,
      copies: [{ scryfallId, finish: 'nonfoil' }],
    },
  ],
  receive: [],
  settled: false,
  createdAt: 1,
  updatedAt: 1,
  resolvedAt: null,
});

const onChanged = vi.fn();

function openReview(offer: TradeOffer) {
  render(
    <MemoryRouter>
      <TradeOfferList offers={[offer]} onChanged={onChanged} onCounter={vi.fn()} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review offer' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  acceptTrade.mockReset().mockResolvedValue({});
  declineTrade.mockReset();
  settleTrade.mockReset().mockResolvedValue(true);
  getCardById.mockReset().mockResolvedValue({ set: 'ed7', collector_number: '253' });
  storeState = { cards: [beta, cheap], binders: [] };
  decks = [];
});

describe('incoming review of an ask that names a printing', () => {
  it('opens on the asked printing, not the cheapest, with no swap note', async () => {
    const sheet = openReview(askFor('scry-lea'));
    expect(within(sheet).queryByText(/asked for/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Accept trade' }));
    await waitFor(() => expect(acceptTrade).toHaveBeenCalledTimes(1));
    expect(acceptTrade.mock.calls[0][1][0].copies).toEqual([
      { scryfallId: 'scry-lea', finish: 'nonfoil' },
    ]);
  });

  it('falls back to the cheapest other printing and says what changed', async () => {
    const sheet = openReview(askFor('scry-7ed'));
    // The asked printing is looked up by id, since the viewer owns none of it.
    expect(
      await within(sheet).findByText("Trade Pal asked for ED7 #253; you're giving CMD #120.")
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Accept trade' }));
    await waitFor(() => expect(acceptTrade).toHaveBeenCalledTimes(1));
    expect(acceptTrade.mock.calls[0][1][0].copies).toEqual([
      { scryfallId: 'scry-cmd', finish: 'nonfoil' },
    ]);
  });

  it('keeps the note honest if the asked printing cannot be looked up', async () => {
    getCardById.mockRejectedValue(new Error('offline'));
    const sheet = openReview(askFor('scry-7ed'));
    expect(
      within(sheet).getByText(
        "Trade Pal asked for a printing you don't have; you're giving CMD #120."
      )
    ).toBeTruthy();
  });

  it('can still be changed with the printing chooser', async () => {
    const sheet = openReview(askFor('scry-7ed'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'One more LEA · #233 Sol Ring' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Accept trade' }));
    await waitFor(() => expect(acceptTrade).toHaveBeenCalledTimes(1));
    expect(acceptTrade.mock.calls[0][1][0].copies).toEqual([
      { scryfallId: 'scry-lea', finish: 'nonfoil' },
    ]);
  });
});
