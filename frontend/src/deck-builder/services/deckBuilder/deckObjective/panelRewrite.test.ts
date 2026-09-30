// @vitest-environment node
//
// Writing an optimized deck back as a panel dump (panelRewrite.ts), over the
// real E510 Meren treatment and its real cards.
import { describe, expect, it } from 'vitest';
import { optimizeDeck } from './optimizer';
import { projectCard, rewriteDump } from './panelRewrite';
import type { PanelDump } from './panelDump';
import { BASELINE, FIX, TREATMENT, merenCtx } from './__fixtures__/objectiveFixture';

const ctx = merenCtx();
const dump = {
  commander: FIX.meren.commander,
  variant: 'base',
  partner: null,
  colorIdentity: FIX.meren.colorIdentity,
  customization: { deckFormat: 99 },
  decklist: {
    lands: TREATMENT.cards
      .filter((c) => /\bLand\b/.test(c.type_line))
      .map((c) => projectCard(c, ctx)),
    creatures: TREATMENT.cards
      .filter((c) => !/\bLand\b/.test(c.type_line))
      .map((c) => projectCard(c, ctx)),
  },
  roleTargets: FIX.meren.roleTargets,
  detectedCombos: FIX.meren.combos,
  buildReport: { dataSource: 'base', cardProvenance: {} },
  gapAnalysis: [{ name: 'Skullclamp' }, { name: 'Not In The Deck' }],
  allNotes: { liftPicksNote: 'generator note' },
  deckGrade: { letter: 'B' },
  deckScore: 3000,
} as unknown as PanelDump & Record<string, unknown>;

interface Out {
  decklist: Record<string, Array<{ name: string; oracle_text_snippet?: string }>>;
  stats: { totalCards: number };
  roleCounts: Record<string, number>;
  deckGrade: unknown;
  deckScore: unknown;
  gapAnalysis: Array<{ name: string }>;
  bracketEstimation: { breakdown: { gameChangerNames: string[] } };
  allNotes: Record<string, string>;
  buildReport: {
    optimizerSwaps: Array<{ in: string[]; reasons: string[] }>;
    cardProvenance: Record<string, string>;
  };
}

describe('rewriteDump', () => {
  const result = optimizeDeck(TREATMENT, BASELINE.cards, ctx, {
    maxSwaps: 2,
    maxEvaluations: 20,
    shortlist: 8,
    escapes: 0,
  });
  const out = rewriteDump(dump, result, ctx) as unknown as Out;
  const names = Object.values(out.decklist)
    .flat()
    .map((c) => c.name);

  it('writes the optimized 99, swapped cards projected like the harness projects them', () => {
    expect(names.length).toBe(99);
    expect(names.sort()).toEqual(result.deck.cards.map((c) => c.name).sort());
    const added = result.swaps.flatMap((s) => s.in);
    expect(added.length).toBeGreaterThan(0);
    const card = Object.values(out.decklist)
      .flat()
      .find((c) => c.name === added[0]);
    expect(card).toMatchObject({ name: added[0], oracle_text_snippet: expect.any(String) });
  });

  it('recomputes what describes the cards; without the seed it leaves the ratings alone', () => {
    expect(out.stats.totalCards).toBe(99);
    expect(out.roleCounts).toEqual(expect.objectContaining({ ramp: expect.any(Number) }));
    expect(out.deckGrade).toEqual({ letter: 'B' });
    expect(out.deckScore).toBe(3000);
    const inDeck = new Set(names);
    for (const g of out.gapAnalysis) expect(inDeck.has(g.name)).toBe(false);
  });

  it('counts a double-faced Game Changer, named by its front face on the list', () => {
    const tergrid = "Tergrid, God of Fright // Tergrid's Lantern";
    expect(names).toContain(tergrid);
    expect(out.bracketEstimation.breakdown.gameChangerNames).toContain(tergrid);
  });

  it('says what the search changed, and why, next to the generator notes it keeps', () => {
    expect(out.allNotes.liftPicksNote).toBe('generator note');
    expect(out.allNotes.optimizerNote).toMatch(/whole-deck search made \d+ swap/);
    expect(out.buildReport.optimizerSwaps).toHaveLength(result.swaps.length);
    const first = out.buildReport.optimizerSwaps[0];
    expect(first.reasons.length).toBeGreaterThan(0);
    expect(out.buildReport.cardProvenance[first.in[0]]).toMatch(/whole-deck search/);
  });
});
