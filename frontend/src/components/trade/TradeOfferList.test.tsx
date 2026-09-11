// @vitest-environment happy-dom
/**
 * TradeOfferList's settled note.
 *
 * "Settled — your collection is up to date" was true and useless: this app is
 * about PHYSICAL binders, and the thing left to do after a trade is put the
 * cards away. The note names the binder and page each incoming card routed to,
 * and falls back to the plain confirmation whenever routing has no answer.
 *
 * No `@testing-library/jest-dom` in this repo — plain vitest matchers.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BinderDef, EnrichedCard } from '../../types';
import type { TradeOffer } from '../../lib/trades-client';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
// The value line fetches floor prices; mocked so a test can price a side (the
// net tests) and everything else sees "unknown".
let floors = new Map<string, number>();
vi.mock('../../lib/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/trade-value')>('../../lib/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: floors, pending: false }) };
});
// The device-local price cache a pinned printing is priced from.
let pinned: Record<string, number> = {};
vi.mock('../../lib/card-prices', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/card-prices')>('../../lib/card-prices');
  return {
    ...actual,
    getPrice: (id: string) => (id in pinned ? { usd: pinned[id], eur: pinned[id] } : undefined),
  };
});
const removeTrade = vi.fn();
vi.mock('../../lib/trades-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/trades-client')>('../../lib/trades-client');
  return { ...actual, removeTrade: (id: string) => removeTrade(id) };
});

let storeState: { cards: EnrichedCard[]; binders: BinderDef[] } = { cards: [], binders: [] };
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel(storeState),
}));
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));
vi.mock('../../store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));

// The carousel itself is covered by CardPreview.test; here we only care that
// the chip opens it, with the whole offer and on the right slide.
const previewProps = vi.fn();
vi.mock('../CardPreview', () => ({
  CardPreview: (props: { cards: { name: string }[]; index: number }) => {
    previewProps(props);
    return <div data-testid="preview">{props.cards[props.index]?.name}</div>;
  },
}));

const resolveTradePreview = vi.fn();
vi.mock('../../lib/trade-preview', () => ({
  resolveTradePreview: (cards: unknown[]) => resolveTradePreview(cards),
}));

import { TradeOfferList } from './TradeOfferList';

function card(over: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Rhystic Study',
    oracleId: 'o-rhystic',
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: 'scry-1',
    purchasePrice: 30,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Enchantment',
    ...over,
  } as EnrichedCard;
}

function binder(over: Partial<BinderDef> = {}): BinderDef {
  return {
    id: 'b1',
    name: 'Blue Staples',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#48f',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const settled: TradeOffer = {
  id: 't1',
  mine: true,
  counterpartyId: 'f1',
  counterpartyUsername: 'tradepal',
  counterpartyDisplayName: 'Trade Pal',
  status: 'accepted',
  note: '',
  give: [],
  receive: [{ oracleId: 'o-rhystic', name: 'Rhystic Study', quantity: 1, copies: [] }],
  settled: true,
  createdAt: 1,
  updatedAt: 2,
  resolvedAt: 2,
};

function mount(offer: TradeOffer = settled) {
  return render(
    <MemoryRouter>
      <TradeOfferList offers={[offer]} onChanged={() => {}} />
    </MemoryRouter>
  );
}

describe('settled note', () => {
  it('names the binder and page each incoming card was filed into', () => {
    storeState = { cards: [card({ copyId: 'c1' })], binders: [binder()] };
    mount();
    // Scoped to the note — the card name also appears in the offer's own chip.
    const note = screen.getByRole('status');
    expect(note.textContent).toContain('Rhystic Study');
    expect(note.textContent).toContain('Blue Staples');
    expect(note.textContent).toContain('p.1');
    // The card name is the part you scan for while holding the pile.
    expect(note.querySelector('.trade-offer-filed-card')?.textContent).toBe('Rhystic Study');
  });

  it('falls back to the plain confirmation when no binders are defined', () => {
    storeState = { cards: [card({ copyId: 'c1' })], binders: [] };
    mount();
    expect(screen.getByRole('status').textContent).toContain('your collection is up to date');
  });

  it('falls back when the received card routed nowhere', () => {
    // A binder that matches nothing → the card lands uncategorized, so there is
    // no page to send anyone to.
    storeState = {
      cards: [card({ copyId: 'c1', purchasePrice: 0.1 })],
      binders: [binder({ filterGroups: [{ filter: { priceMin: 500 } }] })],
    };
    mount();
    expect(screen.getByRole('status').textContent).toContain('your collection is up to date');
  });

  it('caps the named cards and counts the rest', () => {
    const names = ['Rhystic Study', 'Smothering Tithe', 'Jeweled Lotus', 'Sol Ring'];
    storeState = {
      cards: names.map((name, i) =>
        card({ copyId: `c${i}`, name, oracleId: `o-${i}`, scryfallId: `s-${i}` })
      ),
      binders: [binder()],
    };
    mount({
      ...settled,
      receive: names.map((name, i) => ({ oracleId: `o-${i}`, name, quantity: 1, copies: [] })),
    });
    // Three named, the tail counted — 40 lines a side is legal on the wire.
    expect(screen.getByRole('status').textContent).toContain('and 1 more');
  });

  it('says nothing about filing while the trade is still settling', () => {
    storeState = { cards: [card({ copyId: 'c1' })], binders: [binder()] };
    mount({ ...settled, settled: false });
    expect(screen.getByRole('status').textContent).toContain('Adding to your collection');
  });
});

describe('card preview', () => {
  const twoSided: TradeOffer = {
    ...settled,
    status: 'proposed',
    settled: false,
    give: [{ oracleId: 'o-sol', name: 'Sol Ring', quantity: 1, copies: [] }],
    receive: [{ oracleId: 'o-rhystic', name: 'Rhystic Study', quantity: 1, copies: [] }],
  };

  beforeEach(() => {
    previewProps.mockReset();
    resolveTradePreview.mockReset();
    storeState = { cards: [], binders: [] };
    resolveTradePreview.mockResolvedValue({
      cards: [{ name: 'Sol Ring' }, { name: 'Rhystic Study' }],
      indexOf: (c: { name: string }) => (c.name === 'Sol Ring' ? 0 : 1),
    });
  });

  it('opens the carousel on the card you tapped', async () => {
    mount(twoSided);
    fireEvent.click(screen.getByLabelText('Preview Rhystic Study'));
    expect((await screen.findByTestId('preview')).textContent).toBe('Rhystic Study');
  });

  it('spans the WHOLE offer, give side then get side', async () => {
    // A trade is one decision about a set of cards — you should be able to
    // swipe from what you're giving straight into what you're getting.
    mount(twoSided);
    fireEvent.click(screen.getByLabelText('Preview Sol Ring'));
    await screen.findByTestId('preview');
    expect(resolveTradePreview).toHaveBeenCalledWith([...twoSided.give, ...twoSided.receive]);
    expect(previewProps.mock.calls[0][0].cards.map((c: { name: string }) => c.name)).toEqual([
      'Sol Ring',
      'Rhystic Study',
    ]);
  });

  it('opens at the first slide when the tapped card itself could not resolve', async () => {
    // One dead lookup must not block looking at the rest of the deal.
    resolveTradePreview.mockResolvedValue({
      cards: [{ name: 'Sol Ring' }],
      indexOf: () => -1,
    });
    mount(twoSided);
    fireEvent.click(screen.getByLabelText('Preview Rhystic Study'));
    expect((await screen.findByTestId('preview')).textContent).toBe('Sol Ring');
  });

  it('stays closed and warns when nothing resolves at all', async () => {
    resolveTradePreview.mockResolvedValue({ cards: [], indexOf: () => -1 });
    mount(twoSided);
    fireEvent.click(screen.getByLabelText('Preview Sol Ring'));
    await Promise.resolve();
    expect(screen.queryByTestId('preview')).toBeNull();
  });
});

describe('whose move, the net, and finished rows', () => {
  const open: TradeOffer = {
    ...settled,
    status: 'proposed',
    settled: false,
    note: 'Bring these Thursday?',
    give: [
      {
        oracleId: 'o-sol',
        name: 'Sol Ring',
        quantity: 1,
        copies: [{ scryfallId: 'scry-sol', finish: 'nonfoil' }],
      },
    ],
    receive: [{ oracleId: 'o-rhystic', name: 'Rhystic Study', quantity: 1, copies: [] }],
  };

  beforeEach(() => {
    floors = new Map();
    pinned = {};
    removeTrade.mockReset();
    storeState = { cards: [], binders: [] };
  });

  it('the pill says whose move it is, not a bare "Waiting"', () => {
    mount({ ...open, id: 'in', mine: false });
    expect(screen.getByTestId('trade-status-in').textContent).toBe('Your call');
    mount({ ...open, id: 'out', mine: true });
    expect(screen.getByTestId('trade-status-out').textContent).toBe('Waiting on them');
  });

  it('states the net once both sides are priced, as an estimate when a side is a floor', () => {
    pinned = { 'scry-sol': 2 };
    floors = new Map([['Rhystic Study', 42]]);
    mount(open);
    expect(screen.getByText('You come out about $40.00 ahead')).toBeTruthy();
  });

  it('says so when the deal favours them', () => {
    pinned = { 'scry-sol': 50 };
    floors = new Map([['Rhystic Study', 42]]);
    mount(open);
    expect(screen.getByText('They come out about $8.00 ahead')).toBeTruthy();
  });

  it('states no net at all while a side cannot be priced', () => {
    pinned = { 'scry-sol': 2 };
    // No floor for Rhystic Study → the get side reads "+?" and the net stays
    // out: a subtraction with a missing term is a lie with a dollar sign.
    mount(open);
    expect(screen.queryByText(/come out|even/i)).toBeNull();
  });

  it('a finished trade is compact: no note, no net, and Remove takes it off your list', async () => {
    pinned = { 'scry-sol': 2 };
    floors = new Map([['Rhystic Study', 42]]);
    removeTrade.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(
      <MemoryRouter>
        <TradeOfferList
          offers={[{ ...open, id: 'gone', status: 'declined', resolvedAt: 3 }]}
          onChanged={onChanged}
        />
      </MemoryRouter>
    );

    expect(screen.queryByText(/Bring these Thursday/)).toBeNull();
    expect(screen.queryByText(/come out/)).toBeNull();
    // The record of what changed hands stays, and stays tappable.
    expect(screen.getByRole('button', { name: 'Preview Sol Ring' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Remove this trade with Trade Pal/ }));
    await waitFor(() => expect(removeTrade).toHaveBeenCalledWith('gone'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('an offer still in motion keeps its note and offers no Remove', () => {
    mount(open);
    expect(screen.getByText(/Bring these Thursday/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove this trade/ })).toBeNull();

    // Accepted but not yet settled here: the settlement sweep still needs it.
    mount({ ...open, id: 'mid', status: 'accepted', settled: false });
    expect(screen.queryByRole('button', { name: /Remove this trade/ })).toBeNull();
  });
});
