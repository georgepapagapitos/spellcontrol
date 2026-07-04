// Unit coverage for the two note-composition seams pulled out of
// generateDeck()'s tail (see deckGenerator.ts): landCountNote and budgetNote
// must reflect the FINAL deck (post combo-floor/fixup/coherence-repair/
// bracket-convergence), never the values known at the earlier decision point.
// These are plain pure functions precisely so that reconciliation is testable
// without standing up the full generateDeck orchestration (covered instead by
// deckGenerator.golden.test.ts / .live.test.ts, which this file doesn't touch).
import { describe, it, expect } from 'vitest';
import { buildLandCountNote, buildOverBudgetNote } from './deckGenerator';
import { Archetype } from '@/deck-builder/types';

describe('buildLandCountNote', () => {
  it('names the archetype when confidence is high', () => {
    const note = buildLandCountNote({
      finalLandCount: 37,
      archetype: Archetype.ENCHANTRESS,
      isLowConfidence: false,
      edhrecRampCount: 10,
      finalAvgCmc: 3.2,
    });
    expect(note).toContain('for a Enchantress deck');
  });

  it('softens the copy instead of naming a low-confidence archetype guess', () => {
    const note = buildLandCountNote({
      finalLandCount: 37,
      archetype: Archetype.VOLTRON, // e.g. Atraxa's mislabeled keyword-vote guess
      isLowConfidence: true,
      edhrecRampCount: 10,
      finalAvgCmc: 3.2,
    });
    expect(note).toContain("for this deck's profile");
    expect(note).not.toContain('Voltron');
  });

  it('reconciles to FINAL state, not the values known at the auto-tune decision point', () => {
    // Simulate: at auto-tune time the target was 36 lands / avg CMC 3.0, but a
    // later coherence-repair/bracket-convergence pass shipped 35 lands and
    // shifted the curve to avg CMC 3.4 — the note must reflect the shipped
    // numbers, not the stale decision-time ones.
    const staleDecisionTimeNote = buildLandCountNote({
      finalLandCount: 36,
      archetype: Archetype.MIDRANGE,
      isLowConfidence: false,
      edhrecRampCount: 8,
      finalAvgCmc: 3.0,
    });
    const finalNote = buildLandCountNote({
      finalLandCount: 35, // mutated after the decision point
      archetype: Archetype.MIDRANGE,
      isLowConfidence: false,
      edhrecRampCount: 8,
      finalAvgCmc: 3.4, // mutated after the decision point
    });
    expect(finalNote).toContain('Auto-tuned to 35 lands');
    expect(finalNote).toContain('avg CMC 3.4');
    expect(finalNote).not.toBe(staleDecisionTimeNote);
  });

  it('formats CMC to one decimal place', () => {
    const note = buildLandCountNote({
      finalLandCount: 36,
      archetype: Archetype.GOODSTUFF,
      isLowConfidence: false,
      edhrecRampCount: 9,
      finalAvgCmc: 3,
    });
    expect(note).toContain('avg CMC 3.0');
  });
});

describe('buildOverBudgetNote', () => {
  it('returns undefined when the final total is within budget', () => {
    expect(
      buildOverBudgetNote({
        finalTotal: 45,
        deckBudget: 50,
        currency: 'USD',
        comboBudgetSkipCount: 0,
      })
    ).toBeUndefined();
  });

  it('states the actual total and the over-budget delta', () => {
    const note = buildOverBudgetNote({
      finalTotal: 70.24,
      deckBudget: 50,
      currency: 'USD',
      comboBudgetSkipCount: 0,
    });
    expect(note).toContain('$70.24');
    expect(note).toContain('$20.24');
    expect(note).toContain('$50');
  });

  it('keeps the skipped-upgrades clause when combo candidates were also skipped', () => {
    const note = buildOverBudgetNote({
      finalTotal: 60,
      deckBudget: 50,
      currency: 'USD',
      comboBudgetSkipCount: 2,
    });
    expect(note).toContain('over your $50 budget');
    expect(note).toContain('skipped');
  });

  it('uses the euro symbol for EUR', () => {
    const note = buildOverBudgetNote({
      finalTotal: 60,
      deckBudget: 50,
      currency: 'EUR',
      comboBudgetSkipCount: 0,
    });
    expect(note).toContain('€60.00');
    expect(note).toContain('€50');
  });
});
