import { describe, expect, it } from 'vitest';
import { buildCardLocationIndex, formatLocation, formatLocationSpan } from './card-locations';
import type { BinderLayoutInputs } from './use-binder-layout-inputs';
import type { BinderDef, EnrichedCard } from '@/types/index';

function card(
  name: string,
  oracleId: string,
  over: Partial<EnrichedCard> & { copyId?: string } = {}
): EnrichedCard {
  return {
    name,
    oracleId,
    copyId: over.copyId ?? `copy-${name}`,
    quantity: 1,
    purchasePrice: 0,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: oracleId,
    typeLine: 'Creature — Human',
    colorIdentity: ['U'],
    ...over,
  } as EnrichedCard;
}

function binder(
  id: string,
  name: string,
  position: number,
  rarity?: string,
  over: Partial<BinderDef> = {}
): BinderDef {
  return {
    id,
    name,
    position,
    filterGroups: rarity
      ? [{ filter: { rarities: { chips: [{ value: rarity, negate: false }], joiners: [] } } }]
      : [],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    ...over,
  } as unknown as BinderDef;
}

function layout(
  cards: EnrichedCard[],
  binders: BinderDef[],
  allocated: string[] = []
): BinderLayoutInputs {
  return { cards, binders, allocatedCopyIds: new Set(allocated), setMap: undefined };
}

describe('buildCardLocationIndex', () => {
  it('is empty when there are no cards or no binders', () => {
    expect(buildCardLocationIndex(layout([], [binder('b1', 'Staples', 0)])).byCopyId.size).toBe(0);
    expect(buildCardLocationIndex(layout([card('Sol Ring', 'o1')], [])).byOracleId.size).toBe(0);
  });

  it('reports the binder, page and pocket of every copy', () => {
    // Eleven rares in a 9-pocket binder sorted by name, one first letter so
    // they share a section: the eleventh is the second pocket of page 2.
    const names = 'ABCDEFGHIJK'.split('').map((l) => `Card ${l}`);
    const cards = names.map((n) => card(n, `o-${n}`));
    const index = buildCardLocationIndex(layout(cards, [binder('b1', 'Rares', 0, 'rare')]));

    expect(index.byCopyId.get('copy-Card A')).toMatchObject({
      binderId: 'b1',
      binderName: 'Rares',
      pageNum: 1,
      slot: 1,
    });
    expect(index.byCopyId.get('copy-Card K')).toMatchObject({ pageNum: 2, slot: 2 });
  });

  it('reports the first binder by position when several could claim a card', () => {
    const index = buildCardLocationIndex(
      layout(
        [card('Sol Ring', 'o1', { rarity: 'rare' })],
        [binder('b2', 'Second', 1, 'rare'), binder('b1', 'First', 0, 'rare')]
      )
    );
    expect(index.byOracleId.get('o1')?.binderName).toBe('First');
  });

  it('omits cards that no binder claims', () => {
    const index = buildCardLocationIndex(
      layout([card('Sol Ring', 'o1', { rarity: 'common' })], [binder('b1', 'Rares', 0, 'rare')])
    );
    expect(index.byOracleId.has('o1')).toBe(false);
  });

  // The reason this takes BinderPage's inputs whole: a binder that hides deck
  // cards lays its other cards out without them, so a raw-cards index put the
  // card after the deck card one pocket off.
  it('honors deck allocations the way the binder view does', () => {
    const cards = [card('Card A', 'o-a'), card('Card B', 'o-b')];
    const hides = binder('b1', 'Rares', 0, 'rare', { hideDeckAllocated: false });
    expect(buildCardLocationIndex(layout(cards, [hides])).byCopyId.get('copy-Card B')?.slot).toBe(
      2
    );
    const index = buildCardLocationIndex(layout(cards, [hides], ['copy-Card A']));
    expect(index.byCopyId.has('copy-Card A')).toBe(false);
    expect(index.byCopyId.get('copy-Card B')?.slot).toBe(1);
  });

  it('stamps a volume only once the binder outgrows its own fixed capacity', () => {
    // 20 cards at 9 pockets = 3 pages; a 9-card (1-page) capacity forces 3 volumes.
    const names = Array.from({ length: 20 }, (_, i) => `Card ${String(i).padStart(2, '0')}`);
    const cards = names.map((n) => card(n, `o-${n}`));
    const over = binder('b1', 'Everything', 0, undefined, {
      filterGroups: [{ filter: {} }],
      fixedCapacity: 9,
    });
    const index = buildCardLocationIndex(layout(cards, [over]));
    expect(index.byCopyId.get(`copy-${names[0]}`)).toMatchObject({ pageNum: 1, volume: 1 });
    expect(index.byCopyId.get(`copy-${names[9]}`)).toMatchObject({ pageNum: 2, volume: 2 });
    expect(index.byCopyId.get(`copy-${names[19]}`)).toMatchObject({ pageNum: 3, volume: 3 });
  });

  it('never stamps a volume when the binder fits in one book', () => {
    const cards = [card('Sol Ring', 'o1')];
    const fits = binder('b1', 'Everything', 0, undefined, {
      filterGroups: [{ filter: {} }],
      fixedCapacity: 360,
    });
    const index = buildCardLocationIndex(layout(cards, [fits]));
    expect(index.byCopyId.get('copy-Sol Ring')?.volume).toBeUndefined();
  });
});

