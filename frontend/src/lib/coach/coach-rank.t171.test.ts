// Guard (T171 lane M): a row is promoted by what it fixes, not by the lane
// that carries it. Lane L's harness found upgrade and land rows in 222 of the
// 295 top-five slots: every upgrade row rode a low cardFit into tier 1
// (including off-plan synergy picks, "rewards cycling" for Atraxa), and land
// swaps, the only rows with a deltaScore, sorted ahead of every staple. The
// rows here are built with the product's own adapters from the Atraxa deck
// lane L quoted.
import { describe, it, expect } from 'vitest';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import { COACH_CARDS } from '@/deck-builder/services/deckBuilder/__fixtures__/coach-cards.fixtures';
import { rankCoachMoves, type CoachContext } from './coach-rank';
import {
  fromCostSwapRow,
  fromGapCard,
  fromLandUpgradeMove,
  fromMisfit,
  fromOptimizeCard,
  fromSynergySuggestion,
} from './deck-change';

const sub = (value: number) => ({ value, surface: '', bandLabel: '', partial: false });
const planScore: PlanScore = {
  overall: 70,
  bandLabel: 'Solid',
  headline: '',
  byline: '',
  limitedData: false,
  subscores: { strategy: sub(70), roles: sub(80), curve: sub(85), cardFit: sub(55) },
};
const ctx: CoachContext = {
  planScore,
  roleCounts: { ramp: 12, removal: 7, boardwipe: 3, cardDraw: 10 },
  roleTargets: { ramp: 12, removal: 8, boardwipe: 3, cardDraw: 10 },
  deckSize: 100,
  deckTarget: 100,
  bracketOverridePresent: false,
  ownedNames: new Set(),
};

const swords = fromGapCard(
  {
    name: 'Swords to Plowshares',
    price: '1.02',
    inclusion: 55,
    synergy: 0.02,
    typeLine: 'Instant',
    role: 'removal',
    roleLabel: 'Removal',
  },
  'unowned'
);
const beastWithin = fromOptimizeCard(
  {
    name: 'Beast Within',
    reason: 'Fills Removal gap',
    reasonCategory: 'fills:removal',
    inclusion: 38,
    role: 'removal',
  },
  'add',
  'unowned'
);
const misty = fromOptimizeCard(
  {
    name: 'Misty Rainforest',
    reason: 'Fixes mana base',
    reasonCategory: 'mana-fix',
    inclusion: 34,
  },
  'add',
  'unowned'
);
const archfiend = fromSynergySuggestion(
  {
    cardName: 'Archfiend of Ifnir',
    axis: 'cycling',
    axisLabel: 'Cycling',
    side: 'payoff',
    reason: 'rewards cycling',
    budding: true,
  },
  'unowned'
);
const tomb = fromLandUpgradeMove(
  {
    outName: 'Swamp',
    outCard: COACH_CARDS['Swamp'],
    inName: 'Overgrown Tomb',
    inCard: COACH_CARDS['Overgrown Tomb'],
    owned: false,
    reason: 'Not owned. Keeps your colors and adds green, over Swamp.',
    outScore: 10,
    inScore: 58,
    fixesShortColors: [],
    addsColors: ['G'],
  },
  'unowned'
);
const bastion = fromCostSwapRow(
  {
    id: 'Indatha Triome',
    currentName: 'Indatha Triome',
    currentPrice: 9.5,
    currentInclusion: 30,
    suggestionName: "Karn's Bastion",
    suggestionPrice: 1.1,
    suggestionInclusion: 60,
    savings: 8.4,
    confidence: 'drop-in',
    category: 'land',
  },
  'unowned'
);

