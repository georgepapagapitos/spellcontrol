import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { buildRows } from './deck-display-rows';
import { allocationSummary, proxyMarkQty } from './deck-row-allocation';
import { deckCardActions } from './deck-card-actions';
import type { DeckDisplayCard } from './deck-display-types';

// A proxy can be tracked two ways: a deck slot played as one (DeckCard.proxy),
// or a copy in the collection flagged as one (EnrichedCard.proxy) that a slot
// holds. The deck used to mark only the first, so a proxy copy from the
// collection read as an ordinary owned card.

const card = { name: 'Sol Ring', id: 'sf-ring', prices: {} } as ScryfallCard;
const copies = new Map<string, EnrichedCard>([
  ['real', { copyId: 'real', name: card.name, scryfallId: 'sf-ring' } as EnrichedCard],
  ['fake', { copyId: 'fake', name: card.name, scryfallId: 'sf-ring', proxy: true } as EnrichedCard],
]);
const rowFor = (cards: DeckDisplayCard[]) => buildRows(cards, 'USD', copies)[0];

describe('a slot holding a proxy copy from the collection', () => {
  it('is owned and marked as a proxy', () => {
    const row = rowFor([{ slotId: 's1', card, allocatedCopyId: 'fake' }]);
    expect(row).toMatchObject({ status: 'allocated', allocatedQty: 1, ownedProxyQty: 1 });
    expect(proxyMarkQty(row)).toBe(1);
    expect(allocationSummary(row)).toBe('Proxy copy from your collection');
  });

  it('is counted beside a real copy', () => {
    const row = rowFor([
      { slotId: 's1', card, allocatedCopyId: 'real' },
      { slotId: 's2', card, allocatedCopyId: 'fake' },
    ]);
    expect(proxyMarkQty(row)).toBe(1);
    expect(allocationSummary(row)).toBe('All 2 copies from your collection, one is a proxy copy');
  });

  it('a real copy carries no mark', () => {
    const row = rowFor([{ slotId: 's1', card, allocatedCopyId: 'real' }]);
    expect(proxyMarkQty(row)).toBe(0);
    expect(allocationSummary(row)).toBe('From your collection');
  });

  // Neither proxy action: it is a proxy already, and that flag lives on the copy.
  it('offers neither Mark as proxy nor Not a proxy', () => {
    const keys = deckCardActions({
      row: rowFor([{ slotId: 's1', card, allocatedCopyId: 'fake' }]),
      onSetProxy: vi.fn(),
    }).map((a) => a.key);
    expect(keys).not.toContain('mark-proxy');
    expect(keys).not.toContain('unmark-proxy');
  });

  it('a stack with a real copy beside it still offers Mark one as proxy', () => {
    const keys = deckCardActions({
      row: rowFor([
        { slotId: 's1', card, allocatedCopyId: 'fake' },
        { slotId: 's2', card, allocatedCopyId: 'real' },
      ]),
      onSetProxy: vi.fn(),
    }).map((a) => a.key);
    expect(keys).toContain('mark-proxy');
  });
});