describe('formatLocation', () => {
  const at = { binderName: 'Mana rocks', pageNum: 3, slot: 5 };

  it('names the binder, page and pocket', () => {
    expect(formatLocation(at)).toBe('Mana rocks · p. 3 · slot 5');
  });

  it('drops the binder where the surface already shows it', () => {
    expect(formatLocation(at, { binder: false })).toBe('p. 3 · slot 5');
  });

  it('says only the page when the pocket is not known for this copy', () => {
    expect(formatLocation({ binderName: 'Mana rocks', pageNum: 3 })).toBe('Mana rocks · p. 3');
  });

  it('names the volume once the binder is more than one book', () => {
    expect(formatLocation({ ...at, volume: 2 })).toBe('Mana rocks · Vol 2 · p. 3 · slot 5');
  });

  it('never says a volume for a binder that fits in one book', () => {
    expect(formatLocation({ ...at, volume: undefined })).toBe('Mana rocks · p. 3 · slot 5');
  });
});

describe('formatLocationSpan', () => {
  it('reads one pocket like formatLocation', () => {
    expect(formatLocationSpan([{ pageNum: 3, slot: 5 }])).toBe('p. 3 · slot 5');
  });

  it('reads a run on one page as a slot range', () => {
    expect(
      formatLocationSpan([
        { pageNum: 3, slot: 6 },
        { pageNum: 3, slot: 4 },
        { pageNum: 3, slot: 5 },
      ])
    ).toBe('p. 3 · slots 4–6');
  });

  it('lists pockets that are not adjacent', () => {
    expect(
      formatLocationSpan([
        { pageNum: 3, slot: 1 },
        { pageNum: 3, slot: 7 },
      ])
    ).toBe('p. 3 · slots 1, 7');
  });

  it('falls back to pages when a pile crosses a page', () => {
    expect(
      formatLocationSpan([
        { pageNum: 3, slot: 9 },
        { pageNum: 4, slot: 1 },
      ])
    ).toBe('pp. 3–4');
  });

  it('is empty for no pockets', () => {
    expect(formatLocationSpan([])).toBe('');
  });

  it('names the volume that every spot in the pile shares', () => {
    expect(formatLocationSpan([{ pageNum: 3, slot: 5 }], { volume: 2 })).toBe(
      'Vol 2 · p. 3 · slot 5'
    );
    expect(
      formatLocationSpan(
        [
          { pageNum: 3, slot: 9 },
          { pageNum: 4, slot: 1 },
        ],
        { volume: 1 }
      )
    ).toBe('Vol 1 · pp. 3–4');
  });
});
