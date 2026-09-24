// @vitest-environment happy-dom
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pending } from '@/test/pending';
import type { Deck } from '../../store/decks';
import type { EnrichedCard, BinderDef } from '../../types';
import type { ArrivalCandidateCard } from '../../lib/new-arrivals';

vi.mock('../../lib/value-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/value-history')>();
  return { ...actual, getLatestMovers: vi.fn() };
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

import { PriceMoversCard } from './PriceMoversCard';
import { RecentlyAddedCard } from './RecentlyAddedCard';
import { useBinderReviewCount } from './use-binder-review-count';
import { getLatestMovers, dayKey } from '../../lib/value-history';
import { useDecksStore } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { useAllocations } from '../../lib/allocations';
import { useSetMap } from '../../lib/api';
import { materializeBinders } from '../../lib/materialize';
import { printingFinishKey } from '../../lib/collection-mutations';

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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('sc-home-shape');
  mockUseCardThumb.mockReturnValue(undefined);
  // Every card that resolves owned-printing art reads the collection; default
  // it to empty so a case that doesn't care needn't stub the store.
  mockUseCollectionStore.mockImplementation((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ cards: [], importHistory: [], binders: [], lists: [] })
  );
});

const riser = {
  scryfallId: 'a',
  finish: 'nonfoil',
  name: 'Riser',
  setCode: 'tst',
  before: 1,
  after: 3,
  copies: 1,
};

function freshMovers(movers = [riser]) {
  return { day: dayKey(Date.now()), at: Date.now(), movers };
}

