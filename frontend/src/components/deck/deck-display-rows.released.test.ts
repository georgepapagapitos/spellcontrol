import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { buildRows, type CrossDeckCtx } from './deck-display-rows';
import { allocationSummary } from './deck-row-allocation';
import { buildCommanderRows } from './deck-display-derive';
import { deckCardActions } from './deck-card-actions';
import type { DeckDisplayCard } from './deck-display-types';

// A released slot stays empty on purpose, so the deck view says so instead of
// "Not in your collection", and offers "Use my copy" to take one back: no
// matcher refills it any more.

const card = { name: 'Sol Ring', id: 'sf-ring', prices: {} } as ScryfallCard;
const ring = { copyId: 'c1', name: card.name, scryfallId: 'sf-ring' } as EnrichedCard;
const owned = new Map<string, EnrichedCard>([['c1', ring]]);
const crossDeck = (copies: EnrichedCard[]): CrossDeckCtx => ({
  copiesByName: new Map(copies.length ? [['sol ring', copies]] : []),
  otherDeckAllocations: new Map(),
});

const rowFor = (cards: DeckDisplayCard[], copies = [ring]) =>
  buildRows(cards, 'USD', owned, crossDeck(copies))[0];

describe('a released slot in the deck view', () => {
  it('reads as released while the card is still in the collection', () => {
    const row = rowFor([{ slotId: 's1', card, allocatedCopyId: null, released: true }]);
    expect(row).toMatchObject({ status: 'unowned', unownedQty: 1, releasedQty: 1 });
    expect(allocationSummary(row)).toBe('Copy released from this deck');
  });

  it('is counted beside owned and missing copies', () => {
    const row = rowFor([
      { slotId: 's1', card, allocatedCopyId: 'c1' },
      { slotId: 's2', card, allocatedCopyId: null, released: true },
    ]);
    expect(allocationSummary(row)).toBe('1 of 2 from your collection (1 released)');
  });

  it('reads as not owned once the card has left the collection', () => {
    const row = rowFor([{ slotId: 's1', card, allocatedCopyId: null, released: true }], []);
    expect(row.releasedQty).toBe(0);
    expect(allocationSummary(row)).toBe('Not in your collection');
  });

  it('offers Use my copy, and an ordinary empty slot does not', () => {
    const keys = (cards: DeckDisplayCard[]) =>
      deckCardActions({ row: rowFor(cards), onUseOwnCopy: vi.fn() }).map((a) => a.key);
    expect(keys([{ slotId: 's1', card, allocatedCopyId: null, released: true }])).toContain(
      'use-own-copy'
    );
    expect(keys([{ slotId: 's1', card, allocatedCopyId: null }])).not.toContain('use-own-copy');
  });

  it('a released commander seat offers Use my copy too', () => {
    const [row] = buildCommanderRows({
      commander: card,
      partnerCommander: null,
      commanderAllocatedCopyId: null,
      partnerCommanderAllocatedCopyId: null,
      commanderReleased: true,
      collectionByCopyId: owned,
      crossDeck: crossDeck([ring]),
      claimedByForName: () => undefined,
      currency: 'USD',
    });
    expect(row.releasedQty).toBe(1);
    expect(deckCardActions({ row, onUseOwnCopy: vi.fn() }).map((a) => a.key)).toContain(
      'use-own-copy'
    );
  });
});
