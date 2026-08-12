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
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BinderDef, EnrichedCard } from '../../types';
import type { TradeOffer } from '../../lib/trades-client';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
// The value line fetches floor prices; irrelevant here and non-deterministic.
vi.mock('../../lib/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/trade-value')>('../../lib/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
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