describe('PriceMoversCard', () => {
  it('shows the loading skeleton while the IndexedDB read is in flight', () => {
    mockGetLatestMovers.mockReturnValue(pending(null));
    renderIn(<PriceMoversCard />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  // Nothing to show renders nothing (STYLE_GUIDE § Home): it used to be a
  // "Price history builds after your next refresh." row holding a grid cell.
  it('renders nothing when there is no movers record yet', async () => {
    mockGetLatestMovers.mockResolvedValue(null);
    const { container } = renderIn(<PriceMoversCard />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('renders nothing when the latest movers record is stale', async () => {
    mockGetLatestMovers.mockResolvedValue({
      day: '2020-01-01',
      at: new Date('2020-01-01').getTime(),
      movers: [{ ...riser, name: 'Old Card' }],
    });
    const { container } = renderIn(<PriceMoversCard />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('renders fresh movers with a signed, formatted delta and a "today" meta', async () => {
    mockGetLatestMovers.mockResolvedValue(
      freshMovers([riser, { ...riser, scryfallId: 'b', name: 'Faller', before: 5, after: 2 }])
    );
    renderIn(<PriceMoversCard />);
    expect(await screen.findByText('Riser')).toBeTruthy();
    expect(screen.getByText('+$2.00')).toBeTruthy();
    expect(screen.getByText('Faller')).toBeTruthy();
    expect(screen.getByText('−$3.00')).toBeTruthy();
    expect(screen.getByText('today')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View trend' }).getAttribute('href')).toBe(
      '/collection'
    );
  });

  it('caps the list at 4 movers', async () => {
    mockGetLatestMovers.mockResolvedValue(
      freshMovers(
        Array.from({ length: 6 }, (_, i) => ({ ...riser, scryfallId: `s${i}`, name: `Card ${i}` }))
      )
    );
    const { container } = renderIn(<PriceMoversCard />);
    await screen.findByText('Card 0');
    expect(container.querySelectorAll('.home-movers-row')).toHaveLength(4);
  });

  // One fact, one place: the collection total and its sparkline live in the
  // hero now. This card is only the cards that moved.
  it('never restates the collection total or draws the sparkline', async () => {
    mockGetLatestMovers.mockResolvedValue(freshMovers());
    const { container } = renderIn(<PriceMoversCard />);
    await screen.findByText('Riser');
    expect(container.querySelector('.home-value-sparkline')).toBeNull();
    expect(container.querySelector('.home-hero-value-amount')).toBeNull();
  });

  it('renders a mover thumbnail via useCardThumb, given the card name', async () => {
    mockUseCardThumb.mockReturnValue('riser-thumb.png');
    mockGetLatestMovers.mockResolvedValue(freshMovers());
    const { container } = renderIn(<PriceMoversCard />);
    await screen.findByText('Riser');
    expect(mockUseCardThumb).toHaveBeenCalledWith('Riser', 'normal');
    const img = container.querySelector('.home-thumb img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('riser-thumb.png');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('prefers the owned printing art over the name lookup, keyed on scryfallId', async () => {
    mockUseCardThumb.mockReturnValue('wrong-printing.png');
    mockUseCollectionStore.mockImplementation((sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        cards: [
          makeCard({ name: 'Riser', scryfallId: 'other-printing', imageNormal: 'not-mine.png' }),
          makeCard({ name: 'Riser', scryfallId: 'a', imageNormal: 'my-printing.png' }),
        ],
        importHistory: [],
      })
    );
    mockGetLatestMovers.mockResolvedValue(freshMovers());
    const { container } = renderIn(<PriceMoversCard />);
    await screen.findByText('Riser');
    const img = container.querySelector('.home-thumb img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('my-printing.png');
    expect(mockUseCardThumb).toHaveBeenCalledWith(undefined, 'normal');
  });

  it('carries polarity via glyph + sign + SR text, not colour alone', async () => {
    mockGetLatestMovers.mockResolvedValue(freshMovers());
    const { container } = renderIn(<PriceMoversCard />);
    await screen.findByText('Riser');
    const delta = container.querySelector('.home-movers-delta--up')!;
    expect(delta.textContent).toContain('▲');
    expect(delta.querySelector('.sr-only')?.textContent).toBe('up');
    expect(screen.getByText('(+200%)')).toBeTruthy();
  });
});

describe('RecentlyAddedCard', () => {
  function stores(opts: {
    decks?: Deck[];
    cards?: unknown[];
    importHistory?: unknown[];
    hydrating?: boolean;
    decksHydrated?: boolean;
  }) {
    mockUseDecksStore.mockImplementation((sel: (s: Record<string, unknown>) => unknown) =>
      sel({ decks: opts.decks ?? [], hydrated: opts.decksHydrated ?? true })
    );
    mockUseCollectionStore.mockImplementation((sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        cards: opts.cards ?? [],
        importHistory: opts.importHistory ?? [],
        hydrating: opts.hydrating ?? false,
      })
    );
  }

  const importEntry = (id: string, count: number, addedAt: number) => ({
    id,
    name: 'pasted-list',
    count,
    format: 'plain',
    addedAt,
  });

  it('shows the skeleton while the stores are still hydrating (E277)', () => {
    stores({ hydrating: true, decksHydrated: false });
    renderIn(<RecentlyAddedCard />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('renders nothing before any import', () => {
    stores({});
    const { container } = renderIn(<RecentlyAddedCard />);
    expect(container.innerHTML).toBe('');
  });

  // The old card summed per-deck counts ("326 new"), counting a card once per
  // deck it fit. The figure here is the import's own card count.
  it("headlines the LATEST import's own card count, not a sum across decks", () => {
    stores({
      importHistory: [importEntry('old', 900, 1000), importEntry('new', 118, 5000)],
    });
    const { container } = renderIn(<RecentlyAddedCard />);
    expect(container.querySelector('.home-added-count')?.textContent).toBe('118');
    expect(screen.getByText(/^Imported /)).toBeTruthy();
  });

  it("fans that import's own cards, deduped by name, owned art first", () => {
    mockUseCardThumb.mockReturnValue('looked-up.png');
    stores({
      importHistory: [importEntry('imp', 3, 5000)],
      cards: [
        makeCard({ name: 'Sol Ring', importId: 'imp', imageNormal: 'my-sol-ring.png' }),
        makeCard({ name: 'Sol Ring', importId: 'imp', imageNormal: 'my-sol-ring.png' }),
        makeCard({ name: 'Arcane Signet', importId: 'imp' }),
        makeCard({ name: 'Elsewhere', importId: 'other', imageNormal: 'no.png' }),
      ],
    });
    const { container } = renderIn(<RecentlyAddedCard />);
    const imgs = [...container.querySelectorAll('.home-added-fan img')].map((i) =>
      i.getAttribute('src')
    );
    expect(imgs).toEqual(['my-sol-ring.png', 'looked-up.png']);
  });

  it('lists the decks with new cards that fit, linking each', () => {
    const deck = makeDeck({ id: 'atraxa', name: 'Atraxa Superfriends', updatedAt: 1000 });
    stores({
      decks: [deck],
      importHistory: [importEntry('imp', 2, 5000)],
      cards: [
        candidate({ name: 'Sol Ring', updatedAt: 2000 }),
        candidate({ name: 'Arcane Signet', updatedAt: 2000 }),
      ],
    });
    renderIn(<RecentlyAddedCard />);
    const link = screen.getByRole('link', {
      name: 'Open deck: Atraxa Superfriends, 2 new cards that fit',
    });
    expect(link.getAttribute('href')).toBe('/decks/atraxa');
    expect(screen.getByText('2 fit')).toBeTruthy();
  });
});

describe('useBinderReviewCount', () => {
  const allocations = new Map();
  beforeEach(() => {
    mockUseAllocations.mockReturnValue(allocations);
    mockUseSetMap.mockReturnValue(undefined);
  });

  it('is null (still computing) while the collection is hydrating, and never computes', () => {
    mockUseCollectionStore.mockImplementation((sel: (s: Record<string, unknown>) => unknown) =>
      sel({ cards: [], binders: [], importHistory: [], hydrating: true })
    );
    const { result } = renderHook(() => useBinderReviewCount());
    expect(result.current).toBeNull();
    expect(mockMaterializeBinders).not.toHaveBeenCalled();
  });

  it('is a zero count with no binders, without computing anything', () => {
    mockUseCollectionStore.mockImplementation((sel: (s: Record<string, unknown>) => unknown) =>
      sel({ cards: [], binders: [], importHistory: [] })
    );
    const { result } = renderHook(() => useBinderReviewCount());
    expect(result.current).toEqual({ count: 0, binderCount: 0 });
    expect(mockMaterializeBinders).not.toHaveBeenCalled();
  });

  it('defers materializeBinders past first render, then resolves the real count', async () => {
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
    // Stable references, as the real store hands out: fresh arrays per render
    // would re-run the deferred effect on every state change.
    const state = { cards: [cheap], binders: [reviewedBinder], importHistory: [] };
    mockUseCollectionStore.mockImplementation((sel: (s: typeof state) => unknown) => sel(state));

    const { result } = renderHook(() => useBinderReviewCount());
    // The O(cards × binders) pass must not have run during render.
    expect(result.current).toBeNull();
    expect(mockMaterializeBinders).not.toHaveBeenCalled();

    // happy-dom has no requestIdleCallback, so the hook falls back to setTimeout(0).
    await waitFor(() => expect(result.current).toEqual({ count: 1, binderCount: 1 }));
    expect(mockMaterializeBinders).toHaveBeenCalledTimes(1);
  });

  it('is zero once every binder is caught up', async () => {
    const binder = makeBinder({ filterGroups: [{ filter: { priceMin: 5 } }] });
    mockUseCollectionStore.mockImplementation(
      (sel: (s: { cards: EnrichedCard[]; binders: BinderDef[]; importHistory: [] }) => unknown) =>
        sel({ cards: [makeCard()], binders: [binder], importHistory: [] })
    );
    const { result } = renderHook(() => useBinderReviewCount());
    await waitFor(() => expect(result.current).toEqual({ count: 0, binderCount: 1 }));
  });
});
