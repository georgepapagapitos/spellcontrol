import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { useDecksStore, type Deck, type DeckCard } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useCollectionStore } from '@/store/collection';
import { setApplyingServer } from '@/lib/sync/applying-server';
import {
  applyCheapestPrintings,
  applyMatchMyCopies,
  applyPrintingSwaps,
  copyMismatches,
  deckSlots,
  missingSlots,
  planCheapestPrintings,
  planMatchCopies,
  PrintingLookupOfflineError,
} from './deck-printing-actions';

// Same contract as apply-upgrade-plan.test.ts: the decks store's heal
// subscriber persists through ./sync, mocked so writes can be counted.
const persistDecksState = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/sync', () => ({
  persistDecksState: (...args: unknown[]) => persistDecksState(...args),
}));

const byName = new Map<string, ScryfallCard>();
const byId = new Map<string, ScryfallCard>();
const forceLive = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: async (names: string[]) =>
    new Map(names.filter((n) => byName.has(n)).map((n) => [n, byName.get(n)!])),
  getCardsByIds: async (ids: string[]) =>
    new Map(ids.filter((i) => byId.has(i)).map((i) => [i, byId.get(i)!])),
  setForceLiveSearch: (v: boolean) => forceLive(v),
  getCardPrice: (card: ScryfallCard, currency: 'USD' | 'EUR') =>
    (currency === 'EUR' ? card.prices?.eur : card.prices?.usd) ?? null,
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

function sc(name: string, id: string, usd?: number, eur?: number): ScryfallCard {
  return {
    id,
    name,
    oracle_id: `o-${name}`,
    prices: {
      usd: usd == null ? null : String(usd),
      eur: eur == null ? null : String(eur),
    },
  } as unknown as ScryfallCard;
}

const slot = (slotId: string, card: ScryfallCard, allocatedCopyId: string | null = null) =>
  ({ slotId, card, allocatedCopyId }) as DeckCard;

const copy = (copyId: string, scryfallId: string, name = 'x') =>
  ({ copyId, scryfallId, name }) as unknown as EnrichedCard;

function makeDeck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Zimone',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const solRing = sc('Sol Ring', 'sol-pricey', 5);
const solCheap = sc('Sol Ring', 'sol-cheap', 1);
const bolt = sc('Lightning Bolt', 'bolt-pricey', 3);
const boltCheap = sc('Lightning Bolt', 'bolt-cheap', 0.5);

describe('deckSlots / missingSlots', () => {
  it('lists commander seats, then every zone', () => {
    const deck = makeDeck({
      commander: sc('Zimone', 'z1', 2),
      partnerCommander: sc('Tana', 't1', 1),
      partnerCommanderAllocatedCopyId: 'cT',
      cards: [slot('a', solRing)],
      sideboard: [slot('b', bolt)],
      considering: undefined as unknown as DeckCard[],
    });
    expect(deckSlots(deck).map((s) => s.ref.zone)).toEqual([
      'commander',
      'partnerCommander',
      'cards',
      'sideboard',
    ]);
  });

  it('is empty until the collection is known', () => {
    expect(missingSlots(makeDeck({ cards: [slot('a', solRing)] }), undefined)).toEqual([]);
  });

  it('counts unowned and orphaned slots, never a bound copy', () => {
    const deck = makeDeck({
      commander: sc('Zimone', 'z1', 2),
      commanderAllocatedCopyId: 'c1',
      cards: [slot('a', solRing, 'c2'), slot('b', solRing, 'gone'), slot('c', bolt)],
      considering: [slot('d', bolt)],
    });
    const collection = new Map([
      ['c1', copy('c1', 'z1')],
      ['c2', copy('c2', 'sol-pricey')],
    ]);
    expect(missingSlots(deck, collection).map((s) => s.ref)).toEqual([
      { zone: 'cards', slotId: 'b' },
      { zone: 'cards', slotId: 'c' },
      { zone: 'considering', slotId: 'd' },
    ]);
  });
});

