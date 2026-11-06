import { describe, expect, it } from 'vitest';
import { gridCaptionFor, gridCaptionIsPrice } from './card-list-table-derive';
import type { Row, SortKey } from './card-list-table-config';

// The tile's manual-price pencil trusts gridCaptionIsPrice to say when the
// caption is a price. If a new sort grows its own caption in gridCaptionFor
// and this list isn't told, the pencil would sit beside a date.
describe('gridCaptionIsPrice', () => {
  const row = {
    card: { purchasePrice: 3.5, edhrecRank: 12, updatedAt: 1, importId: 'i', setCode: 'cmr' },
  } as unknown as Row;
  // A Record, so a new SortKey fails to compile here until it is listed.
  const all: Record<SortKey, true> = {
    name: true,
    set: true,
    rarity: true,
    price: true,
    edhrec: true,
    qty: true,
    cmc: true,
    release: true,
    added: true,
    edited: true,
  };
  const keys = Object.keys(all) as SortKey[];

  it.each(keys)('agrees with gridCaptionFor for %s', (key) => {
    const caption = gridCaptionFor(row, key, new Map([['i', 1]]), undefined);
    expect(gridCaptionIsPrice(key)).toBe(caption === '$3.50');
  });
});
