// @vitest-environment happy-dom
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';
import { useCollectionStore } from '@/store/collection';
import { useToastsStore } from '@/store/toasts';
import { getCardByNameResilient, getOwnedPrinting } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard, Finish } from '@/types';

// Name-only entries enrich in the background through the scryfall client; mock it
// so the test stays offline and deterministic.
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardByName: vi.fn(),
  getCardByNameResilient: vi.fn(),
  getOwnedPrinting: vi.fn(),
}));

const mockResolve = vi.mocked(getCardByNameResilient);
const mockOwnedPrinting = vi.mocked(getOwnedPrinting);

// Capture the cards/index/getActions CardPreview is handed so we can assert
// what the hook produced without depending on the real (DOM-heavy) preview.
type WiredGetActions = ((i: number) => unknown[]) | undefined;
const previewCards = vi.fn<(cards: EnrichedCard[]) => void>();
const previewIndex = vi.fn<(index: number) => void>();
const previewGetActions = vi.fn<(getActions: WiredGetActions) => void>();
vi.mock('@/components/CardPreview', () => ({
  CardPreview: ({
    cards,
    index,
    getActions,
  }: {
    cards: EnrichedCard[];
    index: number;
    getActions?: (i: number) => unknown[];
  }) => {
    previewCards(cards);
    previewIndex(index);
    previewGetActions(getActions);
    return null;
  },
}));

function scry(name: string, oracleId: string): ScryfallCard {
  return {
    id: `print-${name}`,
    oracle_id: oracleId,
    name,
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    rarity: 'rare',
    finishes: ['nonfoil', 'foil', 'etched'],
  } as unknown as ScryfallCard;
}

function owned(name: string, oracleId: string, finish: Finish): EnrichedCard {
  return scryfallToEnrichedCard(scry(name, oracleId), finish);
}

beforeEach(() => {
  useCollectionStore.setState({ cards: [] });
  useToastsStore.getState().clear();
  previewCards.mockClear();
  previewIndex.mockClear();
  previewGetActions.mockClear();
  mockResolve.mockReset();
  mockOwnedPrinting.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  useCollectionStore.setState({ cards: [] });
  useToastsStore.getState().clear();
});

/** Open with the given entries and return the (synchronously enriched) tapped
 *  card CardPreview was handed. Used by the shimmer tests, which pass full
 *  `card`s so resolution is synchronous. */
function openAndCapture(entries: CarouselEntry[], tapped: string): EnrichedCard {
  const { result } = renderHook(() => useCardCarousel('Test Binder'));
  act(() => {
    result.current.open(entries, tapped);
  });
  // Mount the preview so the mocked CardPreview runs and captures the cards.
  expect(result.current.preview).not.toBeNull();
  render(result.current.preview);
  const lastCall = previewCards.mock.calls.at(-1);
  expect(lastCall).toBeDefined();
  const cards = lastCall![0];
  const card = cards.find((c) => c.name === tapped);
  expect(card).toBeDefined();
  return card!;
}

describe('useCardCarousel ownership shimmer', () => {
  it('resolves an owned-foil card with the foil finish', () => {
    useCollectionStore.setState({ cards: [owned('Sol Ring', 'oracle-sol', 'foil')] });
    const card = openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('foil');
    expect(card.foil).toBe(true);
  });

  it('prefers foil over etched when both are owned', () => {
    useCollectionStore.setState({
      cards: [owned('Sol Ring', 'oracle-sol', 'etched'), owned('Sol Ring', 'oracle-sol', 'foil')],
    });
    const card = openAndCapture(
      [{ name: 'Sol Ring', label: '2 copies', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('foil');
  });

  it('uses etched when only an etched copy is owned', () => {
    useCollectionStore.setState({ cards: [owned('Sol Ring', 'oracle-sol', 'etched')] });
    const card = openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('etched');
  });

  it('keeps an unowned card nonfoil', () => {
    // Collection has a different card → no oracleId match → no shimmer.
    useCollectionStore.setState({ cards: [owned('Counterspell', 'oracle-cs', 'foil')] });
    const card = openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('nonfoil');
    expect(card.foil).toBe(false);
  });

  it('stays nonfoil when only a nonfoil copy is owned', () => {
    useCollectionStore.setState({ cards: [owned('Sol Ring', 'oracle-sol', 'nonfoil')] });
    const card = openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('nonfoil');
  });

  it('falls back to name match when the resolved card has no oracleId', () => {
    // Resolved card has no oracleId (legacy/edge), so matching must fall back to
    // the card name. The owned foil copy still shimmers.
    const noOracleScry = {
      ...scry('Sol Ring', ''),
      oracle_id: undefined,
    } as unknown as ScryfallCard;
    useCollectionStore.setState({
      cards: [scryfallToEnrichedCard(noOracleScry, 'foil')],
    });
    const card = openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: noOracleScry }],
      'Sol Ring'
    );
    expect(card.finish).toBe('foil');
  });
});

