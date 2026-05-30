import { describe, it, expect } from 'vitest';
import {
  buildInclusionIndex,
  lookupInclusion,
  buildCardInclusionMap,
  comboMatchesToDetected,
  computeGradeAndBracket,
  buildStrategyInputs,
} from './commanderDeckAnalysis';
import type { EDHRECCommanderData, EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';

function edhrec(): EDHRECCommanderData {
  const card = (name: string, inclusion: number) => ({
    name,
    sanitized: name,
    primary_type: 'Creature',
    inclusion,
    num_decks: 0,
  });
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 0,
      deckSize: 99,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 10, nonbasic: 27, total: 37 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [card('Command Tower', 80), card('Plains', 99)],
      allNonLand: [card('Sol Ring', 90), card('Cultivate // Back', 40)],
    },
    similarCommanders: [],
  };
}

describe('buildInclusionIndex / lookupInclusion', () => {
  it('indexes non-land cards and non-basic lands, skipping basics', () => {
    const idx = buildInclusionIndex(edhrec());
    expect(idx.get('Sol Ring')).toBe(90);
    expect(idx.get('Command Tower')).toBe(80);
    // Basic land excluded from the inclusion index
    expect(idx.has('Plains')).toBe(false);
  });

  it('falls back to the front face for DFC names', () => {
    const idx = buildInclusionIndex(edhrec());
    expect(lookupInclusion(idx, 'Cultivate // Back')).toBe(40);
    // A bare front-face name not itself indexed has no entry
    expect(lookupInclusion(idx, 'Cultivate')).toBeUndefined();
    // ...but a DFC whose front face IS indexed resolves via the front face
    expect(lookupInclusion(idx, 'Sol Ring // X')).toBe(90);
  });
});

describe('buildCardInclusionMap', () => {
  it('maps known cards, zero-fills unknowns, and skips basics', () => {
    const map = buildCardInclusionMap(edhrec(), ['Sol Ring', 'Unknown Card', 'Plains']);
    expect(map['Sol Ring']).toBe(90);
    expect(map['Unknown Card']).toBe(0);
    expect(map).not.toHaveProperty('Plains');
  });
});

describe('comboMatchesToDetected', () => {
  it('maps only inDeck combos as complete and stringifies bracket', () => {
    const resp: ComboMatchResponse = {
      inDeck: [
        {
          combo: {
            id: 'c1',
            identity: 'WU',
            produces: ['Infinite mana'],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 1234,
            cardCount: 2,
            bracket: 4,
            cards: [
              { oracleId: 'o1', cardName: 'Card A', quantity: 1 },
              { oracleId: 'o2', cardName: 'Card B', quantity: 1 },
            ],
          },
          presentOracleIds: ['o1', 'o2'],
          missingOracleIds: [],
        },
      ],
      oneAway: [
        {
          combo: {
            id: 'c2',
            identity: 'B',
            produces: ['Win'],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 5,
            cardCount: 2,
            bracket: null,
            cards: [{ oracleId: 'o3', cardName: 'Card C', quantity: 1 }],
          },
          presentOracleIds: ['o3'],
          missingOracleIds: ['o4'],
        },
      ],
      almostInCollection: [],
    };
    const detected = comboMatchesToDetected(resp);
    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      comboId: 'c1',
      cards: ['Card A', 'Card B'],
      isComplete: true,
      missingCards: [],
      bracket: '4',
      deckCount: 1234,
    });
    expect(comboMatchesToDetected(null)).toEqual([]);
  });
});

describe('computeGradeAndBracket', () => {
  const card = (name: string, cmc = 2): ScryfallCard =>
    ({ name, cmc, type_line: 'Creature' }) as ScryfallCard;

  it('always returns a bracket; omits grade without edhrec/roleTargets', () => {
    const { bracketEstimation, deckGrade } = computeGradeAndBracket({
      allCardNames: ['Sol Ring', 'Llanowar Elves'],
      averageCmc: 2,
      gameChangerNames: new Set<string>(),
      allCards: [card('Sol Ring', 1), card('Llanowar Elves', 1)],
      roleCounts: { ramp: 2, removal: 0, boardwipe: 0, cardDraw: 0 },
      deckSize: 99,
    });
    expect(bracketEstimation.bracket).toBeGreaterThanOrEqual(1);
    expect(bracketEstimation.bracket).toBeLessThanOrEqual(5);
    expect(deckGrade).toBeUndefined();
  });

  it('produces a grade when edhrec data and role targets are present', () => {
    const cards = [card('Sol Ring', 1), card('Cultivate', 3)];
    const { deckGrade } = computeGradeAndBracket({
      allCardNames: cards.map((c) => c.name),
      averageCmc: 2,
      gameChangerNames: new Set<string>(),
      allCards: cards,
      roleCounts: { ramp: 2, removal: 0, boardwipe: 0, cardDraw: 0 },
      roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
      edhrecData: edhrec(),
      deckSize: 99,
    });
    expect(deckGrade).toBeDefined();
    expect(typeof deckGrade?.letter).toBe('string');
    expect(typeof deckGrade?.headline).toBe('string');
  });
});

describe('buildStrategyInputs', () => {
  const syn = (name: string, synergy: number, isThemeSynergyCard = false): EDHRECCard =>
    ({
      name,
      sanitized: name,
      primary_type: 'Creature',
      inclusion: 50,
      num_decks: 0,
      synergy,
      isThemeSynergyCard,
    }) as EDHRECCard;

  const dataWith = (allNonLand: EDHRECCard[], themeName?: string): EDHRECCommanderData =>
    ({
      themes: themeName ? [{ name: themeName, slug: 'x', count: 100 }] : [],
      stats: { numDecks: 1234 },
      cardlists: {
        creatures: [],
        instants: [],
        sorceries: [],
        artifacts: [],
        enchantments: [],
        planeswalkers: [],
        lands: [],
        allNonLand,
      },
      similarCommanders: [],
    }) as unknown as EDHRECCommanderData;

  const card = (name: string): ScryfallCard => ({ name }) as ScryfallCard;

  it('counts theme-synergy cards and above-floor synergy, ignores generic cards', () => {
    const data = dataWith(
      [syn('Engine', 0.4, true), syn('Niche', 0.2), syn('Generic', 0.05)],
      'Counters Matter'
    );
    const inputs = buildStrategyInputs(data, [card('Engine'), card('Niche'), card('Generic')]);
    expect(inputs).not.toBeNull();
    expect(inputs!.themeByCard.has('engine')).toBe(true);
    expect(inputs!.themeByCard.has('niche')).toBe(true);
    expect(inputs!.themeByCard.has('generic')).toBe(false);
    expect(inputs!.planName).toBe('Counters Matter');
  });

  it('ranks top theme cards by synergy descending and defaults planName to null', () => {
    const inputs = buildStrategyInputs(
      dataWith([syn('Low', 0.16), syn('High', 0.9), syn('Mid', 0.4)]),
      []
    );
    expect(inputs!.topThemeCardNames?.slice(0, 3)).toEqual(['High', 'Mid', 'Low']);
    expect(inputs!.planName).toBeNull();
  });

  it('returns null when no card clears the synergy signal', () => {
    expect(buildStrategyInputs(dataWith([syn('Filler', 0), syn('Other', 0.1)]), [])).toBeNull();
  });
});
