import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import type { EnrichedCard } from '../types';
import { buildAvailableCollection } from './collection-availability';

function owned(name: string, copyId: string): EnrichedCard {
  return {
    copyId,
    name,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `sf-${copyId}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
  };
}

function deckWithClaim(cardName: string, copyId: string): Deck {
  const card = { id: `sf-${copyId}`, name: cardName } as ScryfallCard;
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [{ slotId: 'slot-1', card, allocatedCopyId: copyId }],
    sideboard: [],
    generationContext: null,
    color: '#111111',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('buildAvailableCollection', () => {
  it('keeps only names with free copies and counts those free copies', () => {
    const available = buildAvailableCollection(
      [
        owned('Free Card', 'free-copy'),
        owned('Fully Claimed Card', 'claimed-copy'),
        owned('Partly Claimed Card', 'partly-claimed-copy'),
        owned('Partly Claimed Card', 'partly-free-copy'),
      ],
      [
        deckWithClaim('Fully Claimed Card', 'claimed-copy'),
        deckWithClaim('Partly Claimed Card', 'partly-claimed-copy'),
      ]
    );

    expect([...available.names].sort()).toEqual(['Free Card', 'Partly Claimed Card']);
    expect(available.counts.get('Free Card')).toBe(1);
    expect(available.counts.get('Partly Claimed Card')).toBe(1);
    expect(available.counts.has('Fully Claimed Card')).toBe(false);
  });
});
