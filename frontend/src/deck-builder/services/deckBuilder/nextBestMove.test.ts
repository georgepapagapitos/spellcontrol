import { describe, expect, it } from 'vitest';
import { buildNextBestMoves, type NextBestMoveInput } from './nextBestMove';
import type { PlanScore, SubScore } from './planScore';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';

function sub(value: number, partial = false): SubScore {
  return { value, surface: `surface ${value}`, bandLabel: 'x', partial };
}

function plan(overrides: Partial<PlanScore['subscores']>, limitedData = false): PlanScore {
  return {
    overall: 70,
    bandLabel: 'Solid',
    headline: 'h',
    byline: 'b',
    limitedData,
    subscores: {
      strategy: sub(90),
      roles: sub(90),
      curve: sub(90),
      cardFit: sub(90),
      ...overrides,
    },
  };
}

function gap(name: string, extra: Partial<GapAnalysisCard> = {}): GapAnalysisCard {
  return {
    name,
    price: null,
    inclusion: 50,
    synergy: 1,
    typeLine: 'Creature',
    ...extra,
  };
}

function base(overrides: Partial<NextBestMoveInput> = {}): NextBestMoveInput {
  return {
    roleCounts: {},
    roleTargets: {},
    cardCount: 99,
    deckTarget: 99,
    ...overrides,
  };
}

