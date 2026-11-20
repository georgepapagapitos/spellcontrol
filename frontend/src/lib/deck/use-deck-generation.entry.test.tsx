// @vitest-environment happy-dom
/**
 * What the New deck page hands the generator, per "Cards from" setting, and the
 * warning before a build the collection can't supply (E1119).
 *
 * E1118 shipped because every generator test set its own strategy: the store's
 * default ('available' with collection mode off) reached the generator from
 * here and nowhere else. These rows pin the pairing of strategy, owned names
 * and free-copy counts for every setting, starting from the store's defaults.
 */
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customization, ScryfallCard } from '@/deck-builder/types';
import type { GenerationContext } from '@/deck-builder/services/deckBuilder/deckGeneration/state';
import type { EnrichedCard } from '@/types/index';

// Decks that hold copies. Set per test; the store mock reads it on each render.
const decksHolder = vi.hoisted(() => ({ decks: [] as unknown[] }));
vi.mock('@/store/decks', () => ({
  useDecksStore: Object.assign(
    (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
      sel({ decks: decksHolder.decks, createDeck: () => 'id' }),
    { getState: () => ({ decks: decksHolder.decks }) }
  ),
}));
vi.mock('@/lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
vi.mock('@/deck-builder/services/edhrec/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: vi.fn(async () => null),
}));

// The generator itself is the settings matrix's subject. Here it only records
// what it was handed, then stops the build before anything is saved.
const generateDeck = vi.fn(async (_ctx: GenerationContext) => {
  throw new Error('stop after the hand-off');
});
vi.mock('@/deck-builder/services/deckBuilder/deckGenerator', () => ({
  generateDeck: (ctx: GenerationContext) => generateDeck(ctx),
}));

import { useDeckGeneration } from './use-deck-generation';
import { defaultCustomization, useDeckBuilderStore } from '@/deck-builder/store';
import { useCollectionStore } from '@/store/collection';

const TALRAND = {
  id: 'talrand',
  name: 'Talrand, Sky Summoner',
  color_identity: ['U'],
  type_line: 'Legendary Creature — Merfolk Wizard',
} as ScryfallCard;
const ownedCards = (n: number): EnrichedCard[] =>
  Array.from(
    { length: n },
    (_, i) =>
      ({
        copyId: `copy-${i}`,
        name: `Blue Spell ${i}`,
        colorIdentity: ['U'],
        typeLine: 'Instant',
        cmc: 2,
      }) as unknown as EnrichedCard
  );
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

function setUp(cz: Partial<Customization>, owned: number, sourceDeckId?: string) {
  useCollectionStore.setState({ cards: ownedCards(owned) });
  const store = useDeckBuilderStore.getState();
  store.setCommander(TALRAND);
  store.updateCustomization(cz);
  return renderHook(() => useDeckGeneration({ sourceDeckId }), { wrapper });
}
/** A deck holding the first `n` owned copies. */
const deckHolding = (id: string, n: number) => ({
  id,
  name: id,
  cards: ownedCards(n).map((c) => ({ card: { name: c.name }, allocatedCopyId: c.copyId })),
});
const handedOver = () => generateDeck.mock.calls[0]?.[0];

describe('useDeckGeneration: what reaches the generator', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
    generateDeck.mockClear();
  });

  it('the store defaults hand over no collection at all', async () => {
    expect(defaultCustomization.collectionMode).toBe(false);
    const { result } = setUp({}, 200);
    await act(() => result.current.build());

    const ctx = handedOver();
    expect(ctx?.customization.collectionStrategy).toBe(defaultCustomization.collectionStrategy);
    expect(ctx?.collectionNames).toBeUndefined();
    expect(ctx?.collectionAvailableCounts).toBeUndefined();
    expect(ctx?.collectionPool).toBeUndefined();
    expect(result.current.shortfall).toBeNull();
  });

  it.each([
    ['available', true],
    ['full', false],
    ['prefer', false],
    ['partial', false],
  ] as const)('"%s" hands over owned names, and counts only for free copies', async (s, counts) => {
    const { result } = setUp({ collectionMode: true, collectionStrategy: s }, 200);
    await act(() => result.current.build());

    const ctx = handedOver();
    expect(ctx?.collectionNames?.size).toBe(200);
    expect(ctx?.collectionAvailableCounts !== undefined).toBe(counts);
    expect(ctx?.collectionPool).toHaveLength(200);
    expect(ctx?.excludedOwnedNames).toBeUndefined();
  });

  it('"exclude" hands over the names to leave out and no owned pool', async () => {
    const { result } = setUp({ collectionMode: true, collectionStrategy: 'exclude' }, 200);
    await act(() => result.current.build());

    const ctx = handedOver();
    expect(ctx?.excludedOwnedNames?.size).toBe(200);
    expect(ctx?.collectionNames).toBeUndefined();
    expect(ctx?.collectionAvailableCounts).toBeUndefined();
  });
});