describe('rankCoachMoves (T171): promoted by what the row fixes', () => {
  const ranked = rankCoachMoves([archfiend, tomb, bastion, misty, beastWithin, swords], ctx);
  const tierOf = (name: string) => ranked.find((r) => r.change.name === name)?.tier;

  it('lifts a missing staple on the low cardFit it closes, ahead of every other row', () => {
    expect(tierOf('Swords to Plowshares')).toBe(1);
    expect(ranked.map((r) => r.change.name).slice(0, 2)).toEqual([
      'Swords to Plowshares',
      'Beast Within',
    ]);
  });

  it('never promotes a synergy pick for an engine the deck only started', () => {
    expect(tierOf('Archfiend of Ifnir')).toBe(3);
    expect(ranked.at(-1)?.change.name).toBe('Archfiend of Ifnir');
  });

  it('leaves manabase adds to the land lane: no tier on a low cardFit', () => {
    expect(tierOf('Misty Rainforest')).toBe(3);
  });

  it("sorts a land swap by play rate like every row, so its deltaScore can't outrank a staple", () => {
    const names = ranked.map((r) => r.change.name);
    expect(names.indexOf('Overgrown Tomb')).toBeGreaterThan(names.indexOf('Misty Rainforest'));
  });

  it("ranks a budget swap after every row that makes the deck better, whatever the cheaper card's play rate", () => {
    const names = ranked.map((r) => r.change.name);
    expect(names.indexOf("Karn's Bastion")).toBeGreaterThan(names.indexOf('Overgrown Tomb'));
  });

  it('orders a tuned deck (every row tier 3) staple, land swap, then budget swap', () => {
    const tuned: CoachContext = {
      ...ctx,
      planScore: {
        ...planScore,
        subscores: { strategy: sub(85), roles: sub(85), curve: sub(85), cardFit: sub(85) },
      },
    };
    const order = rankCoachMoves([bastion, tomb, swords], tuned).map((r) => r.change.name);
    expect(order).toEqual(['Swords to Plowshares', 'Overgrown Tomb', "Karn's Bastion"]);
  });
});

describe('rankCoachMoves (T171 re-gate): the live role counts decide a gap', () => {
  const met: CoachContext = { ...ctx, roleCounts: { ...ctx.roleCounts, removal: 8 } };

  it('drops a "Fills Removal gap" row once removal is at target', () => {
    const names = rankCoachMoves([beastWithin, swords], met).map((r) => r.change.name);
    expect(names).toEqual(['Swords to Plowshares']);
  });

  it('keeps a staple in a met role as a quality swap on cardFit, not a role gap', () => {
    const tuned: CoachContext = {
      ...met,
      planScore: {
        ...planScore,
        subscores: { strategy: sub(85), roles: sub(50), curve: sub(85), cardFit: sub(85) },
      },
    };
    // Roles at 50 would make a removal gap tier 1; removal is met, so it isn't one.
    expect(rankCoachMoves([swords], tuned)[0].tier).toBe(3);
    expect(rankCoachMoves([swords], { ...tuned, roleCounts: ctx.roleCounts })[0].tier).toBe(1);
  });
});

describe('rankCoachMoves (T171): cuts read weakest first', () => {
  it('puts a card off the commander page first and land tuning last', () => {
    const cuts = rankCoachMoves(
      [
        fromOptimizeCard(
          {
            name: 'Fathom Mage',
            reason: 'Excess Card advantage',
            reasonCategory: 'excess:cardDraw',
            inclusion: 15,
            primaryType: 'Creature',
          },
          'cut'
        ),
        fromOptimizeCard(
          {
            name: 'Plains',
            reason: 'Swap for an Island. Too many white basics.',
            reasonCategory: 'color-rebalance',
            inclusion: null,
            primaryType: 'Land',
          },
          'cut'
        ),
        fromMisfit({
          name: 'Aetherjacket',
          misfitScore: 25,
          reasons: [
            { kind: 'inclusion-absent', label: "Not played in this commander's decks", detail: '' },
          ],
        }),
      ],
      ctx
    );
    expect(cuts.map((r) => r.change.name)).toEqual(['Aetherjacket', 'Fathom Mage', 'Plains']);
  });
});
