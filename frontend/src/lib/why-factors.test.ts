import { describe, expect, it } from 'vitest';
import {
  buildBracketMoveFactors,
  buildBudgetSwapFactors,
  buildComboCompletionFactors,
  buildCutFactors,
  buildGapAddFactors,
  buildOptimizeFactors,
  buildSwapAlternativeFactors,
  buildSynergyPickFactors,
} from './why-factors';

describe('buildSwapAlternativeFactors', () => {
  it('differentiates owned vs unowned and staple vs fringe', () => {
    const owned = buildSwapAlternativeFactors({ owned: true, inclusion: 78, roleLabel: 'Ramp' });
    const fringe = buildSwapAlternativeFactors({ owned: false, inclusion: 8, roleLabel: 'Ramp' });
    // The two rows must NOT read identically (the bug this replaces: 6× "Ramp staple").
    expect(owned.map((f) => f.text)).not.toEqual(fringe.map((f) => f.text));
    expect(owned[0]).toMatchObject({ tone: 'pro' });
    expect(fringe[0]).toMatchObject({ tone: 'con' });
    expect(owned.some((f) => /staple/.test(f.text))).toBe(true);
    expect(fringe.some((f) => /fringe/.test(f.text))).toBe(true);
  });

  it('only emits a synergy line when positive, and threads the commander name', () => {
    expect(
      buildSwapAlternativeFactors({ owned: true, synergy: 0 }).some((f) => /synergy/.test(f.text))
    ).toBe(false);
    const f = buildSwapAlternativeFactors({ owned: true, synergy: 12, commanderName: 'Atraxa' });
    expect(f.some((x) => /synergy with Atraxa/.test(x.text))).toBe(true);
  });
});

describe('buildCutFactors', () => {
  it('leads with a combo-break caution as a con', () => {
    const f = buildCutFactors({
      sameAxis: false,
      sameRole: true,
      roleLabel: 'Ramp',
      sameType: false,
      comboWarning: 'Breaks combo: Thopter Foundry + Sword (infinite tokens)',
    });
    expect(f[0]).toMatchObject({ tone: 'con' });
    expect(f[0].text).toMatch(/Breaks combo/);
  });

  it('frames a like-for-like axis swap as a pro and flags low play-rate as cuttable', () => {
    const f = buildCutFactors({
      sameAxis: true,
      axisLabel: 'Tokens',
      sameRole: false,
      sameType: false,
      inclusion: 9,
    });
    expect(f.some((x) => x.tone === 'pro' && /Tokens engine/.test(x.text))).toBe(true);
    expect(f.some((x) => x.tone === 'pro' && /Lightly played/.test(x.text))).toBe(true);
  });

  it('returns nothing when no signal is present (disclosure then hides)', () => {
    expect(buildCutFactors({ sameAxis: false, sameRole: false, sameType: false })).toEqual([]);
  });
});

describe('buildGapAddFactors', () => {
  it('leads with the role gap and includes lift co-play as package evidence', () => {
    const f = buildGapAddFactors({
      roleLabel: 'Removal',
      inclusion: 62,
      liftedBy: ['Teysa Karlov', 'Pitiless Plunderer'],
      owned: false,
    });
    expect(f[0]).toMatchObject({ tone: 'pro' });
    expect(f[0].text).toMatch(/light on Removal/);
    expect(f.some((x) => /Teysa Karlov, Pitiless Plunderer/.test(x.text))).toBe(true);
    expect(f.some((x) => /staple/.test(x.text))).toBe(true);
  });

  it('only emits synergy when positive and owned as a bonus', () => {
    const f = buildGapAddFactors({ inclusion: 10, synergy: -3, owned: true });
    expect(f.some((x) => /Overperforms/.test(x.text))).toBe(false);
    expect(f.some((x) => /Already in your collection/.test(x.text) && x.tone === 'pro')).toBe(true);
    expect(f.some((x) => /fringe/.test(x.text))).toBe(true);
  });
});

describe('buildSynergyPickFactors', () => {
  it('frames payoff vs producer against the axis, in different words', () => {
    const payoff = buildSynergyPickFactors({ axisLabel: 'Tokens', side: 'payoff', inclusion: 12 });
    const producer = buildSynergyPickFactors({ axisLabel: 'Tokens', side: 'producer' });
    expect(payoff[0].text).toMatch(/payoff for your Tokens engine/);
    expect(producer[0].text).toMatch(/Feeds your Tokens payoffs/);
    expect(payoff[0].text).not.toBe(producer[0].text);
  });

  it('owns the off-meta framing when inclusion is unknown, play-rate when known', () => {
    const offMeta = buildSynergyPickFactors({ axisLabel: 'Blink', side: 'payoff' });
    const known = buildSynergyPickFactors({ axisLabel: 'Blink', side: 'payoff', inclusion: 9 });
    expect(offMeta.some((x) => /off-meta edge/.test(x.text))).toBe(true);
    expect(known.some((x) => /9% of similar decks/.test(x.text))).toBe(true);
  });
});