// E1117: a Regenerate could not reuse the cards of the deck it was rebuilding.
describe('useDeckGeneration: Regenerate of an "Only mine" deck', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
    generateDeck.mockClear();
    decksHolder.decks = [deckHolding('source', 70), deckHolding('other', 0)];
  });
  afterEach(() => {
    decksHolder.decks = [];
  });
  const onlyMine = { collectionMode: true, collectionStrategy: 'available' } as const;

  it("counts the source deck's own copies as free, with no warning", async () => {
    const { result } = setUp({ ...onlyMine, landCount: 35 }, 100, 'source');
    await act(() => result.current.build());

    expect(result.current.shortfall).toBeNull();
    const ctx = handedOver();
    expect(ctx?.collectionNames?.size).toBe(100);
    expect(ctx?.collectionAvailableCounts?.get('Blue Spell 0')).toBe(1);
  });

  it("still holds back another deck's copies", async () => {
    const { result } = setUp({ ...onlyMine, landCount: 35 }, 100);
    await act(() => result.current.build());

    // 30 free of the 64 needed: the build asks first.
    expect(generateDeck).not.toHaveBeenCalled();
    expect(result.current.shortfall).toMatchObject({ have: 30, need: 64 });
  });
});

describe('useDeckGeneration: a build the collection cannot supply', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
    generateDeck.mockClear();
  });

  it.each(['available', 'full'] as const)('"%s" asks before building', async (s) => {
    const { result } = setUp({ collectionMode: true, collectionStrategy: s, landCount: 35 }, 41);
    await act(() => result.current.build());

    expect(generateDeck).not.toHaveBeenCalled();
    expect(result.current.isBuilding).toBe(false);
    expect(result.current.shortfall).toMatchObject({ kind: 'collection', have: 41, need: 64 });
  });

  it('asks when every owned card is off-color', async () => {
    useCollectionStore.setState({
      cards: ownedCards(200).map((c) => ({ ...c, colorIdentity: ['R'] })),
    });
    const store = useDeckBuilderStore.getState();
    store.setCommander(TALRAND);
    store.updateCustomization({ collectionMode: true, collectionStrategy: 'full' });
    const { result } = renderHook(() => useDeckGeneration(), { wrapper });
    await act(() => result.current.build());

    expect(generateDeck).not.toHaveBeenCalled();
    expect(result.current.shortfall).toMatchObject({ have: 0 });
  });

  it('Adjust settings drops the question and builds nothing', async () => {
    const { result } = setUp({ collectionMode: true, collectionStrategy: 'full' }, 41);
    await act(() => result.current.build());
    act(() => result.current.dismissShortfall());

    expect(result.current.shortfall).toBeNull();
    expect(generateDeck).not.toHaveBeenCalled();
  });

  it('Build anyway builds once, and the next build asks again', async () => {
    const { result } = setUp({ collectionMode: true, collectionStrategy: 'full' }, 41);
    await act(() => result.current.build());
    act(() => result.current.buildAnyway());
    await waitFor(() => expect(generateDeck).toHaveBeenCalledTimes(1));
    expect(result.current.shortfall).toBeNull();
    await waitFor(() => expect(result.current.isBuilding).toBe(false));

    await act(() => result.current.build());
    expect(generateDeck).toHaveBeenCalledTimes(1);
    expect(result.current.shortfall).not.toBeNull();
  });

  it('an owned share short of its percent asks too', async () => {
    const { result } = setUp(
      {
        collectionMode: true,
        collectionStrategy: 'partial',
        collectionOwnedPercent: 75,
        landCount: 35,
      },
      41
    );
    await act(() => result.current.build());

    expect(generateDeck).not.toHaveBeenCalled();
    expect(result.current.shortfall).toMatchObject({ kind: 'share', have: 41, need: 48 });
  });

  it('"prefer" and a collection that covers the deck build straight away', async () => {
    const first = setUp({ collectionMode: true, collectionStrategy: 'prefer' }, 5);
    await act(() => first.result.current.build());
    expect(generateDeck).toHaveBeenCalledTimes(1);
    first.unmount();

    useDeckBuilderStore.getState().reset();
    const second = setUp({ collectionMode: true, collectionStrategy: 'full', landCount: 35 }, 64);
    await act(() => second.result.current.build());
    expect(generateDeck).toHaveBeenCalledTimes(2);
    expect(second.result.current.shortfall).toBeNull();
  });
});
