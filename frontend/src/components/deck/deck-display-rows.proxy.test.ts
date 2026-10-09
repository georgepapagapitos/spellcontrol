import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { allocationSummary, buildRows } from './deck-display-rows';
import { buildMissingTally, summarizeMissing } from './deck-display-derive';
import { deckCardActions } from './deck-card-actions';
import type { DeckDisplayCard } from './deck-display-types';

// A proxy slot holds no copy on purpose: the deck view reads it as covered,
// labels it a proxy, and keeps it out of what the deck still needs.

const card = { name: 'Dryad of the Ilysian Grove', id: 'sf-thb', prices: {} } as ScryfallCard;
const owned = new Map<string, EnrichedCard>([
  ['c1', { copyId: 'c1', name: card.name, scryfallId: 'sf-thb' } as EnrichedCard],
]);

const rowFor = (cards: DeckDisplayCard[]) => buildRows(cards, 'USD', owned)[0];

describe('a proxy slot in the deck view', () => {
  it('reads as covered, not missing', () => {
    const row = rowFor([{ slotId: 's1', card, allocatedCopyId: null, proxy: true }]);
    expect(row).toMatchObject({ status: 'allocated', proxyQty: 1, allocatedQty: 0, unownedQty: 0 });
    expect(allocationSummary(row)).toBe('Played as a proxy');
  });

  it('is counted beside owned and missing copies', () => {
    const row = rowFor([
      { slotId: 's1', card, allocatedCopyId: 'c1' },
      { slotId: 's2', card, allocatedCopyId: null, proxy: true },
    ]);
    expect(allocationSummary(row)).toBe('1 of 2 from your collection, 1 proxy');
    const mixed = rowFor([
      { slotId: 's1', card, allocatedCopyId: null },
      { slotId: 's2', card, allocatedCopyId: null, proxy: true },
    ]);
    expect(allocationSummary(mixed)).toBe(
      '0 of 2 from your collection (1 not in collection; 1 proxy)'
    );
  });

  it('stays out of the missing count and tally', () => {
    const cards: DeckDisplayCard[] = [{ slotId: 's1', card, allocatedCopyId: null, proxy: true }];
    expect(summarizeMissing(cards, owned, 'USD').count).toBe(0);
    expect(buildMissingTally(cards, owned)).toEqual(buildMissingTally([], owned));
  });
});

describe('proxy row actions', () => {
  const keys = (cards: DeckDisplayCard[]) =>
    deckCardActions({ row: rowFor(cards), onSetProxy: vi.fn() }).map((a) => a.key);

  it('offers Mark as proxy until every slot is one, and Not a proxy once any is', () => {
    expect(keys([{ slotId: 's1', card, allocatedCopyId: 'c1' }])).toContain('mark-proxy');
    const proxied = keys([{ slotId: 's1', card, allocatedCopyId: null, proxy: true }]);
    expect(proxied).toContain('unmark-proxy');
    expect(proxied).not.toContain('mark-proxy');
  });

  it('hands the row slot ids to the handler', () => {
    const onSetProxy = vi.fn();
    const row = rowFor([{ slotId: 's1', card, allocatedCopyId: 'c1' }]);
    deckCardActions({ row, onSetProxy }).find((a) => a.key === 'mark-proxy')!.run!();
    expect(onSetProxy).toHaveBeenCalledWith(['s1'], true);
  });
});
