import { describe, it, expect } from 'vitest';
import {
  curveShapeFromAvgCmc,
  continuousCurvePhaseScore,
  getCurveGrade,
  getDeckSummaryData,
  type DeckAnalysis,
  type CurvePhaseAnalysis,
  type GradeResult,
} from './deckAnalyzer';

// E78 item 2: getDeckSummaryData's headline and getCurveGrade's C/D message
// both used to derive "top-heavy"/"curve skews low" from an EDHREC-relative
// comparison (this deck's low/high-CMC card count vs the reference
// commander's typical curve), which could contradict the avgCmc number
// printed right next to it — a real Kozilek build (avgCmc 4.42-4.53, an
// 11-12 card CMC-7+ spike) was labeled "curve skews low", and a normal
// Isshin build (avgCmc 3.28-3.37) was labeled "top-heavy". Both functions now
// derive the shape word from this single, absolute avgCmc threshold instead.
describe('curveShapeFromAvgCmc', () => {
  it('calls a high avg CMC top-heavy (Kozilek-shaped: 4.42)', () => {
    expect(curveShapeFromAvgCmc(4.42)).toBe('top-heavy');
  });

  it('does not call a normal avg CMC top-heavy (Isshin-shaped: 3.28)', () => {
    expect(curveShapeFromAvgCmc(3.28)).toBeNull();
  });

  it('calls a low avg CMC bottom-heavy', () => {
    expect(curveShapeFromAvgCmc(2.1)).toBe('bottom-heavy');
  });

  it('treats 0 (no nonland cards) as neutral, not bottom-heavy', () => {
    expect(curveShapeFromAvgCmc(0)).toBeNull();
  });
});

// E129: deckGrade.letter flipped a full step (A -> B) on two iter-18 A/B
// decks (krenko, lathril) from an owned-collection swap that shifted just
// one card between adjacent curve phases — a marginal deviationPct move
// past getCurveGrade's 10% A/B cutoff on ONE phase, which alone dragged the
// 3-way (roles/mana/curve) deckGrade average down a full letter. Root cause:
// getDeckSummaryData's avgScore averaged already-quantized per-dimension
// letters, so a single dimension's bucket-edge crossing moved the average by
// a full 1/3 point. continuousCurvePhaseScore replaces curve's contribution
// with a smooth ramp through the same cutoffs so a marginal crossing moves
// the average by a sliver instead.
describe('continuousCurvePhaseScore', () => {
  const phase = (over: Partial<CurvePhaseAnalysis>): CurvePhaseAnalysis =>
    ({
      phase: 'early',
      label: 'Early Game',
      cmcRange: [0, 2],
      current: 0,
      target: 0,
      delta: 0,
      cards: [],
      pctOfDeck: 0,
      avgCmc: 0,
      grade: { letter: 'A', message: '' },
      rampInPhase: 0,
      interactionInPhase: 0,
      cardDrawInPhase: 0,
      phaseRoleBreakdowns: [],
      ...over,
    }) as CurvePhaseAnalysis;

  it('returns 0 for no phases', () => {
    expect(continuousCurvePhaseScore([])).toBe(0);
  });

  it('scores a dead-on phase at the top of the scale (4)', () => {
    const phases = [
      phase({ phase: 'early', current: 9, target: 9, delta: 0 }),
      phase({ phase: 'mid', current: 30, target: 30, delta: 0 }),
      phase({ phase: 'late', current: 10, target: 10, delta: 0 }),
    ];
    expect(continuousCurvePhaseScore(phases)).toBeCloseTo(4, 5);
  });

  it('moves only a sliver when a single phase crosses the old A/B cutoff, not a full letter', () => {
    // Old getCurveGrade bucketing: deviationPct <= 0.1 -> A(4), else -> B(3),
    // a full 1-point cliff (times the phase's own weight). Same shift here
    // (9 -> 8 of a 9 target, dev ~0.111, just past the 0.1 cutoff) on the
    // 'early' phase (weight 0.3, so a full letter-cliff would be a 0.3 move)
    // should move the *continuous* score by well under that.
    const before = continuousCurvePhaseScore([
      phase({ phase: 'early', current: 9, target: 9, delta: 0 }),
    ]);
    const after = continuousCurvePhaseScore([
      phase({ phase: 'early', current: 8, target: 9, delta: -1 }),
    ]);
    expect(before).toBeCloseTo(4 * 0.3, 5);
    expect(before - after).toBeLessThan(0.3);
    expect(before - after).toBeGreaterThan(0); // still responds — not flattened to a no-op
  });

  it('still drags the score toward 0 for a genuinely blown phase', () => {
    const solid = continuousCurvePhaseScore([
      phase({ phase: 'early', current: 9, target: 9, delta: 0 }),
    ]);
    const blown = continuousCurvePhaseScore([
      phase({ phase: 'early', current: 0, target: 9, delta: -9 }),
    ]);
    expect(solid).toBeGreaterThan(1);
    expect(blown).toBe(0);
  });
});

