// ── Smart Trim resistance constants (priority-aware, role-aware, combo-aware) ──
// Module-scope, dependency-free constants so both deckGenerator.ts's
// computeTrimResistance AND deckGeneration/phaseLandSqueezeReconcile.ts (E88)
// can reuse the SAME calibrated tiers without a circular import between them
// (deckGenerator.ts imports every deckGeneration/phase*.ts module already;
// a phase module importing back from deckGenerator.ts would cycle).
// deckGenerator.ts re-exports these verbatim so existing consumers
// (deckGenerator.notes.test.ts) keep importing from the stable public API.
export const MUST_INCLUDE_BOOST = 10000;
export const LAND_PROTECTION_BOOST = 5000; // below must-include but above everything else
export const COMBO_TRIM_BOOST = 200;
export const ROLE_DEFICIT_TRIM_BOOST = 50;
export const ROLE_SURPLUS_TRIM_PENALTY = -30;
// Staple mana rocks (Sol Ring/Arcane Signet) are appended to the TAIL of
// categories.ramp after scored categorization (phaseStapleManaRocks.ts), so
// position-based resistance alone would make them the first ramp cut once
// ramp is in surplus — comfortably above the worst-case position penalty +
// ROLE_SURPLUS_TRIM_PENALTY, well below MUST_INCLUDE_BOOST so a user lock
// still outranks it.
export const STAPLE_PROTECTION_BOOST = 100;
// Protection/free-interaction pieces (E87-new Slice A) — same tier as staple
// rocks: categorically important, not user-locked, not combo-tied, so Smart
// Trim shouldn't be the first thing to reach for them regardless of pick
// order (the motivating loss: Heroic Intervention/Fierce Guardianship-class
// cards silently evicted by a land-count squeeze — see board E82).
export const PROTECTION_PIECE_BOOST = 100;
