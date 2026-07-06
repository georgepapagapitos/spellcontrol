// Unit coverage for the two note-composition seams pulled out of
// generateDeck()'s tail (see deckGenerator.ts): landCountNote and budgetNote
// must reflect the FINAL deck (post combo-floor/fixup/coherence-repair/
// bracket-convergence), never the values known at the earlier decision point.
// These are plain pure functions precisely so that reconciliation is testable
// without standing up the full generateDeck orchestration (covered instead by
// deckGenerator.golden.test.ts / .live.test.ts, which this file doesn't touch).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Archetype } from '@/deck-builder/types';
import type {
  DetectedCombo,
  EDHRECCard,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// isOverRoleCap/bumpRoleCapCount/roleCapOverage (E77 iter-4 round 2) call
// validateCardRole directly — stub it to a simple name->role map so these
// pure-logic tests don't depend on real tagger data or oracle text.
const ROLES: Record<string, RoleKey> = {};
// computeTrimResistance (E87-new Slice A) also calls isProtectionPiece
// directly — stub it the same way (name-set membership, not real oracle
// text; the classifier's own regex is covered in tagger/client.test.ts).
const PROTECTED_NAMES = new Set<string>();
// computeTrimResistance (iter-10 Slice A) also calls isFreeInteraction —
// same stub shape.
const FREE_INTERACTION_NAMES = new Set<string>();
vi.mock('@/deck-builder/services/tagger/client', () => ({
  validateCardRole: (card: { name: string }) => ROLES[card.name] ?? null,
  isProtectionPiece: (card: { name: string }) => PROTECTED_NAMES.has(card.name),
  isFreeInteraction: (card: { name: string }) => FREE_INTERACTION_NAMES.has(card.name),
}));

import {
  buildLandCountNote,
  buildOverBudgetNote,
  buildRoleCapOverflowNote,
  buildPriceSanityNote,
  buildLandSqueezeTrimNote,
  reconcileLandSqueezeDisclosure,
  buildComboUpsideNotes,
  buildComboCompletionNote,
  resolvePriceSanity,
  isOverRoleCap,
  bumpRoleCapCount,
  roleCapOverage,
  computeTrimResistance,
  hasReusableTapAbility,
  hasExilePayoffIdentity,
  STAPLE_PROTECTION_BOOST,
  PROTECTION_PIECE_BOOST,
  FREE_INTERACTION_BOOST,
  ROLE_SURPLUS_TRIM_PENALTY,
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
  it('names the archetype when confidence is high, with no delivered clause when counts agree', () => {
    const note = buildLandCountNote({
      resolvedLandCount: 37,
      finalLandCount: 37,
      archetype: Archetype.ENCHANTRESS,
      isLowConfidence: false,
      edhrecRampCount: 10,
      finalAvgCmc: 3.2,
    });
    expect(note).toContain('for an Enchantress deck');
    expect(note).not.toContain('delivered');
  });

  it('softens the copy instead of naming a low-confidence archetype guess', () => {
    const note = buildLandCountNote({
      resolvedLandCount: 37,
      finalLandCount: 37,
      archetype: Archetype.VOLTRON, // e.g. Atraxa's mislabeled keyword-vote guess
      isLowConfidence: true,
      edhrecRampCount: 10,
      finalAvgCmc: 3.2,
    });
    expect(note).toContain("for this deck's profile");
    expect(note).not.toContain('Voltron');
  });

  it('headlines the RESOLVED tune target and discloses the delivered count when they differ', () => {
    // Kozilek shape: the tune resolved 36, but colorless-pool backfill delivered
    // 40 — printing "Auto-tuned to 40" misstates what the tune did (real
    // differ-gate trust misread). The headline must be the resolved count, the
    // delivered count disclosed alongside it.
    const note = buildLandCountNote({
      resolvedLandCount: 36,
      finalLandCount: 40,
      archetype: Archetype.GOODSTUFF,
      isLowConfidence: false,
      edhrecRampCount: 8,
      finalAvgCmc: 3.4,
    });
    expect(note).toContain('Auto-tuned to 36 lands');
    expect(note).toContain('delivered 40 after post-tune deck adjustments');
  });

  it('still reconciles curve stats to FINAL state, not auto-tune-time values', () => {
    // avg CMC must reflect the shipped deck even when composed late — only the
    // "Auto-tuned to N" headline is pinned to the tune's own resolved output.
    const note = buildLandCountNote({
      resolvedLandCount: 36,
      finalLandCount: 35, // a later phase delivered one fewer land
      archetype: Archetype.MIDRANGE,
      isLowConfidence: false,
      edhrecRampCount: 8,
      finalAvgCmc: 3.4, // final curve, not the 3.0 known at decision time
    });
    expect(note).toContain('Auto-tuned to 36 lands');
    expect(note).toContain('avg CMC 3.4');
    expect(note).toContain('delivered 35 after post-tune deck adjustments');
  });

  it('formats CMC to one decimal place', () => {
    const note = buildLandCountNote({
      resolvedLandCount: 36,
      finalLandCount: 36,
      archetype: Archetype.GOODSTUFF,
      isLowConfidence: false,
      edhrecRampCount: 9,
      finalAvgCmc: 3,
    });
    expect(note).toContain('avg CMC 3.0');
  });

  // E100: the nonbasic-budget scaling (computeEffectiveNonBasicLandCount) is
  // a silent composition change unless disclosed here — every live-differ
  // reviewer flagged the un-disclosed swap as a trust issue.
  it('discloses the nonbasic budget raise when the scaling actually fired', () => {
    const note = buildLandCountNote({
      resolvedLandCount: 43,
      finalLandCount: 43,
      archetype: Archetype.CONTROL,
      isLowConfidence: false,
      edhrecRampCount: 8,
      finalAvgCmc: 4.0,
      nonBasicLandCount: 15,
      effectiveNonBasicLandCount: 17,
    });
    expect(note).toContain('nonbasic land budget raised to 17 to match the higher land count');
  });

  it('says nothing about the nonbasic budget when the scaling never fired (values equal)', () => {
    const note = buildLandCountNote({
      resolvedLandCount: 37,
      finalLandCount: 37,
      archetype: Archetype.GOODSTUFF,
      isLowConfidence: false,
      edhrecRampCount: 10,
      finalAvgCmc: 3.2,
      nonBasicLandCount: 15,
      effectiveNonBasicLandCount: 15,
    });
    expect(note).not.toContain('nonbasic land budget');
  });

  it('says nothing about the nonbasic budget when the params are omitted (backward compatible)', () => {
    const note = buildLandCountNote({
      resolvedLandCount: 37,
      finalLandCount: 37,
      archetype: Archetype.GOODSTUFF,
      isLowConfidence: false,
      edhrecRampCount: 10,
      finalAvgCmc: 3.2,
    });
    expect(note).not.toContain('nonbasic land budget');
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

describe('buildLandSqueezeTrimNote (E88 + E82 attempt 6, E94 cause-honest rewrite)', () => {
  it('returns undefined when nothing was cut and no wildcard was kept', () => {
    expect(buildLandSqueezeTrimNote([], [], 40)).toBeUndefined();
  });

  it('land-driven only (no wildcards): plural phrasing, no per-cut count restated', () => {
    // landDriven = 2 - 0 = 2, wildcardCount = 0
    const note = buildLandSqueezeTrimNote(['Card A', 'Card B'], [], 40);
    expect(note).toBe(
      'Auto-tuning the land count to 40 took 2 spell slots — reconciled by cutting the lowest-value picks: Card A, Card B.'
    );
  });

  it('land-driven only: singular phrasing for exactly one cut card', () => {
    // landDriven = 1 - 0 = 1, wildcardCount = 0
    const note = buildLandSqueezeTrimNote(['Card A'], [], 38);
    expect(note).toBe(
      'Auto-tuning the land count to 38 took 1 spell slot — reconciled by cutting the lowest-value pick: Card A.'
    );
  });

  it('both drivers: land delta AND wildcard displacement each take their own named share', () => {
    // landDriven = 3 - 1 = 2 (land count's own share), wildcardCount = 1
    const note = buildLandSqueezeTrimNote(['Card A', 'Card B', 'Card C'], ['Card D'], 39);
    expect(note).toBe(
      'Auto-tuning the land count to 39 took 2 spell slots, and 1 stronger leftover card (Card D) claimed 1 more — reconciled by cutting the 3 lowest-value picks: Card A, Card B, Card C.'
    );
  });

  it('exactly-37 resolve (landDriven === 0): no land-count blame at all, wildcard-only wording', () => {
    // The auto-tune resolved back to the 37-land baseline — it took ZERO
    // slots of its own. landDriven = 1 - 1 = 0, so every cut is credited to
    // the wildcard scan, and the note must not mention the land count.
    const note = buildLandSqueezeTrimNote(['Card A'], ['Card B'], 37);
    expect(note).toBe(
      "1 stronger leftover card (Card B) displaced the deck's lowest-value pick: Card A."
    );
    expect(note).not.toMatch(/land count/i);
  });

  it('defensive: landDriven negative (a land-count-lowering tune) still falls back to wildcard-only wording', () => {
    // landDriven = 1 - 2 = -1 — inconsistent/negative, must not surface a
    // negative number or blame the land count.
    const note = buildLandSqueezeTrimNote(['Card A'], ['Card B', 'Card C'], 34);
    expect(note).toBe(
      "2 stronger leftover cards (Card B, Card C) displaced the deck's lowest-value pick: Card A."
    );
    expect(note).not.toMatch(/-1|land count/i);
  });

  it('wildcard-only (no cuts at all): degrades gracefully instead of naming an empty pick list', () => {
    // Only reachable post-reconcile-to-final-deck (a downstream repair
    // restored every originally-cut incumbent) — landDriven = 0 - 2 = -2,
    // wildcardCount = 2, cutNames empty.
    const note = buildLandSqueezeTrimNote([], ['Card B', 'Card C'], 34);
    expect(note).toBe(
      '2 stronger leftover cards (Card B, Card C) added, with no incumbent cut needed.'
    );
  });
});

describe('reconcileLandSqueezeDisclosure (E82 fix-round)', () => {
  // The property this exists to guarantee: every name reconcile hands to
  // buildLandSqueezeTrimNote must be on the correct side of the FINAL deck —
  // never a stale name from the reconcile phase's own intermediate
  // bookkeeping (a differ audit caught both directions: a "kept" wildcard
  // that a downstream phase later cut back out, and a "cut" incumbent that
  // came right back via a downstream repair).
  it('drops a wildcard from wildcardsKept when a downstream phase cut it back out', () => {
    const finalNames = new Set(['Incumbent A']);
    const result = reconcileLandSqueezeDisclosure(
      ['Incumbent A'], // reconcile thought it cut this, but a repair re-added it
      ['Wildcard B'], // reconcile thought it kept this, but a later phase cut it
      finalNames
    );
    expect(result.cut).toEqual([]);
    expect(result.wildcardsKept).toEqual([]);
  });

  it('mixed case: self-cancelled wildcard + genuinely kept wildcard + genuine incumbent cut all resolve correctly', () => {
    // Reconcile's own bookkeeping (as phaseLandSqueezeReconcile.ts would
    // report it): two incumbents cut, two wildcards kept.
    const reconcileCut = ['Incumbent A', 'Incumbent B'];
    const reconcileWildcardsKept = ['Wildcard C', 'Wildcard D'];
    // The FINAL deck, after every downstream phase has run: Incumbent A
    // never came back (genuine cut) — but Incumbent B was re-added by an
    // unrelated repair. Wildcard C survived to the end (genuine keep) — but
    // Wildcard D got swapped back out by a later role-cap conversion (a
    // "self-cancelled" wildcard from the final deck's point of view).
    const finalNonLandNames = new Set(['Incumbent B', 'Wildcard C', 'Some Other Card']);

    const result = reconcileLandSqueezeDisclosure(
      reconcileCut,
      reconcileWildcardsKept,
      finalNonLandNames
    );

    expect(result.cut).toEqual(['Incumbent A']);
    expect(result.wildcardsKept).toEqual(['Wildcard C']);

    // The property under test: every disclosed name is on the correct side
    // of the actual final deck — a cut name is never in the final deck, a
    // kept-wildcard name is always in the final deck.
    for (const name of result.cut) {
      expect(finalNonLandNames.has(name)).toBe(false);
    }
    for (const name of result.wildcardsKept) {
      expect(finalNonLandNames.has(name)).toBe(true);
    }
  });

  it('is a no-op when everything reconcile reported still matches the final deck', () => {
    const finalNonLandNames = new Set(['Wildcard C', 'Other Card']);
    const result = reconcileLandSqueezeDisclosure(
      ['Incumbent A'],
      ['Wildcard C'],
      finalNonLandNames
    );
    expect(result.cut).toEqual(['Incumbent A']);
    expect(result.wildcardsKept).toEqual(['Wildcard C']);
  });
});

describe('computeTrimResistance — staple-rock protection', () => {
  const roleTargets: Record<RoleKey, number> = { ramp: 10, removal: 0, boardwipe: 0, cardDraw: 0 };
  // 14 >= target(10) + 3 → role-surplus penalty applies to every ramp card here.
  const surplusRoleCounts: Record<RoleKey, number> = {
    ramp: 14,
    removal: 0,
    boardwipe: 0,
    cardDraw: 0,
  };
  const noComboCards = new Set<string>();

  it('gives a staple rock at the tail position more resistance than an unflagged card at the same position', () => {
    ROLES.Filler = 'ramp';
    ROLES.ArcaneSignet = 'ramp';
    const filler = sc('Filler');
    const staple = { ...sc('ArcaneSignet'), isStapleRock: true };

    const rFiller = computeTrimResistance(
      filler,
      20,
      21,
      'ramp',
      noComboCards,
      roleTargets,
      surplusRoleCounts
    );
    const rStaple = computeTrimResistance(
      staple,
      20,
      21,
      'ramp',
      noComboCards,
      roleTargets,
      surplusRoleCounts
    );
    expect(rStaple - rFiller).toBe(STAPLE_PROTECTION_BOOST);
  });

  it('lets the staple rock survive a trim where, unflagged, it would have been first cut — cut COUNT unchanged', () => {
    ROLES.A = ROLES.B = ROLES.C = ROLES.D = ROLES.ArcaneSignet = 'ramp';
    const cards = [
      sc('A'),
      sc('B'),
      sc('C'),
      sc('D'),
      { ...sc('ArcaneSignet'), isStapleRock: true },
    ];

    const ranked = cards
      .map((card, i) => ({
        card,
        r: computeTrimResistance(
          card,
          i,
          cards.length,
          'ramp',
          noComboCards,
          roleTargets,
          surplusRoleCounts
        ),
      }))
      .sort((a, b) => a.r - b.r);

    const excess = 1;
    const toRemove = ranked.slice(0, excess);
    expect(toRemove.length).toBe(excess); // Smart Trim still cuts exactly `excess`
    expect(toRemove.map((x) => x.card.name)).not.toContain('ArcaneSignet');
    expect(toRemove[0].card.name).toBe('D'); // now-lowest position takes the cut instead
  });

  it('gives a protection-class card at the tail position more resistance than a same-position filler (E87-new Slice A)', () => {
    ROLES.Filler2 = 'ramp';
    ROLES.HeroicIntervention = 'ramp'; // role identity is irrelevant here — only the boost is under test
    PROTECTED_NAMES.add('HeroicIntervention');
    try {
      const filler = sc('Filler2');
      const protection = sc('HeroicIntervention');

      const rFiller = computeTrimResistance(
        filler,
        20,
        21,
        'ramp',
        noComboCards,
        roleTargets,
        surplusRoleCounts
      );
      const rProtection = computeTrimResistance(
        protection,
        20,
        21,
        'ramp',
        noComboCards,
        roleTargets,
        surplusRoleCounts
      );
      expect(rProtection - rFiller).toBe(PROTECTION_PIECE_BOOST);
    } finally {
      PROTECTED_NAMES.delete('HeroicIntervention');
    }
  });

  it('leaves a non-protection card unaffected by PROTECTION_PIECE_BOOST', () => {
    ROLES.PlainCard = 'ramp';
    const plain = sc('PlainCard');
    const r = computeTrimResistance(
      plain,
      20,
      21,
      'ramp',
      noComboCards,
      roleTargets,
      surplusRoleCounts
    );
    // Base resistance only: position (21-20=1) + role-surplus penalty, no protection boost.
    expect(r).toBe(21 - 20 + ROLE_SURPLUS_TRIM_PENALTY);
  });

  it('gives a free-interaction-class card at the tail position more resistance than a same-position filler (iter-10 Slice A)', () => {
    ROLES.Filler3 = 'ramp';
    ROLES.Commandeer = 'ramp'; // role identity is irrelevant here — only the boost is under test
    FREE_INTERACTION_NAMES.add('Commandeer');
    try {
      const filler = sc('Filler3');
      const freeInteraction = sc('Commandeer');

      const rFiller = computeTrimResistance(
        filler,
        20,
        21,
        'ramp',
        noComboCards,
        roleTargets,
        surplusRoleCounts
      );
      const rFreeInteraction = computeTrimResistance(
        freeInteraction,
        20,
        21,
        'ramp',
        noComboCards,
        roleTargets,
        surplusRoleCounts
      );
      expect(rFreeInteraction - rFiller).toBe(FREE_INTERACTION_BOOST);
    } finally {
      FREE_INTERACTION_NAMES.delete('Commandeer');
    }
  });
});

describe('buildComboUpsideNotes (combo-upside price disclosure — post-hoc scan)', () => {
  // Post-hoc replacement for a comparator-collector version that proved
  // structurally dead: a live Kozilek run showed Array.sort()'s O(n log n)
  // comparisons never actually compare a deep-pool combo piece against the
  // pool's real cheap staple, so the collector stayed empty all generation.
  // This scans the FINAL deck + EDHREC pool directly instead of relying on
  // which pairs a sort happened to compare.
  function priced(name: string, usd: string): ScryfallCard {
    return { ...sc(name), prices: { usd } };
  }

  function edhrecCard(name: string, inclusion: number): EDHRECCard {
    return {
      name,
      sanitized: name.toLowerCase(),
      primary_type: 'Artifact',
      inclusion,
      num_decks: 100,
    };
  }

  function edhrecData(nonLand: EDHRECCard[]): EDHRECCommanderData {
    return {
      themes: [],
      stats: {
        avgPrice: 0,
        numDecks: 0,
        deckSize: 99,
        manaCurve: {},
        typeDistribution: {
          creature: 0,
          instant: 0,
          sorcery: 0,
          artifact: 0,
          enchantment: 0,
          land: 0,
          planeswalker: 0,
          battle: 0,
        },
        landDistribution: { basic: 0, nonbasic: 0, total: 0 },
      },
      cardlists: {
        creatures: [],
        instants: [],
        sorceries: [],
        artifacts: nonLand,
        enchantments: [],
        planeswalkers: [],
        lands: [],
        allNonLand: nonLand,
      },
      similarCommanders: [],
    };
  }

  function combo(overrides: Partial<DetectedCombo> = {}): DetectedCombo {
    return {
      comboId: 'combo-1',
      cards: ['Grim Monolith', 'Rings of Brighthearth'],
      results: ['Infinite colorless mana'],
      isComplete: false,
      missingCards: ['Rings of Brighthearth'],
      deckCount: 500,
      bracket: 3,
      cardCount: 2,
      ...overrides,
    };
  }

  beforeEach(() => {
    ROLES['Grim Monolith'] = 'ramp';
    ROLES['Mind Stone'] = 'ramp';
  });

  it('fires on the Grim-shape case: expensive combo-boosted card vs a cheaper higher-inclusion same-role staple', () => {
    const grim = priced('Grim Monolith', '472.00');
    const mindStone = priced('Mind Stone', '2.00');
    const pool = edhrecData([edhrecCard('Grim Monolith', 22), edhrecCard('Mind Stone', 86)]);
    const poolCardMap = new Map([
      ['Grim Monolith', grim],
      ['Mind Stone', mindStone],
    ]);

    const notes = buildComboUpsideNotes(
      [grim],
      new Map([['Grim Monolith', 150]]),
      [combo()],
      pool,
      poolCardMap,
      'USD'
    );

    expect(notes).toEqual([
      {
        name: 'Grim Monolith',
        price: '$472',
        produces: 'Infinite colorless mana',
        missingCards: ['Rings of Brighthearth'],
        ownedPieces: 1,
        totalPieces: 2,
        comparedName: 'Mind Stone',
        comparedPrice: '$2',
      },
    ]);
  });

  it('is silent when the combo went on to complete', () => {
    const grim = priced('Grim Monolith', '472.00');
    const mindStone = priced('Mind Stone', '2.00');
    const pool = edhrecData([edhrecCard('Grim Monolith', 22), edhrecCard('Mind Stone', 86)]);
    const poolCardMap = new Map([
      ['Grim Monolith', grim],
      ['Mind Stone', mindStone],
    ]);
    const completed = combo({ isComplete: true, missingCards: [] });

    const notes = buildComboUpsideNotes(
      [grim],
      new Map([['Grim Monolith', 150]]),
      [completed],
      pool,
      poolCardMap,
      'USD'
    );
    expect(notes).toBeUndefined();
  });

  it('is silent on flat prices (goldens shape: every card priced $1)', () => {
    const grim = priced('Grim Monolith', '1.00');
    const mindStone = priced('Mind Stone', '1.00');
    const pool = edhrecData([edhrecCard('Grim Monolith', 22), edhrecCard('Mind Stone', 86)]);
    const poolCardMap = new Map([
      ['Grim Monolith', grim],
      ['Mind Stone', mindStone],
    ]);

    const notes = buildComboUpsideNotes(
      [grim],
      new Map([['Grim Monolith', 150]]),
      [combo()],
      pool,
      poolCardMap,
      'USD'
    );
    expect(notes).toBeUndefined();
  });

  it('is silent when no cheaper higher-inclusion same-role alternative exists', () => {
    const grim = priced('Grim Monolith', '472.00');
    // Only alternative is a DIFFERENT role — never a valid substitute.
    ROLES['Swords to Plowshares'] = 'removal';
    const removal = priced('Swords to Plowshares', '1.00');
    const pool = edhrecData([
      edhrecCard('Grim Monolith', 22),
      edhrecCard('Swords to Plowshares', 90),
    ]);
    const poolCardMap = new Map([
      ['Grim Monolith', grim],
      ['Swords to Plowshares', removal],
    ]);

    const notes = buildComboUpsideNotes(
      [grim],
      new Map([['Grim Monolith', 150]]),
      [combo()],
      pool,
      poolCardMap,
      'USD'
    );
    expect(notes).toBeUndefined();
  });

  it('does not disclose a card with no live combo boost, even if cheap alternatives exist', () => {
    const grim = priced('Grim Monolith', '472.00');
    const mindStone = priced('Mind Stone', '2.00');
    const pool = edhrecData([edhrecCard('Grim Monolith', 22), edhrecCard('Mind Stone', 86)]);
    const poolCardMap = new Map([
      ['Grim Monolith', grim],
      ['Mind Stone', mindStone],
    ]);

    const notes = buildComboUpsideNotes(
      [grim],
      new Map(), // no static combo boost recorded for this card
      [combo()],
      pool,
      poolCardMap,
      'USD'
    );
    expect(notes).toBeUndefined();
  });
});

describe('buildComboCompletionNote (emergent combo-completion disclosure)', () => {
  function completedCombo(overrides: Partial<DetectedCombo> = {}): DetectedCombo {
    return {
      comboId: 'combo-1',
      cards: ['Grim Monolith', 'Rings of Brighthearth'],
      results: ['Infinite colorless mana'],
      isComplete: true,
      missingCards: [],
      deckCount: 500,
      bracket: 3,
      cardCount: 2,
      ...overrides,
    };
  }

  it('returns undefined when nothing newly completed', () => {
    expect(buildComboCompletionNote([])).toBeUndefined();
  });

  it('returns one row naming the cards and result for a single newly-completed combo', () => {
    const notes = buildComboCompletionNote([completedCombo()]);
    expect(notes).toEqual([
      'Grim Monolith + Rings of Brighthearth — produces Infinite colorless mana',
    ]);
  });

  it('returns one row per combo when multiple newly completed', () => {
    const second = completedCombo({
      comboId: 'combo-2',
      cards: ['Basalt Monolith', 'Rings of Brighthearth'],
      results: ['Infinite colorless mana'],
    });
    const notes = buildComboCompletionNote([completedCombo(), second]);
    expect(notes).toEqual([
      'Grim Monolith + Rings of Brighthearth — produces Infinite colorless mana',
      'Basalt Monolith + Rings of Brighthearth — produces Infinite colorless mana',
    ]);
  });

  it('falls back to generic wording when results is empty', () => {
    const notes = buildComboCompletionNote([completedCombo({ results: [] })]);
    expect(notes).toEqual(['Grim Monolith + Rings of Brighthearth — produces a combo finish']);
  });

  it('the baseline diff excludes combos already complete at generation start', () => {
    // Mirrors the caller's diff logic in deckGenerator.ts: a combo complete
    // in the baseline snapshot (state.baselineDetectedCombos) is NOT newly
    // completed even if it's still complete in the final detectedCombos —
    // credit goes only to combos the algorithm's own picks completed.
    const baseline = [completedCombo({ comboId: 'combo-1', isComplete: true })];
    const final = [
      completedCombo({ comboId: 'combo-1', isComplete: true }), // already complete at baseline
      completedCombo({
        comboId: 'combo-2',
        cards: ['Basalt Monolith', 'Rings of Brighthearth'],
        isComplete: true,
      }), // newly completed
    ];
    const baselineCompleteIds = new Set(
      baseline.filter((dc) => dc.isComplete).map((dc) => dc.comboId)
    );
    const newlyComplete = final.filter(
      (dc) => dc.isComplete && !baselineCompleteIds.has(dc.comboId)
    );
    expect(newlyComplete.map((dc) => dc.comboId)).toEqual(['combo-2']);
    const notes = buildComboCompletionNote(newlyComplete);
    expect(notes).toEqual([
      'Basalt Monolith + Rings of Brighthearth — produces Infinite colorless mana',
    ]);
  });
});

describe('hasReusableTapAbility', () => {
  // E89 (iter-7 Slice E) — the commander-side "wants untap" signal for
  // commanders whose own text never untaps anything (Urianger Augurelt has
  // no untap wording at all; his repeatable {T} abilities are the payoff).
  it('matches a non-mana {T} activated ability (Urianger Augurelt-shaped)', () => {
    expect(
      hasReusableTapAbility({
        ...sc('Urianger Augurelt'),
        oracle_text:
          'Whenever you play a land from exile or cast a spell from exile, you gain 2 life.\nDraw Arcanum — {T}: Look at the top card of your library. You may exile it face down.\nPlay Arcanum — {T}: Until end of turn, you may play cards exiled with Urianger Augurelt. Spells you cast this way cost {2} less to cast.',
      })
    ).toBe(true);
  });

  it('matches any non-mana {T} ability, not just Urianger (Krenko, Mob Boss)', () => {
    expect(
      hasReusableTapAbility({
        ...sc('Krenko, Mob Boss'),
        oracle_text:
          '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
      })
    ).toBe(true);
  });

  it('does NOT match a bare mana ability (Sol Ring)', () => {
    expect(hasReusableTapAbility({ ...sc('Sol Ring'), oracle_text: '{T}: Add {C}{C}.' })).toBe(
      false
    );
  });

  it("does NOT match a commander with no {T} ability at all (Atraxa, Praetors' Voice)", () => {
    expect(
      hasReusableTapAbility({
        ...sc("Atraxa, Praetors' Voice"),
        oracle_text:
          'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.',
      })
    ).toBe(false);
  });

  it('returns false for a text-less card', () => {
    expect(hasReusableTapAbility(sc('No-Text Card'))).toBe(false);
  });
});

describe('hasExilePayoffIdentity', () => {
  // iter-8 Slice B — the exile-matters commander-gate signal for commanders
  // whose own text never matches isExileProducer (Urianger Augurelt's Draw/
  // Play Arcanum split never produces the "exile the top ... library" shape,
  // but his top-line ability is a genuine cast-from-exile payoff identity).
  it("matches a cast-from-exile payoff (Prosper, Tome-Bound's Pact Boon)", () => {
    expect(
      hasExilePayoffIdentity({
        ...sc('Prosper, Tome-Bound'),
        oracle_text: 'Pact Boon — Whenever you play a card from exile, create a Treasure token.',
      })
    ).toBe(true);
  });

  it("matches a cast-from-exile payoff (Urianger Augurelt's top-line text)", () => {
    expect(
      hasExilePayoffIdentity({
        ...sc('Urianger Augurelt'),
        oracle_text:
          'Whenever you play a land from exile or cast a spell from exile, you gain 2 life.\nDraw Arcanum — {T}: Look at the top card of your library. You may exile it face down.\nPlay Arcanum — {T}: Until end of turn, you may play cards exiled with Urianger Augurelt. Spells you cast this way cost {2} less to cast.',
      })
    ).toBe(true);
  });

  it('does NOT match a plain vanilla card', () => {
    expect(
      hasExilePayoffIdentity({
        ...sc('Isamaru, Hound of Konda'),
        oracle_text: '',
      })
    ).toBe(false);
  });

  it('returns false for a text-less card', () => {
    expect(hasExilePayoffIdentity(sc('No-Text Card'))).toBe(false);
  });
});
