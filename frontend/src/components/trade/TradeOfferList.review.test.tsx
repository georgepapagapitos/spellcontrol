// @vitest-environment happy-dom
/**
 * Answering an incoming offer: the row only opens a review, and the review is
 * where the collection-mutating accept lives.
 *
 * These pin what the one-tap row and the old accept dialog used to own: the
 * cheapest-first pre-fill goes out unchanged, a short line gates Accept, one
 * tap switches printings, the wire shape never carries a copyId, and Decline
 * still confirms. New here: the deck a copy comes out of is named BEFORE
 * accepting, not in a toast after settlement.
 *
 * Assertions go against document.body because the sheet and the confirm are
 * portalled. No `@testing-library/jest-dom` in this repo.
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

const incoming: TradeOffer = {
  id: 't1',
  mine: false,
  counterpartyId: 'f1',
  counterpartyUsername: 'tradepal',
  counterpartyDisplayName: 'Trade Pal',
  status: 'proposed',
  note: 'Thursday?',
  give: [{ oracleId: 'o-sol', name: 'Sol Ring', quantity: 1, copies: [] }],
  receive: [{ oracleId: 'o-llanowar', name: 'Llanowar Elves', quantity: 2, copies: [] }],
  settled: false,
  createdAt: 1,
  updatedAt: 1,
  resolvedAt: null,
};

const onCounter = vi.fn();
const onChanged = vi.fn();

function mount(offer: TradeOffer = incoming) {
  return render(
    <MemoryRouter>
      <TradeOfferList offers={[offer]} onChanged={onChanged} onCounter={onCounter} />
    </MemoryRouter>
  );
}

function openReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Review offer' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  acceptTrade.mockReset().mockResolvedValue({ ...incoming, status: 'accepted' });
  declineTrade.mockReset().mockResolvedValue(undefined);
  settleTrade.mockReset().mockResolvedValue(true);
  onCounter.mockClear();
  onChanged.mockClear();
  storeState = { cards: [beta, cheap], binders: [] };
  decks = [];
});

describe('incoming offer row', () => {
  it('offers Review offer instead of an inline Accept', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Review offer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    // Opening the review commits nothing.
    openReview();
    expect(acceptTrade).not.toHaveBeenCalled();
  });

  it('leaves outgoing offers on Withdraw', () => {
    mount({ ...incoming, mine: true });
    expect(screen.queryByRole('button', { name: 'Review offer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });
});

describe('incoming review', () => {
  it('shows the note, both sides and where incoming cards file', () => {
    mount();
    const sheet = openReview();
    expect(within(sheet).getByText('“Thursday?”')).toBeTruthy();
    expect(within(sheet).getByText('You give · 1')).toBeTruthy();
    expect(within(sheet).getByText('You get · 2')).toBeTruthy();
    expect(within(sheet).getByText(/Files next to your copy in Green Staples/)).toBeTruthy();
  });

  it('accepts the cheapest-first pick through acceptTrade and settleTrade, with no copyId', async () => {
    mount();
    fireEvent.click(within(openReview()).getByRole('button', { name: 'Accept trade' }));

    await waitFor(() => expect(settleTrade).toHaveBeenCalledTimes(1));
    expect(acceptTrade).toHaveBeenCalledWith('t1', [
      {
        oracleId: 'o-sol',
        name: 'Sol Ring',
        quantity: 1,
        copies: [{ scryfallId: 'scry-cmd', finish: 'nonfoil' }],
      },
    ]);
    const sent = acceptTrade.mock.calls[0][1] as { copies: object[] }[];
    expect(Object.keys(sent[0].copies[0]).sort()).toEqual(['finish', 'scryfallId']);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('switches printings in one tap, the other trimming to keep the total', async () => {
    mount();
    const sheet = openReview();
    fireEvent.click(within(sheet).getByRole('button', { name: 'One more LEA · #233 Sol Ring' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Accept trade' }));

    await waitFor(() => expect(acceptTrade).toHaveBeenCalledTimes(1));
    expect(acceptTrade.mock.calls[0][1][0].copies).toEqual([
      { scryfallId: 'scry-lea', finish: 'nonfoil' },
    ]);
  });

  it('blocks Accept and names the card while a line is short', () => {
    mount();
    const sheet = openReview();
    fireEvent.click(within(sheet).getByRole('button', { name: 'One fewer CMD · #120 Sol Ring' }));

    const accept = within(sheet).getByRole('button', { name: 'Accept trade' });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText('Pick 1 copy of Sol Ring to continue.')).toBeTruthy();
    fireEvent.click(accept);
    expect(acceptTrade).not.toHaveBeenCalled();
  });

  it('warns which deck loses the card before accepting', () => {
    storeState = { cards: [cheap], binders: [] };
    decks = [
      {
        id: 'd1',
        name: 'Zur Combo',
        color: '#48f',
        cards: [{ card: { name: 'Sol Ring' }, allocatedCopyId: 'cheap' }],
      },
    ];
    mount();
    const sheet = openReview();
    expect(
      within(sheet).getByText(
        'Sol Ring is in Zur Combo. Accepting leaves that deck one card short.'
      )
    ).toBeTruthy();
    expect(acceptTrade).not.toHaveBeenCalled();
  });

  it('stays quiet when a free copy covers the pick', () => {
    // The deck holds the Beta, but the pick is the free cheap copy.
    decks = [
      {
        id: 'd1',
        name: 'Zur Combo',
        color: '#48f',
        cards: [{ card: { name: 'Sol Ring' }, allocatedCopyId: 'beta' }],
      },
    ];
    mount();
    const sheet = openReview();
    expect(within(sheet).queryByText(/Accepting leaves/)).toBeNull();
  });

  it('disables Accept with the reason when you no longer have the card, and offers Counter', () => {
    storeState = { cards: [], binders: [] };
    mount();
    const sheet = openReview();
    expect(
      (within(sheet).getByRole('button', { name: 'Accept trade' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      within(sheet).getAllByText(/You no longer have Sol Ring to give/).length
    ).toBeGreaterThan(0);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Counter' }));
    expect(onCounter).toHaveBeenCalledWith(incoming);
    expect(acceptTrade).not.toHaveBeenCalled();
  });

  it('confirms Decline first, saying it cannot be undone', async () => {
    mount();
    fireEvent.click(within(openReview()).getByRole('button', { name: 'Decline' }));

    expect(declineTrade).not.toHaveBeenCalled();
    expect(await screen.findByText(/This can't be undone\./)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Decline' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(declineTrade).toHaveBeenCalledWith('t1'));
  });

  it('hands Counter to the caller and closes the review', () => {
    mount();
    fireEvent.click(within(openReview()).getByRole('button', { name: 'Counter' }));
    expect(onCounter).toHaveBeenCalledWith(incoming);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
