// Guard (T171 lane M): what the feed and the hero are built from.
//  - An owned stand-in is offered only for a role the deck is short on. In a
//    role already at its target it was a lateral swap between two owned cards
//    off the commander's page, and the next pass traded it back (0.80 of the
//    collection panel's applied moves reversed).
//  - The hero's combo move needs a piece this commander's decks play: the
//    Hullbreaker Horror + Sol Ring line led it for Atraxa, Muldrotha and
//    Yuriko alike (38 of the 74 off-plan moves left before this).
//  - A move that breaks the deck's settings never reaches the feed.
import { describe, it, expect } from 'vitest';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { buildCoachChanges, onPlanCombos, staplesToSubstitute } from './coach-changes';

const gap = (name: string, role: string, inclusion = 40): GapAnalysisCard => ({
  name,
  role,
  price: null,
  inclusion,
  synergy: 0,
  typeLine: 'Instant',
});

describe('staplesToSubstitute', () => {
  const gaps = [
    gap('Swords to Plowshares', 'removal'),
    gap('Rhystic Study', 'cardDraw'),
    gap('Cultivate', 'ramp'),
  ];

  it('keeps only unowned staples in roles below target', () => {
    const picked = staplesToSubstitute(
      gaps,
      new Set(['Cultivate']),
      { removal: 8, cardDraw: 7, ramp: 9 },
      { removal: 8, cardDraw: 10, ramp: 10 }
    );
    expect(picked.map((g) => g.name)).toEqual(['Rhystic Study']);
  });

  it('keeps a role without a target (nothing says it is full)', () => {
    expect(staplesToSubstitute(gaps, new Set(), {}, {}).map((g) => g.name)).toEqual([
      'Swords to Plowshares',
      'Rhystic Study',
      'Cultivate',
    ]);
  });
});

const combo = (id: string, present: string, missing: string): ComboMatch =>
  ({
    combo: {
      id,
      produces: ['Infinite colorless mana'],
      popularity: 900,
      cards: [
        { oracleId: present, cardName: present, quantity: 1 },
        { oracleId: missing, cardName: missing, quantity: 1 },
      ],
    },
    presentOracleIds: [present],
    missingOracleIds: [missing],
  }) as unknown as ComboMatch;

describe('onPlanCombos', () => {
  const generic = combo('hullbreaker', 'Sol Ring', 'Hullbreaker Horror');
  const onPage = combo('bw', 'Mind Stone', 'Beast Within');
  const deeper = combo('dr', 'Harmonize', 'Dramatic Reversal');

  it("keeps the combos whose missing piece this commander's decks play, most played first", () => {
    const pieces = { 'Beast Within': { inclusion: 22 }, 'Dramatic Reversal': { inclusion: 31 } };
    expect(onPlanCombos([generic, onPage, deeper], pieces)?.map((m) => m.combo.id)).toEqual([
      'dr',
      'bw',
    ]);
  });

  it('keeps none when the analysis recorded no piece on the page', () => {
    expect(onPlanCombos([generic], {})).toEqual([]);
    expect(onPlanCombos(undefined, {})).toBeUndefined();
  });
});

describe('buildCoachChanges — settings', () => {
  it('drops the rows the deck settings rule out', () => {
    const changes = buildCoachChanges(
      {
        gaps: [gap('Swords to Plowshares', 'removal'), gap('The One Ring', 'cardDraw')],
        synergy: [],
        substitutes: [],
      },
      () => 'unowned',
      new Set(),
      (c) => c.name !== 'The One Ring'
    );
    expect(changes.map((c) => c.name)).toEqual(['Swords to Plowshares']);
  });
});

// T171 re-gate: the budget lane swapped Undead Warchief (the Zombies deck's
// lord) for Great Fierce Bee in a deck with no budget, and the next pass
// suggested the Warchief straight back.
describe('buildCoachChanges — budget swaps Coach would undo', () => {
  const row = (currentName: string, currentInclusion: number, currentPrice = 2) => ({
    id: currentName,
    currentName,
    currentPrice,
    currentInclusion,
    suggestionName: 'Great Fierce Bee',
    suggestionPrice: 0.25,
    suggestionInclusion: 25,
    savings: currentPrice - 0.25,
    confidence: 'drop-in' as const,
    category: 'spell' as const,
  });
  const src = {
    // The least-played staple the deck is missing sits at 30%.
    gaps: [gap('Diregraf Captain', 'creature', 62), gap('Death Baron', 'creature', 30)],
    synergy: [],
    substitutes: [],
    costPlan: {
      currentTotal: 400,
      minTotal: 390,
      spellRows: [row('Undead Warchief', 37.5), row('Diregraf Colossus', 12)],
      landRows: [],
      protectedCount: 0,
    },
  };
  const deck = new Set(['undead warchief', 'diregraf colossus']);
  const budgetNames = (changes: ReturnType<typeof buildCoachChanges>) =>
    changes.filter((c) => c.lane === 'budget').map((c) => c.inName);

  it('never swaps out a card played at least as much as the least-played missing staple', () => {
    expect(budgetNames(buildCoachChanges(src, () => 'unowned', deck))).toEqual([
      'Diregraf Colossus',
    ]);
  });

  it("keeps the swap when the deck's budget would hide the re-add", () => {
    const underBudget = (c: { type: string; name: string }) =>
      !(c.type === 'add' && c.name === 'Undead Warchief');
    expect(
      budgetNames(buildCoachChanges(src, () => 'unowned', deck, undefined, underBudget))
    ).toEqual(['Undead Warchief', 'Diregraf Colossus']);
  });

  it('offers a swap that costs power only when the deck cannot afford the card it replaces', () => {
    const sidegrade = { ...row('Noxious Ghoul', 8), confidence: 'sidegrade' as const };
    const withSidegrade = {
      ...src,
      costPlan: { ...src.costPlan, spellRows: [sidegrade, row('Diregraf Colossus', 12)] },
    };
    const inDeck = new Set(['noxious ghoul', 'diregraf colossus']);
    // No budget: a cheaper card that plays worse is not a move.
    expect(budgetNames(buildCoachChanges(withSidegrade, () => 'unowned', inDeck))).toEqual([
      'Diregraf Colossus',
    ]);
    // The budget can't carry the Ghoul: saving money is the point.
    const overBudget = (c: { type: string; name: string }) => c.name !== 'Noxious Ghoul';
    expect(
      budgetNames(buildCoachChanges(withSidegrade, () => 'unowned', inDeck, undefined, overBudget))
    ).toEqual(['Noxious Ghoul', 'Diregraf Colossus']);
  });
});