describe('buildNextBestMoves', () => {
  it('returns [] for a healthy, correctly-sized deck with no combos', () => {
    const moves = buildNextBestMoves(base({ planScore: plan({}), cardCount: 99, deckTarget: 99 }));
    expect(moves).toEqual([]);
  });

  it('surfaces a lopsided engine as a "Balance your engine" move citing the missing side', () => {
    const moves = buildNextBestMoves(
      base({
        planScore: plan({}),
        lopsided: [
          {
            axis: 'tokens',
            label: 'Tokens / go-wide',
            side: 'payoff',
            text: 'Tokens / go-wide: 9 producers but no payoff to reward them.',
          },
        ],
      })
    );
    const move = moves.find((m) => m.id === 'engine-tokens');
    expect(move).toBeDefined();
    expect(move?.tier).toBe(2);
    expect(move?.title).toBe('Balance your engine');
    expect(move?.detail).toContain('no payoff');
    expect(move?.detail).toContain('payoff'); // names the missing side
    expect(move?.navigateTo).toBe('tune');
    expect(move?.focus).toBe('fill-gaps');
  });

  it('omits the engine move when there is no lopsided axis', () => {
    const moves = buildNextBestMoves(base({ planScore: plan({}), lopsided: [] }));
    expect(moves.some((m) => m.id.startsWith('engine-'))).toBe(false);
  });

  it('flags over-target size as a tier-1 trim move', () => {
    const moves = buildNextBestMoves(base({ cardCount: 101, deckTarget: 99 }));
    expect(moves[0].tier).toBe(1);
    expect(moves[0].id).toBe('size-over');
    expect(moves[0].title).toBe('Trim 2 cards');
    expect(moves[0].detail).toContain('101');
    expect(moves[0].navigateTo).toBe('deck');
  });

  it('flags under-target size as a tier-1 add move', () => {
    const moves = buildNextBestMoves(base({ cardCount: 97, deckTarget: 99 }));
    expect(moves[0].id).toBe('size-under');
    expect(moves[0].title).toBe('Add 2 cards');
    expect(moves[0].navigateTo).toBe('deck');
  });

  it('orders tiers ascending: structural (1) before weak sub-score (2)', () => {
    const moves = buildNextBestMoves(
      base({
        cardCount: 100,
        deckTarget: 99,
        planScore: plan({ curve: sub(40) }),
      })
    );
    expect(moves.map((m) => m.tier)).toEqual([1, 2]);
    expect(moves[1].id).toBe('curve');
  });

  it('picks the weakest sub-score first among multiple weak ones', () => {
    const moves = buildNextBestMoves(
      base({
        planScore: plan({ curve: sub(70), cardFit: sub(40) }),
      })
    );
    expect(moves[0].id).toBe('cardfit');
    expect(moves[0].focus).toBe('upgrade');
    expect(moves[1].id).toBe('curve');
    expect(moves[1].focus).toBeUndefined(); // curve routes to Stats, not a Tune lane
  });

  it('skips partial sub-scores even when below threshold', () => {
    const moves = buildNextBestMoves(
      base({
        planScore: plan({ strategy: sub(10, true), curve: sub(60) }),
      })
    );
    expect(moves.map((m) => m.id)).toEqual(['curve']);
  });

  it('matches a role-deficit to a same-role gap card', () => {
    const moves = buildNextBestMoves(
      base({
        roleCounts: { ramp: 2, removal: 8 },
        roleTargets: { ramp: 10, removal: 10 },
        gapAnalysis: [gap('Cultivate', { role: 'ramp', inclusion: 60 })],
        planScore: plan({ roles: sub(40) }),
      })
    );
    const roleMove = moves.find((m) => m.id === 'roles-ramp');
    expect(roleMove).toBeDefined();
    expect(roleMove?.cardName).toBe('Cultivate');
    expect(roleMove?.detail).toContain('ramp');
    expect(roleMove?.detail).toContain('Cultivate');
    expect(roleMove?.navigateTo).toBe('tune');
    expect(roleMove?.focus).toBe('fill-gaps');
  });

  it('prefers an OWNED role-gap card over a higher-listed unowned one (owned-first)', () => {
    const moves = buildNextBestMoves(
      base({
        roleCounts: { ramp: 2 },
        roleTargets: { ramp: 10 },
        gapAnalysis: [
          gap('Sol Ring', { role: 'ramp', inclusion: 95 }),
          gap('Arcane Signet', { role: 'ramp', inclusion: 80 }),
        ],
        planScore: plan({ roles: sub(40) }),
        ownedNames: new Set(['Arcane Signet']),
      })
    );
    const roleMove = moves.find((m) => m.id === 'roles-ramp');
    expect(roleMove?.cardName).toBe('Arcane Signet'); // owned beats the higher-listed Sol Ring
    expect(roleMove?.detail).toContain('You own Arcane Signet');
  });

  it('prefers an OWNED synergy card for a weak strategy sub-score (owned-first)', () => {
    const moves = buildNextBestMoves(
      base({
        gapAnalysis: [gap('High', { synergy: 3 }), gap('Owned', { synergy: 1 })],
        planScore: plan({ strategy: sub(40) }),
        ownedNames: new Set(['Owned']),
      })
    );
    const strat = moves.find((m) => m.id === 'strategy');
    expect(strat?.cardName).toBe('Owned'); // owned beats the higher-synergy unowned card
    expect(strat?.detail).toContain('You own Owned');
  });

  it('picks the lowest-ratio role when several have deficits', () => {
    const moves = buildNextBestMoves(
      base({
        roleCounts: { ramp: 8, removal: 1 },
        roleTargets: { ramp: 10, removal: 10 },
        planScore: plan({ roles: sub(40) }),
      })
    );
    expect(moves.find((m) => m.tier === 2)?.id).toBe('roles-removal');
  });

  it('uses the highest-synergy gap for a weak strategy sub-score', () => {
    const moves = buildNextBestMoves(
      base({
        gapAnalysis: [gap('Low', { synergy: 0.5 }), gap('High', { synergy: 3 })],
        planScore: plan({ strategy: sub(40) }),
      })
    );
    const strat = moves.find((m) => m.id === 'strategy');
    expect(strat?.cardName).toBe('High');
    expect(strat?.focus).toBe('upgrade');
  });

  it('surfaces a near-miss combo with exactly one missing card as tier 3', () => {
    const oneAway: ComboMatch[] = [
      {
        combo: {
          id: 'c1',
          identity: 'UB',
          produces: ['Infinite mana'],
          prerequisites: null,
          description: null,
          manaNeeded: null,
          popularity: 100,
          cardCount: 2,
          bracket: 3,
          cards: [
            { oracleId: 'o-have', cardName: 'Have', quantity: 1 },
            { oracleId: 'o-miss', cardName: 'Missing Piece', quantity: 1 },
          ],
        },
        presentOracleIds: ['o-have'],
        missingOracleIds: ['o-miss'],
      },
    ];
    const moves = buildNextBestMoves(base({ oneAwayCombos: oneAway }));
    expect(moves).toHaveLength(1);
    expect(moves[0].tier).toBe(3);
    expect(moves[0].cardName).toBe('Missing Piece');
    expect(moves[0].detail).toContain('Infinite mana');
    expect(moves[0].navigateTo).toBe('power');
  });

  it('ignores combos missing more than one card', () => {
    const oneAway: ComboMatch[] = [
      {
        combo: {
          id: 'c2',
          identity: 'R',
          produces: ['Win'],
          prerequisites: null,
          description: null,
          manaNeeded: null,
          popularity: 1,
          cardCount: 3,
          bracket: null,
          cards: [],
        },
        presentOracleIds: [],
        missingOracleIds: ['a', 'b'],
      },
    ];
    const moves = buildNextBestMoves(base({ oneAwayCombos: oneAway }));
    expect(moves).toEqual([]);
  });

  it('emits a limited-data info note when flagged', () => {
    const moves = buildNextBestMoves(base({ planScore: plan({}, true) }));
    expect(moves.map((m) => m.id)).toEqual(['limited-data']);
    expect(moves[0].tier).toBe(3);
    expect(moves[0].navigateTo).toBeUndefined();
  });

  it('dedupes by card name across tiers (one card → one move)', () => {
    const oneAway: ComboMatch[] = [
      {
        combo: {
          id: 'c3',
          identity: 'G',
          produces: ['Value'],
          prerequisites: null,
          description: null,
          manaNeeded: null,
          popularity: 10,
          cardCount: 2,
          bracket: null,
          cards: [
            { oracleId: 'o1', cardName: 'Other', quantity: 1 },
            { oracleId: 'o2', cardName: 'Shared Card', quantity: 1 },
          ],
        },
        presentOracleIds: ['o1'],
        missingOracleIds: ['o2'],
      },
    ];
    const moves = buildNextBestMoves(
      base({
        roleCounts: { ramp: 1 },
        roleTargets: { ramp: 10 },
        gapAnalysis: [gap('Shared Card', { role: 'ramp', synergy: 5 })],
        planScore: plan({ roles: sub(40) }),
        oneAwayCombos: oneAway,
      })
    );
    const withShared = moves.filter((m) => m.cardName === 'Shared Card');
    expect(withShared).toHaveLength(1);
    // The role move (tier 2) wins; the combo move is dropped as a card dup.
    expect(withShared[0].id).toBe('roles-ramp');
  });

  it('caps output at the top 3 moves', () => {
    const moves = buildNextBestMoves(
      base({
        cardCount: 101,
        deckTarget: 99,
        roleCounts: { ramp: 1, removal: 1 },
        roleTargets: { ramp: 10, removal: 10 },
        gapAnalysis: [gap('R', { synergy: 4 })],
        planScore: plan(
          { roles: sub(30), curve: sub(40), cardFit: sub(50), strategy: sub(60) },
          true
        ),
      })
    );
    expect(moves).toHaveLength(3);
    // Tier 1 first, then the two weakest sub-scores.
    expect(moves[0].tier).toBe(1);
    expect(moves.map((m) => m.tier)).toEqual([1, 2, 2]);
  });
});
