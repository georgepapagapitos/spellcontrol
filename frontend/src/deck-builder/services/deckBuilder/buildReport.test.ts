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

  it('defaults estimatedBracket to Core (2) and dataSource to base when absent', () => {
    const report = assembleBuildReport({
      generated: makeGenerated(),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    // Core (2) is the baseline — the estimator never auto-assigns Exhibition (1).
    expect(report.estimatedBracket).toBe(2);
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

  it('surfaces collectionRelaxed when cards were pulled from outside the collection', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({ collectionRelaxedCount: 4 }),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    expect(report.collectionRelaxed).toBe(4);
  });

  it('omits collectionRelaxed when no relaxation happened', () => {
    const report = assembleBuildReport({
      generated: makeGenerated({ collectionRelaxedCount: undefined }),
      customization: makeCustomization(),
      collectionNames: new Set(),
    });

    expect(report.collectionRelaxed).toBeUndefined();
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

  describe('synergyFills (off-EDHREC fill provenance)', () => {
    // Tagger data isn't loaded in tests, so topMatchedTags returns [] — these
    // assert the CLASSIFICATION (which cards count as fills). The tag matching
    // itself is covered in synergyFingerprint.test.ts with injected tags.
    const flagged = (name: string, flag: Partial<ScryfallCard>) => ({ ...makeCard(name), ...flag });

    it('lists non-land cards with no EDHREC inclusion, excluding EDHREC/must-include/substituted', () => {
      const report = assembleBuildReport({
        generated: makeGenerated({
          builtFromCollection: true,
          categories: categories({
            creatures: [makeCard('Fill A'), makeCard('EDHREC B')],
            ramp: [
              flagged('Forced C', { isMustInclude: true }),
              flagged('Synergy D', { isThemeSynergyCard: true }),
              makeCard('Subbed E'),
            ],
            lands: [makeCard('Land F')], // lands never count
          }),
          cardInclusionMap: { 'EDHREC B': 42 }, // only B has a signal
          collectionSubstitutions: [
            { usedName: 'Subbed E', wantedName: 'Wanted X' },
          ] as GeneratedDeck['collectionSubstitutions'],
        }),
        customization: makeCustomization({ collectionMode: true, collectionStrategy: 'full' }),
        collectionNames: new Set(),
      });

      // Only 'Fill A' survives: B has inclusion, C is forced, D is EDHREC-synergy,
      // E is a substitution, F is a land.
      expect(report.synergyFills).toEqual([{ name: 'Fill A', matchedTags: [] }]);
    });

    it('is omitted when not built from collection', () => {
      const report = assembleBuildReport({
        generated: makeGenerated({
          builtFromCollection: false,
          categories: categories({ creatures: [makeCard('Fill A')] }),
          cardInclusionMap: {},
        }),
        customization: makeCustomization({ collectionMode: false }),
        collectionNames: new Set(),
      });
      expect(report.synergyFills).toBeUndefined();
    });

    it('is omitted when the inclusion map is absent (can’t tell fills from EDHREC picks)', () => {
      const report = assembleBuildReport({
        generated: makeGenerated({
          builtFromCollection: true,
          categories: categories({ creatures: [makeCard('Fill A')] }),
        }),
        customization: makeCustomization({ collectionMode: true }),
        collectionNames: new Set(),
      });
      expect(report.synergyFills).toBeUndefined();
    });

    it('sets liftedBy on a fill with lift connectivity, absent otherwise (E71 slice 2)', () => {
      const report = assembleBuildReport({
        generated: makeGenerated({
          builtFromCollection: true,
          categories: categories({ creatures: [makeCard('Fill A'), makeCard('Fill B')] }),
          cardInclusionMap: {},
          liftedByMap: { 'fill a': ['Sol Ring', 'Rhystic Study'] },
        }),
        customization: makeCustomization({ collectionMode: true, collectionStrategy: 'full' }),
        collectionNames: new Set(),
      });

      expect(report.synergyFills).toEqual([
        { name: 'Fill A', matchedTags: [], liftedBy: ['Sol Ring', 'Rhystic Study'] },
        { name: 'Fill B', matchedTags: [] },
      ]);
    });
  });

  describe('packagePicks (hidden-synergy suggestions)', () => {
    it('passes through packagePicks and liftPicksNote when present', () => {
      const packagePicks: GeneratedDeck['packagePicks'] = [
        { name: 'Bomb Card', kind: 'bomb', liftedBy: ['Commander'], lowSample: false, owned: true },
      ];
      const report = assembleBuildReport({
        generated: makeGenerated({
          packagePicks,
          liftPicksNote: '1 higher-lift candidate hidden: off-color',
        }),
        customization: makeCustomization(),
        collectionNames: new Set(),
      });

      expect(report.packagePicks).toEqual(packagePicks);
      expect(report.liftPicksNote).toBe('1 higher-lift candidate hidden: off-color');
    });

    it('is unconditional on builtFromCollection', () => {
      const packagePicks: GeneratedDeck['packagePicks'] = [
        {
          name: 'Bomb Card',
          kind: 'bomb',
          liftedBy: ['Commander'],
          lowSample: false,
          owned: false,
        },
      ];
      const report = assembleBuildReport({
        generated: makeGenerated({ packagePicks, builtFromCollection: false }),
        customization: makeCustomization({ collectionMode: false }),
        collectionNames: new Set(),
      });

      expect(report.packagePicks).toEqual(packagePicks);
    });

    it('omits packagePicks and liftPicksNote when absent', () => {
      const report = assembleBuildReport({
        generated: makeGenerated(),
        customization: makeCustomization(),
        collectionNames: new Set(),
      });

      expect(report.packagePicks).toBeUndefined();
      expect(report.liftPicksNote).toBeUndefined();
    });
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