describe('planCheapestPrintings', () => {
  const empty = new Map<string, EnrichedCard>();

  it('swaps a missing slot to a cheaper printing and totals the saving', () => {
    const deck = makeDeck({
      commander: sc('Zimone', 'z-pricey', 10),
      cards: [slot('a', solRing), slot('b', bolt)],
    });
    const cheapest = new Map([
      ['Sol Ring', solCheap],
      ['Lightning Bolt', boltCheap],
      ['Zimone', sc('Zimone', 'z-cheap', 4)],
    ]);
    const plan = planCheapestPrintings(deck, empty, cheapest, 'USD');
    expect(plan.swaps.map((s) => s.card.id)).toEqual(['z-cheap', 'sol-cheap', 'bolt-cheap']);
    expect(plan.saved).toBeCloseTo(6 + 4 + 2.5);
  });

  it('leaves a slot alone when the candidate is not cheaper, unpriced, or the same printing', () => {
    const deck = makeDeck({
      cards: [
        slot('a', solCheap),
        slot('b', bolt),
        slot('c', sc('Opt', 'opt-1', 0.2)),
        slot('d', sc('Brainstorm', 'bs-1')),
      ],
    });
    const cheapest = new Map([
      ['Sol Ring', solCheap],
      ['Lightning Bolt', sc('Lightning Bolt', 'bolt-x')],
      ['Opt', sc('Opt', 'opt-2', 0.3)],
      ['Brainstorm', sc('Brainstorm', 'bs-2', 0.1)],
    ]);
    expect(planCheapestPrintings(deck, empty, cheapest, 'USD').swaps).toEqual([]);
  });

  it('never swaps an owned slot or to a different card', () => {
    const deck = makeDeck({ cards: [slot('a', solRing, 'c1'), slot('b', bolt)] });
    const collection = new Map([['c1', copy('c1', 'sol-pricey')]]);
    const cheapest = new Map([
      ['Sol Ring', solCheap],
      ['Lightning Bolt', sc('Chain Lightning', 'chain', 0.1)],
    ]);
    expect(planCheapestPrintings(deck, collection, cheapest, 'USD').swaps).toEqual([]);
  });

  it('compares in the display currency', () => {
    const deck = makeDeck({ cards: [slot('a', sc('Sol Ring', 's1', 5, 1))] });
    const cheapest = new Map([['Sol Ring', sc('Sol Ring', 's2', 1, 2)]]);
    expect(planCheapestPrintings(deck, empty, cheapest, 'USD').swaps).toHaveLength(1);
    expect(planCheapestPrintings(deck, empty, cheapest, 'EUR').swaps).toHaveLength(0);
  });

  it('matches by name when a card has no oracle id', () => {
    const noOracle = (id: string, usd: number) =>
      ({ id, name: 'Sol Ring', prices: { usd: String(usd) } }) as unknown as ScryfallCard;
    const deck = makeDeck({ cards: [slot('a', noOracle('s1', 5))] });
    const plan = planCheapestPrintings(
      deck,
      empty,
      new Map([['Sol Ring', noOracle('s2', 1)]]),
      'USD'
    );
    expect(plan.swaps).toHaveLength(1);
  });
});

describe('copyMismatches / planMatchCopies', () => {
  const deck = makeDeck({
    commander: sc('Zimone', 'z-deck', 2),
    commanderAllocatedCopyId: 'cZ',
    partnerCommander: sc('Tana', 't-deck', 1),
    partnerCommanderAllocatedCopyId: 'cT',
    cards: [slot('a', solRing, 'c1'), slot('b', bolt, 'c2'), slot('c', bolt)],
  });
  const collection = new Map([
    ['cZ', copy('cZ', 'z-owned')],
    ['cT', copy('cT', 't-deck')],
    ['c1', copy('c1', 'sol-owned')],
    ['c2', copy('c2', 'bolt-pricey')],
  ]);

  it('finds owned slots off their copy printing', () => {
    expect(copyMismatches(deck, undefined)).toEqual([]);
    expect(copyMismatches(deck, collection).map((m) => m.copy.copyId)).toEqual(['cZ', 'c1']);
  });

  it('swaps only printings that resolved to the same card', () => {
    const printings = new Map([
      ['z-owned', sc('Zimone', 'z-owned', 30)],
      ['sol-owned', sc('Not Sol Ring', 'sol-owned', 30)],
    ]);
    const swaps = planMatchCopies(deck, collection, printings);
    expect(swaps).toEqual([{ ref: { zone: 'commander' }, card: printings.get('z-owned') }]);
  });
});

describe('applyPrintingSwaps', () => {
  it('replaces each swapped printing and keeps every binding', () => {
    const deck = makeDeck({
      commander: sc('Zimone', 'z1', 2),
      commanderAllocatedCopyId: 'cZ',
      partnerCommander: sc('Tana', 't1', 1),
      cards: [slot('a', solRing, 'c1'), slot('b', bolt)],
      sideboard: [slot('s', bolt)],
      considering: undefined as unknown as DeckCard[],
    });
    const z2 = sc('Zimone', 'z2', 1);
    const t2 = sc('Tana', 't2', 1);
    const next = applyPrintingSwaps(deck, [
      { ref: { zone: 'commander' }, card: z2 },
      { ref: { zone: 'partnerCommander' }, card: t2 },
      { ref: { zone: 'cards', slotId: 'a' }, card: solCheap },
      { ref: { zone: 'sideboard', slotId: 's' }, card: boltCheap },
    ]);
    expect(next.commander).toBe(z2);
    expect(next.commanderAllocatedCopyId).toBe('cZ');
    expect(next.partnerCommander).toBe(t2);
    expect(next.cards[0]).toEqual({ slotId: 'a', card: solCheap, allocatedCopyId: 'c1' });
    expect(next.cards[1]).toBe(deck.cards[1]);
    expect(next.sideboard[0].card).toBe(boltCheap);
    expect(next.considering).toEqual([]);
  });
});

