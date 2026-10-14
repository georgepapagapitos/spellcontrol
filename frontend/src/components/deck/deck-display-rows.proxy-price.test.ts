import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import type { DeckCard } from '@/store/decks';
import { ownDeckValue } from '@/lib/deck/deck-value';
import { buildRows } from './deck-display-rows';
import { countedPrice, priceCellTitle, proxyPriceNote } from './deck-row-allocation';
import type { DeckDisplayCard } from './deck-display-types';

// A proxy counts 0 toward the deck's value (lib/deck/deck-value). The list's
// price cells and section subtotals read the same rule, so the cells add up to
// the subtotal and the subtotals to the hero's number.

const card = (name: string, usd: string) =>
  ({ name, id: `sf-${name}`, prices: { usd } }) as unknown as ScryfallCard;
const crypt = card('Mana Crypt', '180.00');
const ring = card('Sol Ring', '1.50');
const copies = new Map<string, EnrichedCard>([
  ['fake', { copyId: 'fake', name: crypt.name, scryfallId: crypt.id, proxy: true } as EnrichedCard],
  ['real', { copyId: 'real', name: ring.name, scryfallId: ring.id } as EnrichedCard],
]);
const rowsOf = (cards: DeckDisplayCard[]) => buildRows(cards, 'USD', copies);

describe('proxy prices in the deck list', () => {
  it('a deck-marked proxy adds $0, and its title keeps the market price', () => {
    const [row] = rowsOf([{ slotId: 's1', card: crypt, allocatedCopyId: null, proxy: true }]);
    expect(row.proxyPrice).toBe(180);
    expect(countedPrice(row)).toBe(0);
    expect(priceCellTitle(row, 'USD')).toBe('Proxy, $180.00 at market, not counted');
  });

  it('a slot holding a proxy copy from the collection adds $0 too', () => {
    const [row] = rowsOf([{ slotId: 's1', card: crypt, allocatedCopyId: 'fake' }]);
    expect(countedPrice(row)).toBe(0);
    expect(proxyPriceNote(row, 'USD')).toBe('Proxy, $180.00 at market, not counted');
  });

  it('a stack counts its real copies and names the proxy part', () => {
    const [row] = rowsOf([
      { slotId: 's1', card: ring, allocatedCopyId: 'real' },
      { slotId: 's2', card: ring, allocatedCopyId: null, proxy: true },
    ]);
    expect(countedPrice(row)).toBe(1.5);
    expect(priceCellTitle(row, 'USD')).toBe('$1.50 each · $1.50 in proxies not counted');
    // An expanded printing sub-row says the same as its row.
    expect(row.printings[0].price - row.printings[0].proxyPrice).toBe(1.5);
  });

  it('a real card has no note', () => {
    const [row] = rowsOf([{ slotId: 's1', card: ring, allocatedCopyId: 'real' }]);
    expect(countedPrice(row)).toBe(1.5);
    expect(priceCellTitle(row, 'USD')).toBeUndefined();
  });

  it('the counted cells sum to the owner deck value', () => {
    const slots: DeckCard[] = [
      { slotId: 's1', card: crypt, allocatedCopyId: 'fake' },
      { slotId: 's2', card: ring, allocatedCopyId: 'real' },
      { slotId: 's3', card: card('Arcane Signet', '0.50'), allocatedCopyId: null, proxy: true },
      { slotId: 's4', card: card('Command Tower', '0.25'), allocatedCopyId: null },
    ];
    const sum = rowsOf(slots).reduce((s, r) => s + countedPrice(r), 0);
    const { value } = ownDeckValue(
      {
        commander: null,
        partnerCommander: null,
        commanderAllocatedCopyId: null,
        partnerCommanderAllocatedCopyId: null,
        cards: slots,
      },
      new Set(['fake']),
      'USD'
    );
    expect(sum).toBeCloseTo(value);
    expect(value).toBeCloseTo(1.75);
  });
});
