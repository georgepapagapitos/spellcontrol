// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Deck } from '../../store/decks';
import type { EnrichedCard, BinderDef, ListDef, ListEntry } from '../../types';
import type { ArrivalCandidateCard } from '../../lib/new-arrivals';

vi.mock('../../lib/value-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/value-history')>();
  return { ...actual, getValueHistory: vi.fn(), getLatestMovers: vi.fn() };
});
vi.mock('../../store/decks', () => ({ useDecksStore: vi.fn() }));
vi.mock('../../store/collection', () => ({ useCollectionStore: vi.fn() }));
vi.mock('../../lib/allocations', () => ({ useAllocations: vi.fn() }));
vi.mock('../../lib/api', () => ({ useSetMap: vi.fn() }));
vi.mock('../../lib/materialize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/materialize')>();
  return { materializeBinders: vi.fn(actual.materializeBinders) };
});
const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: mockUseCardThumb }));

import { ValueMoversCard } from './ValueMoversCard';
import { NewArrivalsCard } from './NewArrivalsCard';
import { BinderReviewCard } from './BinderReviewCard';
import { TradeTargetsCard } from './TradeTargetsCard';
import { getValueHistory, getLatestMovers, dayKey } from '../../lib/value-history';
import { useDecksStore } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { useAllocations } from '../../lib/allocations';
import { useSetMap } from '../../lib/api';
import { materializeBinders } from '../../lib/materialize';
import { printingFinishKey } from '../../lib/collection-mutations';

const mockGetValueHistory = getValueHistory as unknown as ReturnType<typeof vi.fn>;
const mockGetLatestMovers = getLatestMovers as unknown as ReturnType<typeof vi.fn>;
const mockUseDecksStore = useDecksStore as unknown as ReturnType<typeof vi.fn>;
const mockUseCollectionStore = useCollectionStore as unknown as ReturnType<typeof vi.fn>;
const mockUseAllocations = useAllocations as unknown as ReturnType<typeof vi.fn>;
const mockUseSetMap = useSetMap as unknown as ReturnType<typeof vi.fn>;
const mockMaterializeBinders = materializeBinders as unknown as ReturnType<typeof vi.fn>;

