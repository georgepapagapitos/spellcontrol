import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDecksStore, type Deck, type DeckCard } from './decks';
import { setApplyingServer } from '@/lib/sync/applying-server';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

// The store's sync subscriber dynamically imports this; nothing here asserts a push.
vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));

const flush = () => new Promise((r) => setTimeout(r, 0));

const DRYAD = 'Dryad of the Ilysian Grove';

function copy(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'dryad-thb',
    name: DRYAD,
    setCode: 'THB',
    setName: 'Theros Beyond Death',
    collectorNumber: '169',
    rarity: 'mythic',
    scryfallId: 'sf-thb',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

function slot(
  slotId: string,
  scryfallId: string,
  allocatedCopyId: string | null,
  extra: Partial<DeckCard> = {}
): DeckCard {
  return {
    slotId,
    card: { name: DRYAD, id: scryfallId } as ScryfallCard,
    allocatedCopyId,
    ...extra,
  };
}

function deck(id: string, cards: DeckCard[], overrides: Partial<Deck> = {}): Deck {
  return {
    id,
    name: id,
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards,
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const slotOf = (deckId: string, slotId: string) => {
  const d = useDecksStore.getState().decks.find((x) => x.id === deckId)!;
  return [...d.cards, ...d.sideboard, ...d.considering].find((c) => c.slotId === slotId)!;
};

beforeEach(async () => {
  setApplyingServer(false);
  useDecksStore.setState({ decks: [], hydrated: true });
  await flush();
});

// The reported case: one real Dryad (THB printing), listed in two decks. The
// deck played with a proxy lists the THB printing; the deck that should hold
// the real card lists another printing. Before slots could be proxies, Repair
// gave the copy to the printing match, i.e. back to the proxy deck, every time.
describe('a proxy slot in remapAllocations', () => {
  it('without the marker, the printing match pulls the copy into the other deck', () => {
    useDecksStore.setState({
      decks: [
        deck('proxied', [slot('p', 'sf-thb', null)]),
        deck('real', [slot('r', 'sf-other', 'dryad-thb')]),
      ],
    });
    useDecksStore.getState().remapAllocations([copy()], []);
    expect(slotOf('proxied', 'p').allocatedCopyId).toBe('dryad-thb');
    expect(slotOf('real', 'r').allocatedCopyId).toBeNull();
  });

  it('with the marker, the copy stays in the deck that holds it', () => {
    useDecksStore.setState({
      decks: [
        deck('proxied', [slot('p', 'sf-thb', null, { proxy: true })]),
        deck('real', [slot('r', 'sf-other', 'dryad-thb')]),
      ],
    });
    useDecksStore.getState().remapAllocations([copy()], []);
    expect(slotOf('proxied', 'p').allocatedCopyId).toBeNull();
    expect(slotOf('real', 'r').allocatedCopyId).toBe('dryad-thb');
  });

  it('gives a free copy to an unbound slot rather than the proxy, in every zone', () => {
    useDecksStore.setState({
      decks: [
        deck('proxied', [], {
          sideboard: [slot('ps', 'sf-thb', null, { proxy: true })],
          considering: [slot('pc', 'sf-thb', null, { proxy: true })],
        }),
        deck('real', [slot('r', 'sf-other', null)]),
      ],
    });
    useDecksStore.getState().remapAllocations([copy()], []);
    expect(slotOf('proxied', 'ps').allocatedCopyId).toBeNull();
    expect(slotOf('proxied', 'pc').allocatedCopyId).toBeNull();
    expect(slotOf('real', 'r').allocatedCopyId).toBe('dryad-thb');
  });

  it('empties a proxy slot that arrives holding a copy', () => {
    useDecksStore.setState({
      decks: [deck('proxied', [slot('p', 'sf-thb', 'dryad-thb', { proxy: true })])],
    });
    useDecksStore.getState().remapAllocations([copy()], []);
    expect(slotOf('proxied', 'p').allocatedCopyId).toBeNull();
  });
});

describe('setCardProxy', () => {
  it('marking releases the copy; unmarking binds the one given and drops the marker', () => {
    useDecksStore.setState({ decks: [deck('d', [slot('s', 'sf-thb', 'dryad-thb')])] });
    useDecksStore.getState().setCardProxy('d', 's', true);
    expect(slotOf('d', 's')).toMatchObject({ allocatedCopyId: null, proxy: true });

    useDecksStore.getState().setCardProxy('d', 's', false, 'dryad-thb');
    expect(slotOf('d', 's').allocatedCopyId).toBe('dryad-thb');
    expect('proxy' in slotOf('d', 's')).toBe(false);
  });

  it('reaches sideboard and considering slots', () => {
    useDecksStore.setState({
      decks: [
        deck('d', [], {
          sideboard: [slot('sb', 'sf-thb', null)],
          considering: [slot('co', 'sf-thb', null)],
        }),
      ],
    });
    useDecksStore.getState().setCardProxy('d', 'sb', true);
    useDecksStore.getState().setCardProxy('d', 'co', true);
    expect(slotOf('d', 'sb').proxy).toBe(true);
    expect(slotOf('d', 'co').proxy).toBe(true);
  });
});

describe('binding a copy ends a proxy', () => {
  it('setCardAllocation with a copy clears the marker; with null it keeps it', () => {
    useDecksStore.setState({
      decks: [deck('d', [slot('s', 'sf-thb', null, { proxy: true })])],
    });
    useDecksStore.getState().setCardAllocation('d', 's', null);
    expect(slotOf('d', 's').proxy).toBe(true);
    useDecksStore.getState().setCardAllocation('d', 's', 'dryad-thb');
    expect(slotOf('d', 's').proxy).toBeUndefined();
  });

  it('updateCardPrinting keeps the marker unless it binds a copy', () => {
    useDecksStore.setState({
      decks: [deck('d', [slot('s', 'sf-thb', null, { proxy: true })])],
    });
    const other = { name: DRYAD, id: 'sf-other' } as ScryfallCard;
    useDecksStore.getState().updateCardPrinting('d', 's', other, null);
    expect(slotOf('d', 's').proxy).toBe(true);
    useDecksStore.getState().updateCardPrinting('d', 's', other, 'dryad-thb');
    expect(slotOf('d', 's').proxy).toBeUndefined();
  });
});