describe('getDeckSummaryData — deckGrade boundary stability (E129)', () => {
  // Minimal DeckAnalysis: getDeckSummaryData only reads roleDeficits,
  // curveAnalysis, manaBase, rolesGrade, manaGrade, and curvePhases — the
  // rest of the (large) DeckAnalysis shape is irrelevant to this function.
  function analysis(over: {
    rolesGrade: GradeResult;
    manaGrade: GradeResult;
    curveGrade: GradeResult;
    curvePhases: CurvePhaseAnalysis[];
  }): DeckAnalysis {
    return {
      roleDeficits: [],
      curveAnalysis: [],
      manaBase: {
        currentLands: 37,
        suggestedLands: 37,
        adjustedSuggestion: 37,
        currentBasic: 15,
        currentNonbasic: 22,
        suggestedBasic: 15,
        suggestedNonbasic: 22,
        rampCount: 10,
        manaProducerCount: 8,
        verdict: 'ok',
        verdictMessage: '',
        probLand0: 0,
        probLand1: 0,
        probLand2to3: 0.5,
        probLand4plus: 0,
        deckSize: 99,
        taplandCount: 0,
        taplandRatio: 0,
      },
      ...over,
    } as unknown as DeckAnalysis;
  }

  const phase = (over: Partial<CurvePhaseAnalysis>): CurvePhaseAnalysis =>
    ({
      phase: 'early',
      label: 'Early Game',
      cmcRange: [0, 2],
      current: 0,
      target: 0,
      delta: 0,
      cards: [],
      pctOfDeck: 0,
      avgCmc: 0,
      grade: { letter: 'A', message: '' },
      rampInPhase: 0,
      interactionInPhase: 0,
      cardDrawInPhase: 0,
      phaseRoleBreakdowns: [],
      ...over,
    }) as CurvePhaseAnalysis;

  // krenko-mob-boss shape: rolesGrade A, manaGrade B (persistent "2 red
  // sources short" note in both runs — unaffected by the swap), curveGrade
  // A -> B from one card moving early -> mid (mirrors the real dump: early
  // 29->28, mid 28->29 of 63 nonland cards). Uniform target=9 per phase
  // below is a simplified stand-in for the real per-phase targets — what
  // matters is the ratio (each phase's deviationPct crosses getCurveGrade's
  // 10% A/B cutoff), verified against the real getCurveGrade below so this
  // fixture provably reproduces the flip, not just an assumed one.
  it('krenko: a marginal two-phase curve dip no longer flips A -> B', () => {
    const baselinePhases = [
      phase({ phase: 'early', current: 9, target: 9, delta: 0 }),
      phase({ phase: 'mid', current: 9, target: 9, delta: 0 }),
      phase({ phase: 'late', current: 9, target: 9, delta: 0 }),
    ];
    // grade.letter mirrors what getCurvePhases would itself compute for each
    // phase's deviationPct (0.111 falls in the (0.1, 0.2] "B" bucket) — this
    // fixture builds CurvePhaseAnalysis objects directly rather than through
    // the full getCurvePhases pipeline, so grade must be set explicitly.
    const treatmentPhases = [
      phase({
        phase: 'early',
        current: 8,
        target: 9,
        delta: -1,
        grade: { letter: 'B', message: '' },
      }), // dev 0.111, crosses old 0.1 A/B cutoff
      phase({
        phase: 'mid',
        current: 10,
        target: 9,
        delta: 1,
        grade: { letter: 'B', message: '' },
      }), // dev 0.111, crosses old 0.1 A/B cutoff
      phase({ phase: 'late', current: 9, target: 9, delta: 0 }),
    ];

    // Self-check: this fixture must genuinely reproduce the old A -> B flip
    // via the real per-phase-weighted formula (not just an assumed letter).
    const baselineCurveGrade = getCurveGrade(baselinePhases);
    const treatmentCurveGrade = getCurveGrade(treatmentPhases);
    expect(baselineCurveGrade.letter).toBe('A');
    expect(treatmentCurveGrade.letter).toBe('B');

    const baseline = getDeckSummaryData(
      analysis({
        rolesGrade: { letter: 'A', message: '' },
        manaGrade: { letter: 'B', message: '' },
        curveGrade: baselineCurveGrade,
        curvePhases: baselinePhases,
      })
    );
    const treatment = getDeckSummaryData(
      analysis({
        rolesGrade: { letter: 'A', message: '' },
        manaGrade: { letter: 'B', message: '' },
        curveGrade: treatmentCurveGrade,
        curvePhases: treatmentPhases,
      })
    );

    expect(baseline.gradeLetter).toBe('A');
    // Before E129 this was `letterFromScore((4 + 3 + 3) / 3)` = 'B' — the
    // observed regression. The fix keeps it 'A': the deck didn't get worse
    // enough to justify a full letter drop.
    expect(treatment.gradeLetter).toBe('A');
  });

  // lathril-blade-of-the-elves shape: rolesGrade B (unchanged — same role
  // deficits both runs), manaGrade A, curveGrade A -> B from one card moving
  // early -> late (mirrors the real dump: early 19->20, late 7->6 of 62
  // nonland cards; deckScore only moved -0.14%).
  it('lathril: deckScore essentially flat, marginal two-phase curve dip no longer flips A -> B', () => {
    const baselinePhases = [
      phase({ phase: 'early', current: 9, target: 9, delta: 0 }),
      phase({ phase: 'mid', current: 9, target: 9, delta: 0 }),
      phase({ phase: 'late', current: 9, target: 9, delta: 0 }),
    ];
    const treatmentPhases = [
      phase({
        phase: 'early',
        current: 10,
        target: 9,
        delta: 1,
        grade: { letter: 'B', message: '' },
      }), // dev 0.111, crosses old 0.1 A/B cutoff
      phase({ phase: 'mid', current: 9, target: 9, delta: 0 }),
      phase({
        phase: 'late',
        current: 8,
        target: 9,
        delta: -1,
        grade: { letter: 'B', message: '' },
      }), // dev 0.111, crosses old 0.1 A/B cutoff
    ];

    const baselineCurveGrade = getCurveGrade(baselinePhases);
    const treatmentCurveGrade = getCurveGrade(treatmentPhases);
    expect(baselineCurveGrade.letter).toBe('A');
    expect(treatmentCurveGrade.letter).toBe('B');

    const baseline = getDeckSummaryData(
      analysis({
        rolesGrade: { letter: 'B', message: '' },
        manaGrade: { letter: 'A', message: '' },
        curveGrade: baselineCurveGrade,
        curvePhases: baselinePhases,
      })
    );
    const treatment = getDeckSummaryData(
      analysis({
        rolesGrade: { letter: 'B', message: '' },
        manaGrade: { letter: 'A', message: '' },
        curveGrade: treatmentCurveGrade,
        curvePhases: treatmentPhases,
      })
    );

    expect(baseline.gradeLetter).toBe('A');
    expect(treatment.gradeLetter).toBe('A');
  });

  it('a genuinely bad curve still drags the letter down (mechanism is softened, not disabled)', () => {
    const good = getDeckSummaryData(
      analysis({
        rolesGrade: { letter: 'A', message: '' },
        manaGrade: { letter: 'A', message: '' },
        curveGrade: { letter: 'A', message: '' },
        curvePhases: [
          phase({ phase: 'early', current: 9, target: 9, delta: 0 }),
          phase({ phase: 'mid', current: 30, target: 30, delta: 0 }),
          phase({ phase: 'late', current: 10, target: 10, delta: 0 }),
        ],
      })
    );
    const bad = getDeckSummaryData(
      analysis({
        rolesGrade: { letter: 'A', message: '' },
        manaGrade: { letter: 'A', message: '' },
        curveGrade: { letter: 'F', message: '' },
        curvePhases: [
          phase({ phase: 'early', current: 0, target: 9, delta: -9 }),
          phase({ phase: 'mid', current: 0, target: 30, delta: -30 }),
          phase({ phase: 'late', current: 0, target: 10, delta: -10 }),
        ],
      })
    );

    expect(good.gradeLetter).toBe('A');
    expect(bad.gradeLetter).not.toBe('A');
  });
});
