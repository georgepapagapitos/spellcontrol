import { describe, expect, it } from 'vitest';
import {
  adviseMarkdown,
  adviseNumbers,
  benchMarkdown,
  benchNumbers,
  IMPLICIT_REVERSAL,
  type AdviseRecord,
  type BenchRecord,
  type SurfaceLists,
} from './coachReport';

function lists(over: Partial<SurfaceLists> = {}): SurfaceLists {
  return {
    cutsLane: [],
    cutsBySurface: {},
    swapOuts: [],
    replaceCuts: [],
    appliedCuts: [],
    feedAdds: [],
    addsBySurface: {},
    universeAdds: [],
    ...over,
  };
}

// Two real Krenko, Mob Boss readings: what the critic called weak and missing.
const KRENKO: BenchRecord = {
  gate: 'E511',
  deck: 'standard--krenko-mob-boss',
  deckSize: 99,
  labels: {
    weak: ['Moggcatcher', 'Seething Song', 'Goblin Chirurgeon'],
    missing: ['Chaos Warp', "Ashnod's Altar", 'Purphoros, God of the Forge'],
    lostPremium: [],
    replacedBy: [],
  },
  post: lists({
    cutsLane: ['Moggcatcher', 'Skullclamp'],
    cutsBySurface: { 'optimize:excess-role': ['Moggcatcher', 'Skullclamp'] },
    replaceCuts: ['Moggcatcher'],
    appliedCuts: ['Moggcatcher', 'Skullclamp'],
    feedAdds: ['Metallic Mimic', 'Chaos Warp', 'Ruby Medallion'],
    addsBySurface: {
      nbm: ['Metallic Mimic'],
      'fill-gaps': ['Chaos Warp', 'Ruby Medallion'],
      'hidden-gems': ['Mana Vault'],
    },
    universeAdds: ['Metallic Mimic', 'Chaos Warp', 'Ruby Medallion', "Ashnod's Altar"],
  }),
  pre: lists({
    feedAdds: ['Metallic Mimic', 'Chaos Warp', 'Ruby Medallion'],
    addsBySurface: { nbm: ['Metallic Mimic'], 'hidden-gems': ["Ashnod's Altar"] },
  }),
  audit: [
    {
      surface: 'fill-gaps',
      type: 'add',
      name: 'Chaos Warp',
      cut: 'Skullclamp',
      violations: [],
      cutsStaple: true,
    },
    { surface: 'fill-gaps', type: 'add', name: 'Ruby Medallion', violations: ['over-budget'] },
  ],
  nbmStrategy: { post: null, pre: null },
};

describe('benchNumbers', () => {
  it('scores cut precision, add recall, coverage and the E510 difference', () => {
    const n = benchNumbers([KRENKO]);
    expect(n.cutPrecision['Cuts lane'].p5.mean).toBe(0.5);
    expect(n.cutPrecision['Replace-when-full first cut'].p5.mean).toBe(1);
    expect(n.randomCutPrecision.mean).toBeCloseTo(3 / 99);
    expect(n.addRecall['named missing'].r5.mean).toBeCloseTo(1 / 3);
    // Two of the three missing cards were named by some surface.
    expect(n.addRecall['named missing'].coverage.mean).toBeCloseTo(2 / 3);
    expect(n.addRecall['named missing'].r5Reachable.mean).toBeCloseTo(1 / 2);
    expect(n.addRecall['lost premium'].r5.n).toBe(0);
    expect(n.surfaceAdds['fill-gaps'].p10.mean).toBe(0.5);
    expect(n.e510['Hidden gems R@10'].delta.mean).toBeCloseTo(-1 / 3);
    expect(n.e510Changed).toEqual({ hiddenGems: 1, nbmStrategy: 0, decks: 1 });
    expect(n.errors).toEqual({ 'cuts-staple': 1, 'over-budget': 1 });
    expect(n.audited).toBe(2);
    expect(benchMarkdown(n)).toMatch(/\| Cuts lane \| 0\.50 \[0\.50, 0\.50\] n=1/);
  });
});

describe('adviseNumbers', () => {
  it('counts applied moves, skips, self-consistency and ping-pong', () => {
    const rec: AdviseRecord = {
      panel: 'standard',
      deck: 'standard--krenko-mob-boss',
      applied: [
        { surface: 'fill-gaps', type: 'add', added: 'Chaos Warp', cut: 'Volley Veteran' },
        { surface: 'fill-gaps', type: 'add', added: 'Rundvelt Hordemaster', cut: 'Skullclamp' },
      ],
      skipped: [{ surface: 'budget', violations: ['over-budget'] }],
      tiers: { t1: 1, t2: 2, t3: 30, cuts: 1, nbmCardMoves: 1 },
      highConfidence: 3,
      reversed: [
        { move: '+Chaos Warp', how: IMPLICIT_REVERSAL },
        { move: '-Skullclamp', how: 'second pass suggests adding it back' },
      ],
      audit: [
        { surface: 'fill-gaps', type: 'add', name: 'Chaos Warp', violations: [], offPlan: true },
      ],
      priceBefore: 600,
      priceAfter: 620,
      bracketBefore: 3,
      bracketAfter: 4,
      appliedStapleCuts: ['Skullclamp'],
      selfReversed: [],
    };
    const failed: AdviseRecord = { ...rec, deck: 'x', error: 'EDHREC missing' };
    const n = adviseNumbers([rec, failed]);
    expect(n).toMatchObject({
      decks: 2,
      failed: 1,
      applied: 2,
      appliedBySurface: { 'fill-gaps': 2 },
      skippedByViolation: { 'over-budget': 1 },
      decksWithReversal: 1,
      bracketUp: 1,
      appliedStapleCuts: 1,
      errors: { 'off-plan': 1 },
    });
    expect(n.reversalRate.mean).toBe(1);
    expect(n.explicitReversalRate.mean).toBe(0.5);
    expect(n.priceDelta.mean).toBe(20);
    expect(adviseMarkdown('standard', n)).toMatch(/Applied 2 moves/);
  });
});
