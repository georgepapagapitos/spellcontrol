import { describe, it, expect } from 'vitest';
import { previewTile } from './binder-chooser-preview';
import { materializeBinders } from './materialize';
import { STARTER_TEMPLATES, colorPickFilter } from './binder-templates';
import { SORT_PRESETS } from './sorting';
import type { BinderDef, BinderFilter, EnrichedCard, SortEntry } from '../types';

let n = 0;
function card(over: Partial<EnrichedCard> & { name: string }): EnrichedCard {
  n += 1;
  return {
    copyId: `c${n}`,
    scryfallId: `sf${n}`,
    oracleId: `o-${over.name}`,
    typeLine: 'Creature',
    colorIdentity: [],
    colors: [],
    rarity: 'common',
    purchasePrice: 0,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: String(n),
    quantity: 1,
    ...over,
  } as unknown as EnrichedCard;
}

const rareFilter: BinderFilter = {
  rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] },
};

function existingBinder(name: string, filter: BinderFilter, position: number): BinderDef {
  const now = Date.now();
  return {
    id: `b-${name}`,
    name,
    position,
    filterGroups: [{ filter }],
    sorts: [],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: now,
    updatedAt: now,
  };
}

describe('previewTile', () => {
  const cards = [
    card({ name: 'Rare One', rarity: 'rare' }),
    card({ name: 'Rare Two', rarity: 'rare' }),
    card({ name: 'Common One', rarity: 'common' }),
  ];

  it('matches equals lands when nothing outranks it', () => {
    const preview = previewTile(rareFilter, [], cards, [], {
      allocatedCopyIds: new Set(),
      setMap: undefined,
    });
    expect(preview.matches).toBe(2);
    expect(preview.lands).toBe(2);
    expect(preview.caughtBy).toEqual([]);
  });

  it('names the binder claiming the difference when lands < matches', () => {
    const above = existingBinder('Rares', rareFilter, 0);
    const preview = previewTile(rareFilter, [], cards, [above], {
      allocatedCopyIds: new Set(),
      setMap: undefined,
    });
    expect(preview.matches).toBe(2);
    expect(preview.lands).toBe(0);
    expect(preview.caughtBy).toEqual([{ binderName: 'Rares', count: 2 }]);
  });

  it('computes pages at the 9-pocket new-binder default', () => {
    const many = Array.from({ length: 20 }, (_, i) => card({ name: `Card ${i}`, rarity: 'rare' }));
    const preview = previewTile(rareFilter, [], many, [], {
      allocatedCopyIds: new Set(),
      setMap: undefined,
    });
    expect(preview.lands).toBe(20);
    expect(preview.pages).toBe(3); // ceil(20 / 9)
  });
});

describe('previewTile matches what picking a chooser tile actually creates', () => {
  // The chooser tile promise ("N cards land here") has to be the SAME number
  // the app produces once the tile is picked and the binder is saved — the
  // same guarantee binder-suggestions.test.ts holds the Uncategorized sheet
  // to. Builds each grouped template's filter into a REAL BinderDef the way
  // BinderEditor's save path would (appended last, 9-pocket, one side, no
  // packing) and materializes independently of `previewTile`'s own pass, so a
  // divergence between the two constructions would fail this even if
  // `previewTile` were internally self-consistent.
  const cards = [
    card({ name: 'Command Tower', typeLine: 'Land', purchasePrice: 0.3 }),
    card({ name: 'Sol Ring', typeLine: 'Artifact', purchasePrice: 2, tags: ['mana-rock'] }),
    card({
      name: 'Edgar Markov',
      typeLine: 'Legendary Creature — Vampire Knight',
      purchasePrice: 5,
      colorIdentity: ['W', 'B', 'R'],
      colors: ['W', 'B', 'R'],
    }),
    card({ name: 'Forest', typeLine: 'Basic Land — Forest', purchasePrice: 0.1 }),
    card({ name: 'Mystic Remora', typeLine: 'Enchantment', purchasePrice: 8, rarity: 'uncommon' }),
  ];
  // Only the fields previewTile/materializeBinders actually read for these
  // filters are asserted, but `commanderEligible` isn't derivable from a
  // typeLine alone in this fixture — set it explicitly like the real
  // enrichment pipeline does.
  cards[2] = { ...cards[2], commanderEligible: true } as EnrichedCard;

  const grouped = STARTER_TEMPLATES.filter((t) => !t.revealSets);
  const binders: BinderDef[] = [];
  const layout = { allocatedCopyIds: new Set<string>(), setMap: undefined };

  for (const tpl of grouped) {
    it(`${tpl.id}: previewed "lands" equals a real materialize of the created binder`, () => {
      const filter = tpl.colorPick ? colorPickFilter('W') : (tpl.filter ?? {});
      const sorts: SortEntry[] = SORT_PRESETS.find((p) => p.id === tpl.sortPreset)?.sorts ?? [];
      const preview = previewTile(filter, sorts, cards, binders, layout);

      const now = Date.now();
      const made: BinderDef = {
        id: 'made',
        name: tpl.label,
        position: binders.length,
        filterGroups: [{ filter }],
        sorts,
        pocketSize: 9,
        doubleSided: false,
        fixedCapacity: null,
        color: '#000',
        createdAt: now,
        updatedAt: now,
      };
      const { binders: result } = materializeBinders(cards, [...binders, made], { search: '' });
      expect(result.find((b) => b.def.id === 'made')?.totalCards).toBe(preview.lands);
    });
  }
});
