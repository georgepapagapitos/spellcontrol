// Unit coverage for the two note-composition seams pulled out of
// generateDeck()'s tail (see deckGenerator.ts): landCountNote and budgetNote
// must reflect the FINAL deck (post combo-floor/fixup/coherence-repair/
// bracket-convergence), never the values known at the earlier decision point.
// These are plain pure functions precisely so that reconciliation is testable
// without standing up the full generateDeck orchestration (covered instead by
// deckGenerator.golden.test.ts / .live.test.ts, which this file doesn't touch).
import { describe, it, expect, vi } from 'vitest';
import { Archetype } from '@/deck-builder/types';
import type { ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// isOverRoleCap/bumpRoleCapCount/roleCapOverage (E77 iter-4 round 2) call
// validateCardRole directly — stub it to a simple name->role map so these
// pure-logic tests don't depend on real tagger data or oracle text.
const ROLES: Record<string, RoleKey> = {};
vi.mock('@/deck-builder/services/tagger/client', () => ({
  validateCardRole: (card: { name: string }) => ROLES[card.name] ?? null,
}));

import {
  buildLandCountNote,
  buildOverBudgetNote,
  buildRoleCapOverflowNote,
  buildPriceSanityNote,
  resolvePriceSanity,
  isOverRoleCap,
  bumpRoleCapCount,
  roleCapOverage,
} from './deckGenerator';

function sc(name: string): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name,
    cmc: 2,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

describe('buildLandCountNote', () => {
  it('names the archetype when confidence is high', () => {
    const note = buildLandCountNote({
      finalLandCount: 37,
      archetype: Archetype.ENCHANTRESS,
      isLowConfidence: false,
      edhrecRampCount: 10,
      finalAvgCmc: 3.2,
    });
    expect(note).toContain('for an Enchantress deck');
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

  // E79: phaseBudgetConverge.ts now actively swaps expensive cards for
  // cheaper ones instead of only disclosing the overage — these variants
  // cover the "landed under budget" and "still over, here's why" outcomes.
  describe('convergence variants (E79)', () => {
    it('names the substitution count when convergence brought the deck under budget', () => {
      const note = buildOverBudgetNote({
        finalTotal: 48.75,
        deckBudget: 50,
        currency: 'USD',
        comboBudgetSkipCount: 0,
        convergedSwapCount: 6,
      });
      expect(note).toBe('Deck totals $48.75 — landed under your $50 budget after 6 substitutions.');
    });

    it('uses singular phrasing for exactly one substitution', () => {
      const note = buildOverBudgetNote({
        finalTotal: 49,
        deckBudget: 50,
        currency: 'USD',
        comboBudgetSkipCount: 0,
        convergedSwapCount: 1,
      });
      expect(note).toContain('1 substitution.');
      expect(note).not.toContain('1 substitutions');
    });

    it('states total, overage, substitution count, and why it is still stuck', () => {
      const note = buildOverBudgetNote({
        finalTotal: 53.1,
        deckBudget: 50,
        currency: 'USD',
        comboBudgetSkipCount: 0,
        convergedSwapCount: 9,
        residualReason: 'the rest is must-includes and combo pieces with no cheaper equivalent',
      });
      expect(note).toBe(
        'Deck totals $53.10 — $3.10 over your $50 budget after 9 substitutions; ' +
          'the rest is must-includes and combo pieces with no cheaper equivalent.'
      );
    });

    it('the $70.24 fixture is now the residual-with-no-convergence-run case (offline/no pool)', () => {
      // Same numbers as the original pinned fixture above, but now explicitly
      // representing "convergence never ran" (0 swaps, no residual reason) —
      // the plain over-budget sentence, unchanged from before E79.
      const note = buildOverBudgetNote({
        finalTotal: 70.24,
        deckBudget: 50,
        currency: 'USD',
        comboBudgetSkipCount: 0,
        convergedSwapCount: 0,
      });
      expect(note).toBe('Deck totals $70.24 — $20.24 over your $50 budget.');
    });

    it('falls back to the combo-skip clause when convergence never ran and combo candidates were skipped', () => {
      const note = buildOverBudgetNote({
        finalTotal: 60,
        deckBudget: 50,
        currency: 'USD',
        comboBudgetSkipCount: 2,
        convergedSwapCount: 0,
      });
      expect(note).toBe(
        'Deck totals $60.00 — $10.00 over your $50 budget. Some combo upgrades were skipped to stay as close as possible.'
      );
    });
  });
});

describe('isOverRoleCap / bumpRoleCapCount / roleCapOverage (E77 iter-4 round 2)', () => {
  const roleTargets: Record<RoleKey, number> = { ramp: 1, removal: 0, boardwipe: 0, cardDraw: 0 };
  // target=1 -> tolerance = max(2, round(1*0.2)) = 2 -> cap = 3.

  it('is never over cap when balanced roles is off (roleTargets null)', () => {
    ROLES.Ramp1 = 'ramp';
    expect(isOverRoleCap(sc('Ramp1'), null, { ramp: 99 } as Record<RoleKey, number>)).toBe(false);
  });

  it('is never over cap for a role-null card, no matter the counts', () => {
    delete ROLES['Untagged'];
    expect(
      isOverRoleCap(sc('Untagged'), roleTargets, { ramp: 99 } as Record<RoleKey, number>)
    ).toBe(false);
  });

  it('flags over cap once current >= target + tolerance, not before', () => {
    ROLES.Ramp1 = 'ramp';
    expect(isOverRoleCap(sc('Ramp1'), roleTargets, { ramp: 2 } as Record<RoleKey, number>)).toBe(
      false
    ); // 2 < cap(3)
    expect(isOverRoleCap(sc('Ramp1'), roleTargets, { ramp: 3 } as Record<RoleKey, number>)).toBe(
      true
    ); // 3 >= cap(3)
  });

  it('bumpRoleCapCount increments the live count, and the overflow counter only when marked overflow', () => {
    ROLES.Ramp1 = 'ramp';
    const currentRoleCounts: Record<RoleKey, number> = {
      ramp: 0,
      removal: 0,
      boardwipe: 0,
      cardDraw: 0,
    };
    const overflowCounts: Partial<Record<RoleKey, number>> = {};
    bumpRoleCapCount(sc('Ramp1'), roleTargets, currentRoleCounts, overflowCounts, false);
    expect(currentRoleCounts.ramp).toBe(1);
    expect(overflowCounts.ramp).toBeUndefined();

    bumpRoleCapCount(sc('Ramp1'), roleTargets, currentRoleCounts, overflowCounts, true);
    expect(currentRoleCounts.ramp).toBe(2);
    expect(overflowCounts.ramp).toBe(1);
  });

  it('roleCapOverage reports how far over (or under) target the role currently sits', () => {
    ROLES.Ramp1 = 'ramp';
    expect(roleCapOverage(sc('Ramp1'), roleTargets, { ramp: 4 } as Record<RoleKey, number>)).toBe(
      3
    ); // 4 - 1
    expect(roleCapOverage(sc('Ramp1'), roleTargets, { ramp: 0 } as Record<RoleKey, number>)).toBe(
      -1
    ); // 0 - 1
  });
});

describe('buildRoleCapOverflowNote (E77 iter-4 round 3 — narrow escape-hatch-only wording)', () => {
  it('returns undefined when the cap was never breached', () => {
    expect(buildRoleCapOverflowNote({})).toBeUndefined();
    expect(buildRoleCapOverflowNote({ ramp: 0 })).toBeUndefined();
  });

  it('names the total and the dominant role, not per-card spam', () => {
    const note = buildRoleCapOverflowNote({ ramp: 3, cardDraw: 1 });
    expect(note).toContain('4 cards');
    expect(note).toContain('ramp');
  });

  it('uses singular phrasing for exactly one card', () => {
    const note = buildRoleCapOverflowNote({ removal: 1 });
    expect(note).toContain('1 card');
    expect(note).not.toContain('1 cards');
  });

  // Round 3: 3 independent critics flagged the round-2 copy ("N cards kept
  // over its role target") as reading like the deck's TOTAL role overshoot,
  // contradicting a larger roleExcesses total on the same report (the rest
  // comes from exempt picks — must-includes/combo floor — plus in-tolerance
  // amounts, not the hatch). The copy must scope itself to escape-hatch
  // admissions only and point at Overbuilt roles for the full accounting.
  it('scopes the claim to escape-hatch admissions, not the total role overshoot', () => {
    const note = buildRoleCapOverflowNote({ ramp: 1 });
    expect(note).not.toMatch(/kept over its role target/i);
    expect(note).toContain('pushed past its role cap');
  });

  it('points at Overbuilt roles for the full accounting instead of implying this IS the total', () => {
    const note = buildRoleCapOverflowNote({ ramp: 1 });
    expect(note).toContain('Overbuilt roles');
    expect(note).not.toMatch(/\btotal (role )?overshoot\b/i);
  });
});

describe('resolvePriceSanity (E80 — ships as the default, not opt-in)', () => {
  it('defaults ON when priceSanity is unset and budgetOption is not "expensive"', () => {
    expect(resolvePriceSanity({ priceSanity: undefined, budgetOption: 'any' })).toBe(true);
    expect(resolvePriceSanity({ priceSanity: undefined, budgetOption: 'budget' })).toBe(true);
  });

  it('defaults OFF when priceSanity is unset and the user asked for the expensive pool', () => {
    expect(resolvePriceSanity({ priceSanity: undefined, budgetOption: 'expensive' })).toBe(false);
  });

  it('an explicit true/false always wins over the budgetOption inference', () => {
    expect(resolvePriceSanity({ priceSanity: false, budgetOption: 'any' })).toBe(false);
    expect(resolvePriceSanity({ priceSanity: true, budgetOption: 'expensive' })).toBe(true);
  });
});

describe('buildPriceSanityNote (E80)', () => {
  it('returns undefined when the tie-break never decided an outcome', () => {
    expect(buildPriceSanityNote(0)).toBeUndefined();
  });

  it('names the count with plural phrasing', () => {
    const note = buildPriceSanityNote(3);
    expect(note).toBe(
      'Preferred 3 cheaper near-equivalents over premium picks — set budget preference to "expensive" to disable.'
    );
  });

  it('uses singular phrasing for exactly one decided pick', () => {
    const note = buildPriceSanityNote(1);
    expect(note).toBe(
      'Preferred 1 cheaper near-equivalent over premium picks — set budget preference to "expensive" to disable.'
    );
  });
});
