import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDecksStore, type Deck, type DeckCard } from './decks';
import { setApplyingServer } from '@/lib/sync/applying-server';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

// The store's sync subscriber dynamically imports this; nothing here asserts a push.
vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));

const flush = () => new Promise((r) => setTimeout(r, 0));

const RING = 'Sol Ring';

function copy(copyId = 'ring-1'): EnrichedCard {
  return {
    copyId,
    name: RING,
    setCode: 'C21',
    setName: 'Commander 2021',
    collectorNumber: '263',
    rarity: 'uncommon',
    scryfallId: 'sf-ring',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  };
}

const card = { name: RING, id: 'sf-ring' } as ScryfallCard;

function slot(slotId: string, allocatedCopyId: string | null): DeckCard {
  return { slotId, card, allocatedCopyId };
}

function deck(id: string, overrides: Partial<Deck> = {}): Deck {
  return {
    id,
    name: id,
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
    ...overrides,
  };
}

const deckOf = (id: string) => useDecksStore.getState().decks.find((x) => x.id === id)!;
const slotOf = (deckId: string, slotId: string) => {
  const d = deckOf(deckId);
  return [...d.cards, ...d.sideboard, ...d.considering].find((c) => c.slotId === slotId)!;
};

beforeEach(async () => {
  setApplyingServer(false);
  useDecksStore.setState({ decks: [], hydrated: true });
  await flush();
});

// The reported case: release a copy, and the next boot, sync, re-import or
// Repair runs remapAllocations, whose fresh-pick pass hands the now-free copy
// straight back to the same empty slot. Release never stuck.
describe('Release copy survives remapAllocations', () => {
  it('without the marker, an emptied slot takes the free copy back', () => {
    useDecksStore.setState({ decks: [deck('d', { cards: [slot('s', null)] })] });
    useDecksStore.getState().remapAllocations([copy()], []);
    expect(slotOf('d', 's').allocatedCopyId).toBe('ring-1');
  });

  it('a released slot stays empty, in every zone', () => {
    useDecksStore.setState({
      decks: [
        deck('d', {
          cards: [slot('m', 'ring-1')],
          sideboard: [slot('sb', 'ring-2')],
          considering: [slot('c', 'ring-3')],
        }),
      ],
    });
    const { releaseCopy, remapAllocations } = useDecksStore.getState();
    releaseCopy('d', { slotId: 'm' });
    releaseCopy('d', { slotId: 'sb' });
    releaseCopy('d', { slotId: 'c' });
    remapAllocations([copy('ring-1'), copy('ring-2'), copy('ring-3')], []);
    for (const id of ['m', 'sb', 'c']) {
      expect(slotOf('d', id)).toMatchObject({ allocatedCopyId: null, released: true });
    }
  });

  it('the released copy goes to another deck that is waiting on the card', () => {
    useDecksStore.setState({
      decks: [
        deck('from', { cards: [slot('f', 'ring-1')] }),
        deck('to', { cards: [slot('t', null)] }),
      ],
    });
    useDecksStore.getState().releaseCopy('from', { slotId: 'f' });
    useDecksStore.getState().remapAllocations([copy()], []);
    expect(slotOf('from', 'f').allocatedCopyId).toBeNull();
    expect(slotOf('to', 't').allocatedCopyId).toBe('ring-1');
  });

  it('a released commander seat stays empty', () => {
    useDecksStore.setState({
      decks: [
        deck('d', {
          commander: card,
          commanderAllocatedCopyId: 'ring-1',
          partnerCommander: card,
          partnerCommanderAllocatedCopyId: 'ring-2',
        }),
      ],
    });
    useDecksStore.getState().releaseCopy('d', 'commander');
    useDecksStore.getState().releaseCopy('d', 'partner');
    useDecksStore.getState().remapAllocations([copy('ring-1'), copy('ring-2')], []);
    expect(deckOf('d')).toMatchObject({
      commanderAllocatedCopyId: null,
      commanderReleased: true,
      partnerCommanderAllocatedCopyId: null,
      partnerCommanderReleased: true,
    });
  });
});

describe('taking a released copy back', () => {
  it('binding a copy clears the marker, and the matcher keeps it from then on', () => {
    useDecksStore.setState({ decks: [deck('d', { sideboard: [slot('sb', 'ring-1')] })] });
    const { releaseCopy, setCardAllocation } = useDecksStore.getState();
    releaseCopy('d', { slotId: 'sb' });
    setCardAllocation('d', 'sb', 'ring-1');
    expect(slotOf('d', 'sb').released).toBeUndefined();
    useDecksStore.getState().remapAllocations([copy()], []);
    expect(slotOf('d', 'sb').allocatedCopyId).toBe('ring-1');
  });

  it('seating the commander with a copy clears the seat marker', () => {
    useDecksStore.setState({
      decks: [deck('d', { commander: card, commanderAllocatedCopyId: 'ring-1' })],
    });
    useDecksStore.getState().releaseCopy('d', 'commander');
    useDecksStore.getState().setCommander('d', card, 'ring-1');
    expect(deckOf('d').commanderReleased).toBeUndefined();
    expect(deckOf('d').commanderAllocatedCopyId).toBe('ring-1');
  });

  it('marking a released slot as a proxy trades one marker for the other', () => {
    useDecksStore.setState({ decks: [deck('d', { cards: [slot('m', 'ring-1')] })] });
    useDecksStore.getState().releaseCopy('d', { slotId: 'm' });
    useDecksStore.getState().setCardProxy('d', 'm', true);
    expect(slotOf('d', 'm')).toMatchObject({ proxy: true, allocatedCopyId: null });
    expect(slotOf('d', 'm').released).toBeUndefined();
  });
});
