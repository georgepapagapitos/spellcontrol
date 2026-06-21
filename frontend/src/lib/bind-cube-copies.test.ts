import { describe, it, expect } from 'vitest';
import { bindCubeCopies } from './bind-cube-copies';
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
