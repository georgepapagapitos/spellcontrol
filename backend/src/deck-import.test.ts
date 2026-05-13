import { describe, it, expect } from 'vitest';
import { sliceResolvedDeckImport } from './deck-import';
import type { ImportRow } from './parsers/types';
import type { ScryfallCard } from './types';

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    name: 'Plains',
    quantity: 1,
    setCode: 'FDN',
    collectorNumber: '272',
    scryfallId: 'sf-fdn-272',
    sourceFormat: 'manabox',
    ...overrides,
  };
}

function card(id: string, name = 'Plains', set = 'FDN'): ScryfallCard {
  return { id, name, set, collector_number: id } as unknown as ScryfallCard;
}

/**
 * Mirrors what the route handler does: builds the resolved[] array by
 * expanding each row by quantity and pairing each copy with a ScryfallCard.
 * The test caller provides the resolved cards directly so we don't hit Scryfall.
 */
function expandResolved(
  rows: ImportRow[],
  resolveOne: (row: ImportRow, copyIdx: number) => ScryfallCard | undefined
): Array<ScryfallCard | undefined> {
  const out: Array<ScryfallCard | undefined> = [];
  for (const r of rows) {
    const qty = Math.max(1, r.quantity || 1);
    for (let i = 0; i < qty; i++) out.push(resolveOne(r, i));
  }
  return out;
}

describe('sliceResolvedDeckImport', () => {
  it('keeps distinct printings of the same name in the same set distinct', () => {
    // Three distinct FDN Plains rows that previously collapsed to one card.
    const deckRows: ImportRow[] = [
      row({ quantity: 5, collectorNumber: '272', scryfallId: 'sf-fdn-272' }),
      row({ quantity: 1, collectorNumber: '282', scryfallId: 'sf-fdn-282' }),
      row({ quantity: 1, collectorNumber: '283', scryfallId: 'sf-fdn-283' }),
    ];
    const resolved = expandResolved(deckRows, (r) => card(r.scryfallId!, 'Plains', 'FDN'));

    const out = sliceResolvedDeckImport([], [], deckRows, resolved);

    expect(out.cards).toHaveLength(7);
    const ids = out.cards.map((c) => c.id);
    expect(ids.filter((id) => id === 'sf-fdn-272')).toHaveLength(5);
    expect(ids.filter((id) => id === 'sf-fdn-282')).toHaveLength(1);
    expect(ids.filter((id) => id === 'sf-fdn-283')).toHaveLength(1);
  });

  it('emits one card per copy when quantity > 1', () => {
    const deckRows: ImportRow[] = [row({ quantity: 4, scryfallId: 'sf-sol-ring' })];
    const resolved = expandResolved(deckRows, () => card('sf-sol-ring', 'Sol Ring', 'CMR'));
    const out = sliceResolvedDeckImport([], [], deckRows, resolved);
    expect(out.cards).toHaveLength(4);
    expect(new Set(out.cards.map((c) => c.id))).toEqual(new Set(['sf-sol-ring']));
  });

  it('separates commander, companion, and deck sections by row order', () => {
    const commanderRows: ImportRow[] = [
      row({ name: 'Atraxa', quantity: 1, scryfallId: 'sf-atraxa' }),
    ];
    const companionRows: ImportRow[] = [
      row({ name: 'Lurrus', quantity: 1, scryfallId: 'sf-lurrus' }),
    ];
    const deckRows: ImportRow[] = [
      row({ name: 'Plains', quantity: 2, scryfallId: 'sf-plains' }),
      row({ name: 'Sol Ring', quantity: 1, scryfallId: 'sf-sol-ring' }),
    ];
    const resolved = expandResolved([...commanderRows, ...companionRows, ...deckRows], (r) =>
      card(r.scryfallId!, r.name)
    );

    const out = sliceResolvedDeckImport(commanderRows, companionRows, deckRows, resolved);

    expect(out.commander?.id).toBe('sf-atraxa');
    expect(out.companion?.id).toBe('sf-lurrus');
    expect(out.cards.map((c) => c.id)).toEqual(['sf-plains', 'sf-plains', 'sf-sol-ring']);
  });

  it('reports unresolved names from each section without dropping resolved cards', () => {
    const commanderRows: ImportRow[] = [row({ name: 'Atraxa', quantity: 1 })];
    const deckRows: ImportRow[] = [
      row({ name: 'Plains', quantity: 2, scryfallId: 'sf-plains' }),
      row({ name: 'Missing Card', quantity: 3 }),
    ];
    const resolved: Array<ScryfallCard | undefined> = [
      undefined, // commander failed
      card('sf-plains', 'Plains'),
      card('sf-plains', 'Plains'),
      undefined, // missing card 3x
      undefined,
      undefined,
    ];

    const out = sliceResolvedDeckImport(commanderRows, [], deckRows, resolved);

    expect(out.commander).toBeNull();
    expect(out.cards).toHaveLength(2);
    expect(out.unresolvedNames).toEqual(['Atraxa', 'Missing Card', 'Missing Card', 'Missing Card']);
  });

  it('throws if the resolved array length does not match total quantity', () => {
    const deckRows: ImportRow[] = [row({ quantity: 3 })];
    const wrongLength: Array<ScryfallCard | undefined> = [card('a'), card('b')];
    expect(() => sliceResolvedDeckImport([], [], deckRows, wrongLength)).toThrow(
      /resolved length 2 != expected 3/
    );
  });
});
