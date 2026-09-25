import { describe, it, expect } from 'vitest';
import { bindCubeCopies, rebindCubePicks } from './bind-cube-copies';
import type { EnrichedCard } from '../types';
import type { Deck } from '../store/decks';
import type { SavedCube } from '../store/cube';
import type { Pick } from './cube/generate';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  } as EnrichedCard;
}

function pick(name: string): Pick {
  return { card: { name, oracleId: name } as never, bucket: 'colorless', reason: '' };
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Deck',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    format: 'commander',
    generationContext: null,
    color: '#000',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

describe('bindCubeCopies', () => {
  it('binds each pick to a free copy and records the durable shadow', () => {
    const collection = [
      card({ copyId: 'a', name: 'Sol Ring', scryfallId: 'sf-1', finish: 'nonfoil' }),
    ];
    const slots = bindCubeCopies([pick('Sol Ring')], collection, [], []);
    expect(slots).toHaveLength(1);
    expect(slots[0].allocatedCopyId).toBe('a');
    expect(slots[0].printingFinishKey).toBe('sf-1:nonfoil');
  });

  it('never double-claims one copy across two picks of the same name', () => {
    const collection = [card({ copyId: 'only', name: 'Sol Ring' })];
    const slots = bindCubeCopies([pick('Sol Ring'), pick('Sol Ring')], collection, [], []);
    expect(slots[0].allocatedCopyId).toBe('only');
    expect(slots[1].allocatedCopyId).toBeNull(); // no second copy → gap
    expect(slots[1].printingFinishKey).toBeNull();
  });

  it('leaves a gap when no copy is owned', () => {
    const slots = bindCubeCopies([pick('Sol Ring')], [], [], []);
    expect(slots[0].allocatedCopyId).toBeNull();
  });

  it('skips copies already committed to a deck', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring' })];
    const d = deck({
      cards: [{ slotId: 's1', card: { name: 'Sol Ring' } as never, allocatedCopyId: 'a' }],
    });
    const slots = bindCubeCopies([pick('Sol Ring')], collection, [d], []);
    expect(slots[0].allocatedCopyId).toBeNull();
  });

  it('skips copies already committed to another physical cube', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring' })];
    const other: SavedCube = {
      id: 'other',
      name: 'Other',
      size: 540,
      cube: { picks: [] } as never,
      picks: [
        {
          slotId: '0',
          card: { name: 'Sol Ring' } as never,
          allocatedCopyId: 'a',
          printingFinishKey: null,
        },
      ],
      isPhysical: true,
      savedAt: 0,
    };
    const slots = bindCubeCopies([pick('Sol Ring')], collection, [], [other]);
    expect(slots[0].allocatedCopyId).toBeNull();
  });
});

describe('rebindCubePicks', () => {
  it('preserves the binding for a pick whose card is unchanged', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring' })];
    const oldSlots = [
      {
        slotId: '0',
        card: { name: 'Sol Ring', oracleId: 'Sol Ring' } as never,
        allocatedCopyId: 'a',
        printingFinishKey: 'sf-1:nonfoil',
      },
    ];
    const result = rebindCubePicks([pick('Sol Ring')], oldSlots, collection, [], []);
    expect(result[0].allocatedCopyId).toBe('a');
    expect(result[0].printingFinishKey).toBe('sf-1:nonfoil');
  });

  it('releases a dropped card copy — a fresh pick can claim it', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring' })];
    const oldSlots = [
      {
        slotId: '0',
        card: { name: 'Sol Ring', oracleId: 'Sol Ring' } as never,
        allocatedCopyId: 'a',
        printingFinishKey: null,
      },
    ];
    // The new pick list no longer holds "Sol Ring" — a different card now wants a copy.
    const collection2 = [...collection, card({ copyId: 'b', name: 'Arcane Signet' })];
    const result = rebindCubePicks([pick('Arcane Signet')], oldSlots, collection2, [], []);
    expect(result[0].allocatedCopyId).toBe('b');
  });

  it('binds a fresh copy for a genuinely new pick', () => {
    const collection = [
      card({ copyId: 'a', name: 'Sol Ring' }),
      card({ copyId: 'b', name: 'Arcane Signet' }),
    ];
    const oldSlots = [
      {
        slotId: '0',
        card: { name: 'Sol Ring', oracleId: 'Sol Ring' } as never,
        allocatedCopyId: 'a',
        printingFinishKey: null,
      },
    ];
    const result = rebindCubePicks(
      [pick('Sol Ring'), pick('Arcane Signet')],
      oldSlots,
      collection,
      [],
      []
    );
    expect(result[0].allocatedCopyId).toBe('a'); // preserved
    expect(result[1].allocatedCopyId).toBe('b'); // freshly bound
  });

  it('never double-claims a preserved binding for a coincidentally-matching new pick', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring' })];
    const oldSlots = [
      {
        slotId: '0',
        card: { name: 'Sol Ring', oracleId: 'Sol Ring' } as never,
        allocatedCopyId: 'a',
        printingFinishKey: null,
      },
    ];
    // Two picks now want "Sol Ring" (shouldn't happen — singleton — but the
    // allocator must still not double-claim the one copy).
    const result = rebindCubePicks(
      [pick('Sol Ring'), pick('Sol Ring')],
      oldSlots,
      collection,
      [],
      []
    );
    expect(result[0].allocatedCopyId).toBe('a');
    expect(result[1].allocatedCopyId).toBeNull();
  });

  it('does not preserve a binding to a copy no longer in the live collection (sold)', () => {
    const oldSlots = [
      {
        slotId: '0',
        card: { name: 'Sol Ring', oracleId: 'Sol Ring' } as never,
        allocatedCopyId: 'gone',
        printingFinishKey: null,
      },
    ];
    const result = rebindCubePicks([pick('Sol Ring')], oldSlots, [], [], []);
    expect(result[0].allocatedCopyId).toBeNull();
  });

  it('skips copies already committed to a deck or another physical cube', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring' })];
    const d = deck({
      cards: [{ slotId: 's1', card: { name: 'Sol Ring' } as never, allocatedCopyId: 'a' }],
    });
    const result = rebindCubePicks([pick('Sol Ring')], [], collection, [d], []);
    expect(result[0].allocatedCopyId).toBeNull();
  });
});