function renderIn(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

function candidate(
  overrides: Partial<ArrivalCandidateCard> & { name: string }
): ArrivalCandidateCard {
  return {
    typeLine: 'Creature — Human',
    cmc: 2,
    colorIdentity: [],
    ...overrides,
  };
}

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `id-${Math.random()}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    cmc: 2,
    typeLine: 'Instant',
    colorIdentity: ['R'],
    ...overrides,
  } as EnrichedCard;
}

function makeBinder(overrides: Partial<BinderDef> = {}): BinderDef {
  return {
    id: `binder-${Math.random()}`,
    name: 'Test Binder',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as BinderDef;
}

const daysAgo = (n: number) => Date.now() - n * 86400000;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCardThumb.mockReturnValue(undefined);
});

describe('ValueMoversCard', () => {
  it('shows the loading skeleton while the IndexedDB read is in flight', () => {
    mockGetValueHistory.mockReturnValue(new Promise(() => {}));
    mockGetLatestMovers.mockReturnValue(new Promise(() => {}));
    renderIn(<ValueMoversCard />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('renders the empty state when there is no movers record yet', async () => {
    mockGetValueHistory.mockResolvedValue([]);
    mockGetLatestMovers.mockResolvedValue(null);
    renderIn(<ValueMoversCard />);
    expect(await screen.findByText('Price history builds after your next refresh.')).toBeTruthy();
  });

  it('renders the empty state when the latest movers record is stale', async () => {
    mockGetValueHistory.mockResolvedValue([]);
    mockGetLatestMovers.mockResolvedValue({
      day: '2020-01-01',
      at: new Date('2020-01-01').getTime(),
      movers: [
        {
          scryfallId: 's',
          finish: 'nonfoil',
          name: 'Old Card',
          setCode: 'tst',
          before: 1,
          after: 2,
          copies: 1,
        },
      ],
    });
    renderIn(<ValueMoversCard />);
    expect(await screen.findByText('Price history builds after your next refresh.')).toBeTruthy();
  });

  it('renders up to 3 fresh movers with a signed, formatted delta', async () => {
    mockGetValueHistory.mockResolvedValue([]);
    mockGetLatestMovers.mockResolvedValue({
      day: dayKey(Date.now()),
      at: Date.now(),
      movers: [
        {
          scryfallId: 'a',
          finish: 'nonfoil',
          name: 'Riser',
          setCode: 'tst',
          before: 1,
          after: 3,
          copies: 1,
        },
        {
          scryfallId: 'b',
          finish: 'nonfoil',
          name: 'Faller',
          setCode: 'tst',
          before: 5,
          after: 2,
          copies: 1,
        },
      ],
    });
    renderIn(<ValueMoversCard />);
    expect(await screen.findByText('Riser')).toBeTruthy();
    expect(screen.getByText('+$2.00')).toBeTruthy();
    expect(screen.getByText('Faller')).toBeTruthy();
    expect(screen.getByText('−$3.00')).toBeTruthy();
    const viewTrend = screen.getByRole('link', { name: 'View trend' });
    expect(viewTrend.getAttribute('href')).toBe('/collection');
  });

  it('renders a mover row thumbnail via useCardThumb, given the card name', async () => {
    mockUseCardThumb.mockReturnValue('riser-thumb.png');
    mockGetValueHistory.mockResolvedValue([]);
    mockGetLatestMovers.mockResolvedValue({
      day: dayKey(Date.now()),
      at: Date.now(),
      movers: [
        {
          scryfallId: 'a',
          finish: 'nonfoil',
          name: 'Riser',
          setCode: 'tst',
          before: 1,
          after: 3,
          copies: 1,
        },
      ],
    });
    const { container } = renderIn(<ValueMoversCard />);
    await screen.findByText('Riser');
    expect(mockUseCardThumb).toHaveBeenCalledWith('Riser', 'normal');
    const img = container.querySelector('.home-thumb img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('riser-thumb.png');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('carries polarity on the delta chip via glyph + sign + SR text, not color alone', async () => {
    mockGetValueHistory.mockResolvedValue([]);
    mockGetLatestMovers.mockResolvedValue({
      day: dayKey(Date.now()),
      at: Date.now(),
      movers: [
        {
          scryfallId: 'a',
          finish: 'nonfoil',
          name: 'Riser',
          setCode: 'tst',
          before: 1,
          after: 3,
          copies: 1,
        },
      ],
    });
    const { container } = renderIn(<ValueMoversCard />);
    await screen.findByText('Riser');
    const delta = container.querySelector('.home-movers-delta--up')!;
    expect(delta.textContent).toContain('▲');
    expect(delta.querySelector('.sr-only')?.textContent).toBe('up');
    expect(screen.getByText('(+200%)')).toBeTruthy();
  });

  it('skips the sparkline block entirely with fewer than 2 history points (rows still render)', async () => {
    mockGetValueHistory.mockResolvedValue([
      { day: dayKey(daysAgo(0)), value: 100, at: daysAgo(0) },
    ]);
    mockGetLatestMovers.mockResolvedValue({
      day: dayKey(Date.now()),
      at: Date.now(),
      movers: [
        {
          scryfallId: 'a',
          finish: 'nonfoil',
          name: 'Riser',
          setCode: 'tst',
          before: 1,
          after: 3,
          copies: 1,
        },
      ],
    });
    const { container } = renderIn(<ValueMoversCard />);
    await screen.findByText('Riser');
    expect(container.querySelector('.home-value-sparkline')).toBeNull();
    expect(container.querySelector('.home-value-hero')).toBeNull();
  });

  it('renders the value sparkline + hero figures with 2+ history points', async () => {
    mockGetValueHistory.mockResolvedValue([
      { day: dayKey(daysAgo(7)), value: 100, at: daysAgo(7) },
      { day: dayKey(daysAgo(0)), value: 130, at: daysAgo(0) },
    ]);
    mockGetLatestMovers.mockResolvedValue({
      day: dayKey(Date.now()),
      at: Date.now(),
      movers: [
        {
          scryfallId: 'a',
          finish: 'nonfoil',
          name: 'Riser',
          setCode: 'tst',
          before: 1,
          after: 3,
          copies: 1,
        },
      ],
    });
    const { container } = renderIn(<ValueMoversCard />);
    await screen.findByText('Riser');
    expect(screen.getByText('$130')).toBeTruthy();
    expect(screen.getByText('+$30 this week')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('.home-value-sparkline-line')).toBeTruthy());
    const sparkline = container.querySelector('.home-value-sparkline')!;
    expect(sparkline.getAttribute('tabindex')).toBe('0');
    const label = sparkline.getAttribute('aria-label') ?? '';
    expect(label).toContain('$100');
    expect(label).toContain('$130');
    expect(label).toContain('+30%');
  });
});

describe('NewArrivalsCard', () => {
  it('renders the empty state when no deck has qualifying arrivals', () => {
    mockUseDecksStore.mockImplementation((sel: (s: { decks: Deck[] }) => unknown) =>
      sel({ decks: [] })
    );
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: ArrivalCandidateCard[]; importHistory: [] }) => unknown) =>
        sel({ cards: [], importHistory: [] })
    );
    renderIn(<NewArrivalsCard />);
    expect(screen.getByText('No new arrivals to review.')).toBeTruthy();
  });

  it('lists a deck with its new-arrival count and a descriptive aria-label', () => {
    const deck = makeDeck({ id: 'atraxa', name: 'Atraxa Superfriends', updatedAt: 1000 });
    mockUseDecksStore.mockImplementation((sel: (s: { decks: Deck[] }) => unknown) =>
      sel({ decks: [deck] })
    );
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: ArrivalCandidateCard[]; importHistory: [] }) => unknown) =>
        sel({
          cards: [
            candidate({ name: 'Sol Ring', updatedAt: 2000 }),
            candidate({ name: 'Arcane Signet', updatedAt: 2000 }),
          ],
          importHistory: [],
        })
    );
    renderIn(<NewArrivalsCard />);
    expect(screen.getByText('Atraxa Superfriends')).toBeTruthy();
    expect(screen.getByText('— 2 new')).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'Open deck: Atraxa Superfriends, 2 new arrivals',
    });
    expect(link.getAttribute('href')).toBe('/decks/atraxa');
  });

  it('only links "View all" once more than 3 decks qualify', () => {
    const decks = Array.from({ length: 4 }, (_, i) =>
      makeDeck({ id: `d${i}`, name: `Deck ${i}`, updatedAt: i })
    );
    mockUseDecksStore.mockImplementation((sel: (s: { decks: Deck[] }) => unknown) =>
      sel({ decks })
    );
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: ArrivalCandidateCard[]; importHistory: [] }) => unknown) =>
        sel({ cards: [candidate({ name: 'Sol Ring', updatedAt: 999_999 })], importHistory: [] })
    );
    renderIn(<NewArrivalsCard />);
    // Only the 3 most-recently-updated qualifying decks render as rows.
    expect(screen.getAllByRole('link', { name: /^Open deck:/ })).toHaveLength(3);
    const viewAll = screen.getByRole('link', { name: 'View all' });
    expect(viewAll.getAttribute('href')).toBe('/decks');
  });

  it('renders an overlapping thumb fan (deduped card names, via useCardThumb) with the total count', () => {
    mockUseCardThumb.mockReturnValue('sol-ring.png');
    const deck = makeDeck({ id: 'atraxa', name: 'Atraxa Superfriends', updatedAt: 1000 });
    mockUseDecksStore.mockImplementation((sel: (s: { decks: Deck[] }) => unknown) =>
      sel({ decks: [deck] })
    );
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: ArrivalCandidateCard[]; importHistory: [] }) => unknown) =>
        sel({
          cards: [
            candidate({ name: 'Sol Ring', updatedAt: 2000 }),
            candidate({ name: 'Arcane Signet', updatedAt: 2000 }),
          ],
          importHistory: [],
        })
    );
    const { container } = renderIn(<NewArrivalsCard />);
    expect(screen.getByText('2 new')).toBeTruthy();
    const thumbs = container.querySelectorAll('.home-arrivals-fan-thumbs .home-thumb');
    expect(thumbs).toHaveLength(2);
    const img = container.querySelector('.home-arrivals-fan-thumbs img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('sol-ring.png');
    expect(img?.getAttribute('alt')).toBe('');
  });
});

describe('BinderReviewCard', () => {
  beforeEach(() => {
    mockUseAllocations.mockReturnValue(new Map());
    mockUseSetMap.mockReturnValue(undefined);
  });

  it('renders "No binders set up yet." with a setup CTA and never computes anything', () => {
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: EnrichedCard[]; binders: BinderDef[]; importHistory: [] }) => unknown) =>
        sel({ cards: [], binders: [], importHistory: [] })
    );
    renderIn(<BinderReviewCard />);
    expect(screen.getByText('No binders set up yet.')).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Set one up' });
    expect(cta.getAttribute('href')).toBe('/collection/binders');
    expect(mockMaterializeBinders).not.toHaveBeenCalled();
  });

  it('renders the skeleton synchronously, defers materializeBinders/computeDrift past first paint, then resolves the real count', async () => {
    const cheap = makeCard({ scryfallId: 'cheap', name: 'Cheap', purchasePrice: 8 });
    const reviewedBinder = makeBinder({
      filterGroups: [{ filter: { priceMin: 5 } }],
      lastReviewedSnapshot: {
        at: Date.now() - 86_400_000,
        keys: [],
        // Observed at $2 (under the $5 threshold) before, now $8 — just
        // qualified into the binder, so this is 1 pending "added" review.
        cardSnapshots: { [printingFinishKey(cheap)]: { price: 2 } },
      },
    });
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: EnrichedCard[]; binders: BinderDef[]; importHistory: [] }) => unknown) =>
        sel({ cards: [cheap], binders: [reviewedBinder], importHistory: [] })
    );

    renderIn(<BinderReviewCard />);

    // Skeleton first — the O(cards × binders) pass must not have run yet.
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(mockMaterializeBinders).not.toHaveBeenCalled();

    // Flush the deferred callback (happy-dom has no requestIdleCallback, so
    // the component falls back to setTimeout(0)).
    await waitFor(() => expect(mockMaterializeBinders).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText('1 card to review across 1 binder')).toBeTruthy();
  });

  it('renders "Binders are all caught up." with no CTA once every binder has zero pending review', async () => {
    const c = makeCard();
    // No lastReviewedSnapshot -> never-reviewed -> excluded from the total.
    const binder = makeBinder({ filterGroups: [{ filter: { priceMin: 5 } }] });
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: EnrichedCard[]; binders: BinderDef[]; importHistory: [] }) => unknown) =>
        sel({ cards: [c], binders: [binder], importHistory: [] })
    );
    renderIn(<BinderReviewCard />);
    expect(await screen.findByText('Binders are all caught up.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('TradeTargetsCard', () => {
  let entryCounter = 0;
  function entry(overrides: Partial<ListEntry> & { name: string }): ListEntry {
    return {
      id: `e${entryCounter++}`,
      scryfallId: 'sf',
      setCode: 'tst',
      collectorNumber: '1',
      finish: 'nonfoil',
      quantity: 1,
      ...overrides,
    };
  }

  function list(name: string, entries: ListEntry[]): ListDef {
    return { id: `list-${name}`, name, entries, order: 0, createdAt: 0, updatedAt: 0 };
  }

  function mockStore(lists: ListDef[], cards: EnrichedCard[] = []) {
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { lists: ListDef[]; cards: EnrichedCard[] }) => unknown) => sel({ lists, cards })
    );
  }

  it('renders nothing when there is no shortfall on any static want list', () => {
    mockStore([list('Wants', [])]);
    const { container } = renderIn(<TradeTargetsCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders rows with the badge count (distinct rows, not total shortfall) and a view-lists door', () => {
    mockStore([
      list('Wants', [
        entry({ name: 'Sol Ring', quantity: 2 }),
        entry({ name: 'Mana Vault', quantity: 1 }),
      ]),
    ]);
    const { container } = renderIn(<TradeTargetsCard />);
    expect(screen.getByRole('heading', { level: 2, name: 'Trade targets' })).toBeTruthy();
    expect(container.querySelector('.home-card-badge')?.textContent).toBe('2');
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'View lists' });
    expect(link.getAttribute('href')).toBe('/collection/lists');
  });

  it("renders a target price in the entry's own stamped currency, never the viewer default", () => {
    mockStore([
      list('Wants', [
        entry({ name: 'Mana Vault', targetPrice: 40, currency: 'EUR' }),
        entry({ name: 'Sol Ring', targetPrice: 5 }),
      ]),
    ]);
    renderIn(<TradeTargetsCard />);
    expect(screen.getByText('€40.00')).toBeTruthy();
    expect(screen.getByText('$5.00')).toBeTruthy();
  });

  it('shows "+N more" once a card is wanted on more than one list', () => {
    mockStore([
      list('Commander wants', [entry({ name: 'Sol Ring' })]),
      list('Cube wants', [entry({ name: 'Sol Ring' })]),
    ]);
    renderIn(<TradeTargetsCard />);
    expect(screen.getByText(/Commander wants/)).toBeTruthy();
    expect(screen.getByText(/\+1 more/)).toBeTruthy();
  });
});
