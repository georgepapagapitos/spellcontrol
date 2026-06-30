import { describe, expect, it } from 'vitest';
import {
  buildBudgetSwapFactors,
  buildCutFactors,
  buildSwapAlternativeFactors,
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
