import { describe, it, expect } from 'vitest';
import { assembleBuildReport } from './buildReport';
import type {
  Customization,
  DeckCategory,
  GeneratedDeck,
  ScryfallCard,
} from '@/deck-builder/types';

function makeCard(name: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

function categories(
  partial: Partial<Record<DeckCategory, ScryfallCard[]>>
): Record<DeckCategory, ScryfallCard[]> {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
    ...partial,
  };
}

function makeGenerated(overrides: Partial<GeneratedDeck> = {}): GeneratedDeck {
  return {
    commander: null,
    partnerCommander: null,
    categories: categories({}),
    stats: {
      totalCards: 0,
      averageCmc: 0,
      manaCurve: {},
      colorDistribution: {},
      typeDistribution: {},
    },
    ...overrides,
  } as GeneratedDeck;
}

function makeCustomization(overrides: Partial<Customization> = {}): Customization {
  return {
    targetBracket: 3,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    ...overrides,
  } as Customization;
}

describe('assembleBuildReport', () => {
  it('passes through targetBracket, estimatedBracket, and dataSource', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({
        dataSource: 'theme+bracket',
        bracketEstimation: { bracket: 4 } as GeneratedDeck['bracketEstimation'],
      }),
      customization: makeCustomization({ targetBracket: 'all' }),
      collectionNames: new Set(),
    });

    expect(report.targetBracket).toBe('all');
    expect(report.estimatedBracket).toBe(4);
    expect(report.dataSource).toBe('theme+bracket');
  });

  it('defaults estimatedBracket to 1 and dataSource to base when absent', () => {
    const report = assembleBuildReport({
      generated: makeGenerated(),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    expect(report.estimatedBracket).toBe(1);
    expect(report.dataSource).toBe('base');
  });

  it('computes ownedPercentActual over non-commander mainboard, rounded', () => {
    // 3 cards, 2 owned -> 67%
    const report = assembleBuildReport({
      generated: makeGenerated({
        builtFromCollection: true,
        categories: categories({
          creatures: [makeCard('Owned A'), makeCard('Unowned B')],
          ramp: [makeCard('Owned C')],
        }),
      }),
      customization: makeCustomization({ collectionMode: true, collectionStrategy: 'full' }),
      collectionNames: new Set(['Owned A', 'Owned C']),
    });

    expect(report.ownedPercentActual).toBe(67);
  });

  it('omits ownedPercentActual and collectionStrategy when not built from collection', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({
        builtFromCollection: false,
        categories: categories({ creatures: [makeCard('A')] }),
      }),
      customization: makeCustomization({ collectionMode: false }),
      collectionNames: new Set(['A']),
    });

    expect(report.builtFromCollection).toBe(false);
    expect(report.ownedPercentActual).toBeUndefined();
    expect(report.collectionStrategy).toBeUndefined();
    expect(report.ownedPercentTarget).toBeUndefined();
  });

  it('falls back to customization.collectionMode for builtFromCollection', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({ categories: categories({ creatures: [makeCard('A')] }) }),
      customization: makeCustomization({ collectionMode: true, collectionStrategy: 'full' }),
      collectionNames: new Set(['A']),
    });

    expect(report.builtFromCollection).toBe(true);
    expect(report.collectionStrategy).toBe('full');
    expect(report.ownedPercentActual).toBe(100);
  });

  it('sets ownedPercentTarget only in partial mode', () => {
    const partial = assembleBuildReport({
      generated: makeGenerated({ builtFromCollection: true }),
      customization: makeCustomization({
        collectionMode: true,
        collectionStrategy: 'partial',
        collectionOwnedPercent: 60,
      }),
      collectionNames: new Set(),
    });
    expect(partial.ownedPercentTarget).toBe(60);

    const full = assembleBuildReport({
      generated: makeGenerated({ builtFromCollection: true }),
      customization: makeCustomization({
        collectionMode: true,
        collectionStrategy: 'full',
        collectionOwnedPercent: 60,
      }),
      collectionNames: new Set(),
    });
    expect(full.ownedPercentTarget).toBeUndefined();
  });

  it('sums basicsPadded from collection + filter shortfall', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({ collectionShortfall: 3, filterShortfall: 2 }),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    expect(report.basicsPadded).toBe(5);
  });

  it('omits basicsPadded when zero', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({ collectionShortfall: 0, filterShortfall: 0 }),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    expect(report.basicsPadded).toBeUndefined();
  });

  it('includes roleGaps only for under-target roles', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({
        roleTargets: { ramp: 10, removal: 8, draw: 5 },
        roleCounts: { ramp: 7, removal: 8, draw: 6 },
      }),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    // ramp under (7<10), removal met (8==8), draw over (6>5)
    expect(report.roleGaps).toEqual([{ role: 'ramp', have: 7, want: 10 }]);
  });

  it('treats a missing roleCount as 0 when measuring gaps', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({
        roleTargets: { ramp: 4 },
        roleCounts: {},
      }),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    expect(report.roleGaps).toEqual([{ role: 'ramp', have: 0, want: 4 }]);
  });

  it('omits roleGaps when no targets or no gaps', () => {
    const noTargets = assembleBuildReport({
      generated: makeGenerated(),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });
    expect(noTargets.roleGaps).toBeUndefined();

    const noGaps = assembleBuildReport({
      generated: makeGenerated({
        roleTargets: { ramp: 4 },
        roleCounts: { ramp: 4 },
      }),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });
    expect(noGaps.roleGaps).toBeUndefined();
  });
});