describe('applyCheapestPrintings / applyMatchMyCopies', () => {
  const setDeck = (deck: Deck) => useDecksStore.setState({ decks: [deck], hydrated: true });
  const current = () => useDecksStore.getState().decks[0];

  beforeEach(async () => {
    setApplyingServer(false);
    byName.clear();
    byId.clear();
    forceLive.mockClear();
    useCollectionStore.setState({ cards: [copy('c1', 'sol-owned', 'Sol Ring')], hydrating: false });
    useDeckHistoryStore.getState().clear();
    setDeck(makeDeck({ cards: [slot('a', solRing, 'c1'), slot('b', bolt), slot('c', bolt)] }));
    await flush();
    persistDecksState.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves missing cards to cheaper printings in one write and one undo', async () => {
    byName.set('Lightning Bolt', boltCheap);
    byName.set('Sol Ring', solCheap);
    const result = await applyCheapestPrintings('d1', 'USD');
    await flush();
    expect(result).toEqual({ changed: 2, saved: 5, unresolved: 0 });
    expect(current().cards.map((c) => c.card.id)).toEqual([
      'sol-pricey',
      'bolt-cheap',
      'bolt-cheap',
    ]);
    expect(persistDecksState).toHaveBeenCalledTimes(1);
    expect(forceLive.mock.calls).toEqual([[true], [false]]);
    expect(useDeckHistoryStore.getState().undoLabel('d1')).toBe('cheapest printings (2 cards)');

    expect(useDeckHistoryStore.getState().undo('d1')).toBe(true);
    expect(current().cards.map((c) => c.card.id)).toEqual([
      'sol-pricey',
      'bolt-pricey',
      'bolt-pricey',
    ]);
  });

  it('reports names the lookup could not answer and writes nothing', async () => {
    const result = await applyCheapestPrintings('d1', 'USD');
    expect(result).toEqual({ changed: 0, saved: 0, unresolved: 1 });
    expect(persistDecksState).not.toHaveBeenCalled();
    expect(useDeckHistoryStore.getState().canUndo('d1')).toBe(false);
  });

  it('throws offline without touching the deck', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(applyCheapestPrintings('d1', 'USD')).rejects.toBeInstanceOf(
      PrintingLookupOfflineError
    );
    await expect(applyMatchMyCopies('d1')).rejects.toBeInstanceOf(PrintingLookupOfflineError);
    expect(forceLive).not.toHaveBeenCalled();
    expect(persistDecksState).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown deck or one with nothing to change', async () => {
    expect(await applyCheapestPrintings('nope', 'USD')).toEqual({
      changed: 0,
      saved: 0,
      unresolved: 0,
    });
    expect(await applyMatchMyCopies('nope')).toEqual({ changed: 0, unresolved: 0 });
    setDeck(makeDeck({ cards: [slot('a', sc('Sol Ring', 'sol-owned', 5), 'c1')] }));
    expect(await applyCheapestPrintings('d1', 'USD')).toEqual({
      changed: 0,
      saved: 0,
      unresolved: 0,
    });
    expect(await applyMatchMyCopies('d1')).toEqual({ changed: 0, unresolved: 0 });
    expect(forceLive).not.toHaveBeenCalled();
  });

  it('stops quietly when the deck is deleted mid-lookup', async () => {
    byName.set('Lightning Bolt', boltCheap);
    byId.set('sol-owned', sc('Sol Ring', 'sol-owned', 9));
    const cheap = applyCheapestPrintings('d1', 'USD');
    useDecksStore.setState({ decks: [] });
    expect(await cheap).toEqual({ changed: 0, saved: 0, unresolved: 0 });
    setDeck(makeDeck({ cards: [slot('a', solRing, 'c1')] }));
    const match = applyMatchMyCopies('d1');
    useDecksStore.setState({ decks: [] });
    expect(await match).toEqual({ changed: 0, unresolved: 0 });
  });

  it('matches owned slots to their copy printing in one write and one undo', async () => {
    const owned = sc('Sol Ring', 'sol-owned', 9);
    byId.set('sol-owned', owned);
    const result = await applyMatchMyCopies('d1');
    await flush();
    expect(result).toEqual({ changed: 1, unresolved: 0 });
    expect(current().cards[0]).toMatchObject({ card: owned, allocatedCopyId: 'c1' });
    expect(persistDecksState).toHaveBeenCalledTimes(1);
    expect(useDeckHistoryStore.getState().undoLabel('d1')).toBe('match my copies (1 card)');
    expect(useDeckHistoryStore.getState().undo('d1')).toBe(true);
    expect(current().cards[0].card.id).toBe('sol-pricey');
  });

  it('counts a copy whose printing did not resolve', async () => {
    expect(await applyMatchMyCopies('d1')).toEqual({ changed: 0, unresolved: 1 });
    expect(persistDecksState).not.toHaveBeenCalled();
  });

  it('treats a hydrating collection as unknown', async () => {
    useCollectionStore.setState({ hydrating: true });
    expect(await applyCheapestPrintings('d1', 'USD')).toEqual({
      changed: 0,
      saved: 0,
      unresolved: 0,
    });
  });
});