describe('buildOptimizeFactors', () => {
  it('interprets cut categories instead of restating them', () => {
    const tapland = buildOptimizeFactors('cut', { reasonCategory: 'tapland' });
    expect(tapland[0].text).toMatch(/tempo tax/);
    const excess = buildOptimizeFactors('cut', {
      reasonCategory: 'excess:ramp',
      roleLabel: 'Ramp',
      inclusion: 12,
    });
    expect(excess[0].text).toMatch(/oversupplied on Ramp/);
    expect(excess.some((x) => /Lightly played/.test(x.text) && x.tone === 'pro')).toBe(true);
    const offPkg = buildOptimizeFactors('cut', { reasonCategory: 'off-package' });
    expect(offPkg[0].text).toMatch(/No co-play ties/);
  });

  it('interprets add categories: role fill, mana fix, flex land, curve phase', () => {
    expect(
      buildOptimizeFactors('add', { reasonCategory: 'fills:removal', roleLabel: 'Removal' })[0].text
    ).toMatch(/Removal count is under target/);
    expect(buildOptimizeFactors('add', { reasonCategory: 'mana-fix' })[0].text).toMatch(
      /mana base graded low/
    );
    expect(buildOptimizeFactors('add', { reasonCategory: 'flex-land' })[0].text).toMatch(
      /also a spell/
    );
    expect(buildOptimizeFactors('add', { reasonCategory: 'curve:early' })[0].text).toMatch(
      /quiet phase of your curve/
    );
  });

  it('handles unknown categories and null inclusion without fabricating lines', () => {
    expect(buildOptimizeFactors('cut', { reasonCategory: 'mystery', inclusion: null })).toEqual([]);
  });

  it('flags a Game Changer as neutral context on both sides', () => {
    const cut = buildOptimizeFactors('cut', { reasonCategory: 'low-synergy', isGameChanger: true });
    const add = buildOptimizeFactors('add', { reasonCategory: 'synergy', isGameChanger: true });
    expect(cut.some((x) => /Game Changer/.test(x.text) && x.tone === 'neutral')).toBe(true);
    expect(add.some((x) => /Game Changer/.test(x.text) && x.tone === 'neutral')).toBe(true);
  });
});

describe('buildBracketMoveFactors', () => {
  it('grounds each signal in bracket rules', () => {
    const gc = buildBracketMoveFactors({ type: 'cut', signal: 'game-changer' });
    expect(gc[0].text).toMatch(/Game Changers list/);
    const mld = buildBracketMoveFactors({ type: 'cut', signal: 'mass-land-denial' });
    expect(mld[0].text).toMatch(/Bracket 4\+/);
    const up = buildBracketMoveFactors({ type: 'add', signal: 'upshift-gc', inclusion: 55 });
    expect(up[0].text).toMatch(/toward your target/);
    expect(up.some((x) => /staple/.test(x.text))).toBe(true);
  });

  it('adds the like-for-like line only on swaps, and no inclusion line on cuts', () => {
    const swap = buildBracketMoveFactors({
      type: 'swap',
      signal: 'game-changer',
      roleLabel: 'Ramp',
      inclusion: 30,
    });
    expect(swap.some((x) => /Same Ramp slot/.test(x.text))).toBe(true);
    const cut = buildBracketMoveFactors({ type: 'cut', signal: 'stax', inclusion: 30 });
    expect(cut.some((x) => /decks/.test(x.text) && /30%/.test(x.text))).toBe(false);
  });
});

describe('buildComboCompletionFactors', () => {
  it('counts held pieces and warns on a two-card combo', () => {
    const f = buildComboCompletionFactors({ totalPieces: 2, owned: true });
    expect(f[0].text).toMatch(/1 of 2 pieces/);
    expect(f.some((x) => /two-card combo/.test(x.text) && x.tone === 'con')).toBe(true);
    expect(f.some((x) => /own the missing piece/.test(x.text))).toBe(true);
  });

  it('cites popularity only when the line is actually proven', () => {
    const popular = buildComboCompletionFactors({
      totalPieces: 3,
      popularity: 12400,
      owned: false,
    });
    expect(popular.some((x) => /12,400 decks/.test(x.text))).toBe(true);
    expect(popular.some((x) => /two-card/.test(x.text))).toBe(false);
    const niche = buildComboCompletionFactors({ totalPieces: 3, popularity: 40, owned: false });
    expect(niche.some((x) => /decks run this combo/.test(x.text))).toBe(false);
  });
});

describe('buildBudgetSwapFactors', () => {
  it('leads with the tier judgement: drop-in pro, budget con', () => {
    const dropIn = buildBudgetSwapFactors({ confidence: 'drop-in', owned: false });
    const budget = buildBudgetSwapFactors({ confidence: 'budget', owned: false });
    expect(dropIn[0].tone).toBe('pro');
    expect(budget[0].tone).toBe('con');
    expect(dropIn[0].text).not.toBe(budget[0].text);
  });

  it('backs the drop-in "same curve slot" wording only when both CMCs are close', () => {
    const close = buildBudgetSwapFactors({
      confidence: 'drop-in',
      owned: false,
      currentCmc: 3,
      suggestionCmc: 2,
    });
    const far = buildBudgetSwapFactors({
      confidence: 'drop-in',
      owned: false,
      currentCmc: 5,
      suggestionCmc: 1,
    });
    expect(close[0].text).toMatch(/curve slot/);
    expect(far[0].text).not.toMatch(/curve slot/);
  });

  it('surfaces ownership only as a bonus, never a "not owned" con', () => {
    const owned = buildBudgetSwapFactors({ confidence: 'sidegrade', owned: true });
    const unowned = buildBudgetSwapFactors({ confidence: 'sidegrade', owned: false });
    expect(owned.some((f) => /already own it/.test(f.text) && f.tone === 'pro')).toBe(true);
    // Budget downgrades are bought by design — never scold the user for not owning it.
    expect(unowned.some((f) => /[Nn]ot in your collection/.test(f.text))).toBe(false);
  });
});
