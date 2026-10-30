// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard, ProductResolveResponse } from '@/types/index';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { useCubeStore } from '@/store/cube';
import { useToastsStore } from '@/store/toasts';
import { setApplyingServer } from '@/lib/sync/applying-server';
import { useAddBoxExtras } from './use-box-extras';

vi.mock('@/lib/sync', () => ({
  persistDecksState: vi.fn().mockResolvedValue(undefined),
  persistCubesState: vi.fn().mockResolvedValue(undefined),
  persistCollectionState: vi.fn().mockResolvedValue(undefined),
}));
const fetchProduct = vi.fn<(fileName: string) => Promise<ProductResolveResponse>>();
vi.mock('@/lib/api', () => ({ fetchProduct: (f: string) => fetchProduct(f) }));

// A deck added from a product before In the box existed: its display
// commander sits free in the collection, and this is how it gets claimed.

const zada = { name: 'Zada, Hedron Grinder', id: 'zada' } as ScryfallCard;
const display = { name: 'Zada, Hedron Grinder', id: 'zada-oversized' } as ScryfallCard;
const owned = (copyId: string, scryfallId: string) =>
  ({ copyId, name: zada.name, scryfallId, finish: 'nonfoil' }) as EnrichedCard;

const makeDeck = (over: Partial<Deck> = {}): Deck => ({
  id: 'd1',
  name: 'Odds & Ends',
  source: 'manual',
  format: 'commander',
  commander: zada,
  partnerCommander: null,
  commanderAllocatedCopyId: 'cmd',
  partnerCommanderAllocatedCopyId: null,
  cards: [],
  sideboard: [],
  considering: [],
  generationContext: null,
  color: '#7a8a70',
  createdAt: 0,
  updatedAt: 0,
  sourceProduct: { code: 'SLD', fileName: 'OddsEnds_SLD', name: 'Odds & Ends' },
  ...over,
});

const product = (physicalCards: ProductResolveResponse['physicalCards']) =>
  ({ physicalCards }) as ProductResolveResponse;
const current = () => useDecksStore.getState().decks[0];
const lastToast = () => useToastsStore.getState().toasts.at(-1)?.message;
const run = async () => {
  const { result } = renderHook(() => useAddBoxExtras(current()));
  await act(async () => {
    result.current!();
    await vi.waitFor(() => expect(lastToast()).toBeDefined());
  });
};

beforeEach(() => {
  setApplyingServer(false);
  fetchProduct.mockReset();
  useCubeStore.setState({ saved: [] });
  useToastsStore.setState({ toasts: [] });
  useCollectionStore.setState({ cards: [owned('cmd', 'zada'), owned('box', 'zada-oversized')] });
});

describe('useAddBoxExtras', () => {
  it('is absent for a deck that did not come from a product', () => {
    useDecksStore.setState({ decks: [makeDeck({ sourceProduct: undefined })] });
    expect(renderHook(() => useAddBoxExtras(current())).result.current).toBeUndefined();
  });

  it('is absent once the box has cards', () => {
    useDecksStore.setState({
      decks: [makeDeck({ extras: [{ slotId: 'x', card: display, allocatedCopyId: 'box' }] })],
    });
    expect(renderHook(() => useAddBoxExtras(current())).result.current).toBeUndefined();
  });

  it("adds the box's extras, each claiming its free copy", async () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    fetchProduct.mockResolvedValue(
      product([
        { card: zada, quantity: 1, finish: 'nonfoil', zone: 'commander' },
        { card: display, quantity: 1, finish: 'nonfoil', zone: 'displayCommander' },
        {
          card: { name: 'Goblin', id: 'gob' } as ScryfallCard,
          quantity: 1,
          finish: 'nonfoil',
          zone: 'tokens',
        },
      ])
    );
    await run();
    expect(fetchProduct).toHaveBeenCalledWith('OddsEnds_SLD');
    expect(current().extras).toEqual([
      expect.objectContaining({ card: display, allocatedCopyId: 'box' }),
    ]);
    // The command zone keeps its own copy.
    expect(current().commanderAllocatedCopyId).toBe('cmd');
    expect(lastToast()).toBe('Added Zada, Hedron Grinder to the box.');
  });

  it('says when an extra has no free copy', async () => {
    useCollectionStore.setState({ cards: [owned('cmd', 'zada')] });
    useDecksStore.setState({ decks: [makeDeck()] });
    fetchProduct.mockResolvedValue(
      product([{ card: display, quantity: 1, finish: 'nonfoil', zone: 'displayCommander' }])
    );
    await run();
    expect(current().extras?.[0].allocatedCopyId).toBeNull();
    expect(lastToast()).toBe(
      'Added Zada, Hedron Grinder to the box. It has no free copy in your collection.'
    );
  });

  it('says so when the box has nothing beyond the deck', async () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    fetchProduct.mockResolvedValue(
      product([{ card: zada, quantity: 1, finish: 'nonfoil', zone: 'commander' }])
    );
    await run();
    expect(current().extras).toBeUndefined();
    expect(lastToast()).toBe('Odds & Ends has no other cards in the box.');
  });

  it('leaves the deck alone when the product will not load', async () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    fetchProduct.mockRejectedValue(new Error('offline'));
    await run();
    expect(current().extras).toBeUndefined();
    expect(useToastsStore.getState().toasts.at(-1)?.tone).toBe('error');
  });
});