describe('useCardCarousel instant open', () => {
  it('opens immediately with every entry as a slot, in lane order, at the tapped index', () => {
    const { result } = renderHook(() => useCardCarousel('Test Binder'));
    act(() => {
      result.current.open(
        [
          { name: 'Sol Ring', label: 'a' },
          { name: 'Counterspell', label: 'b' },
          { name: 'Llanowar Elves', label: 'c' },
        ],
        'Counterspell'
      );
    });
    render(result.current.preview);
    const cards = previewCards.mock.calls.at(-1)![0];
    // Whole lane present + swipeable up front (name-only placeholders), in order…
    expect(cards.map((c) => c.name)).toEqual(['Sol Ring', 'Counterspell', 'Llanowar Elves']);
    // …opening art-less (no bare img against the rate-limited API host — CDN art
    // streams in via windowed enrichment instead)…
    expect(cards[0].imageNormal).toBeUndefined();
    // …and the carousel lands on the tapped card, not index 0.
    expect(previewIndex.mock.calls.at(-1)![0]).toBe(1);
  });

  it('enriches the focused name-only card in the background via the resilient resolver', async () => {
    mockResolve.mockResolvedValue(scry('Sol Ring', 'oracle-sol'));
    const { result } = renderHook(() => useCardCarousel('Test Binder'));
    act(() => {
      result.current.open([{ name: 'Sol Ring', label: 'In 80% of decks' }], 'Sol Ring');
    });
    // Opens instantly with a placeholder, then pulls full data for what's in view.
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('Sol Ring'));
  });

  it('resolves a name-only entry to the OWNED printing when the card is in the collection', async () => {
    // The player owns Sol Ring (printing id "print-Sol Ring"); a name-only entry
    // must show THAT printing, not Scryfall's default — resolved by scryfallId.
    useCollectionStore.setState({ cards: [owned('Sol Ring', 'oracle-sol', 'nonfoil')] });
    mockOwnedPrinting.mockResolvedValue(scry('Sol Ring', 'oracle-sol'));
    const { result } = renderHook(() => useCardCarousel('Test Binder'));
    act(() => {
      result.current.open([{ name: 'Sol Ring', label: '1 copy' }], 'Sol Ring');
    });
    await waitFor(() =>
      expect(mockOwnedPrinting).toHaveBeenCalledWith('print-Sol Ring', 'Sol Ring')
    );
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('falls back to name resolution for an unowned name-only entry (suggestion)', async () => {
    // Collection holds a different card → Sol Ring is unowned → default printing.
    useCollectionStore.setState({ cards: [owned('Counterspell', 'oracle-cs', 'foil')] });
    mockResolve.mockResolvedValue(scry('Sol Ring', 'oracle-sol'));
    const { result } = renderHook(() => useCardCarousel('Test Binder'));
    act(() => {
      result.current.open([{ name: 'Sol Ring', label: 'In 80% of decks' }], 'Sol Ring');
    });
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('Sol Ring'));
    expect(mockOwnedPrinting).not.toHaveBeenCalled();
  });
});

describe('useCardCarousel actions', () => {
  it('keys getActions by the entry the carousel opened with, not a live row index', () => {
    const getActions = vi.fn((entry: CarouselEntry) => [
      { key: 'add', icon: null, label: `Add ${entry.name}`, onClick: () => {} },
    ]);
    const { result } = renderHook(() => useCardCarousel('Test Binder', getActions));
    act(() => {
      result.current.open(
        [
          { name: 'Sol Ring', label: 'a' },
          { name: 'Counterspell', label: 'b' },
        ],
        'Sol Ring'
      );
    });
    render(result.current.preview);
    const wired = previewGetActions.mock.calls.at(-1)![0];
    expect(wired).toBeDefined();
    expect(wired!(1)).toMatchObject([{ key: 'add', label: 'Add Counterspell' }]);
    expect(getActions).toHaveBeenCalledWith(expect.objectContaining({ name: 'Counterspell' }), 1);
    // Out-of-range slide (defensive) → an empty icon bar, not a crash.
    expect(wired!(9)).toEqual([]);
  });

  it('passes no getActions through when the hook was given none', () => {
    const { result } = renderHook(() => useCardCarousel('Test Binder'));
    act(() => {
      result.current.open([{ name: 'Sol Ring', label: 'a' }], 'Sol Ring');
    });
    render(result.current.preview);
    expect(previewGetActions.mock.calls.at(-1)![0]).toBeUndefined();
  });
});

describe('useCardCarousel resilience', () => {
  it('still opens with a usable placeholder when enrichment fails — never a dead end', () => {
    // Even when the resolver can't enrich (offline incomplete + live miss), the
    // card still opens as a named, swipeable slot (art-less, no rate-limited img).
    // No silent dead-end, no toast.
    mockResolve.mockResolvedValue(null);
    const { result } = renderHook(() => useCardCarousel('Test Binder'));
    act(() => {
      result.current.open([{ name: 'Sol Ring', label: 'x' }], 'Sol Ring');
    });
    render(result.current.preview);
    const cards = previewCards.mock.calls.at(-1)![0];
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Sol Ring');
    expect(cards[0].imageNormal).toBeUndefined();
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });
});
