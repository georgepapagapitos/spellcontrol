import { bracketLabel } from '@/deck-builder/services/deckBuilder/bracketEstimator';

/**
 * The one formatter for "Bracket N + tier label" text. Composed independently
 * in three places (PowerHero's hero, the Bracket panel heading, Bracket
 * Breakdown's prose) had drifted to three different punctuation conventions —
 * a mid-dot, an em-dash, and parentheses — for the identical fact (B6-10).
 * PowerHero keeps its own JSX (the bracket number animates in a separate
 * `<strong>`), but every plain-text call site routes through this.
 */
export function formatBracketLabel(bracket: number): string {
  return `Bracket ${bracket} · ${bracketLabel(bracket)}`;
}

/** The one wording of the Bracket 1 caveat, shared by the customizer's hint
 *  and the build report's aimed-vs-estimated line. */
export const EXHIBITION_BRACKET_NOTE =
  'Exhibition is a themed-build intent, not a power level. Decks aimed there estimate at Core (2) or higher.';

/**
 * One sentence naming where the estimate comes from — the Bracket panel's
 * source line, next to {@link bracketSource} (`@spellcontrol/deck-metrics`).
 * Kept here rather than inlined so the wording can't drift between the panel
 * and any future surface that shows it.
 */
export function bracketSourceSentence(source: 'contents' | 'power' | 'baseline'): string {
  switch (source) {
    case 'contents':
      return "The estimate comes from what's in the list.";
    case 'power':
      return 'The power signal raised the estimate.';
    case 'baseline':
      return 'Nothing in the list pushes the estimate past Core.';
  }
}

// ── Stated bracket + Estimate, together (2026-09-24 ruling) ────────────────
//
// Wherever a STATED bracket is shown to someone other than the owner — a
// Discover tile, a deck library, a lobby seat, someone else's deck header —
// the Estimate rides beside it whenever it differs, so a stated number can
// never hide what the deck actually estimates at. Shown only when both a
// stated bracket AND a differing estimate exist; the caller decides that
// ("only when they differ" per PowerHero's own rule) — these three just format
// the pair once each is already known to differ.

/**
 * Compact badge form: bare tier words, matching the existing `deck-format-
 * badge`/`deck-bracket-badge` convention of a tier word with no "Bracket N"
 * prefix (tight on a tile at phone width). "Core · est. Optimized".
 */
export function bracketBadgeWithEstimate(bracket: number, estimatedBracket: number): string {
  return `${bracketLabel(bracket)} · est. ${bracketLabel(estimatedBracket)}`;
}

/**
 * Running-text form, for a surface that already spells out "Bracket N" —
 * numbers, not tier words. "Bracket 2 · est. 4".
 */
export function bracketTextWithEstimate(bracket: number, estimatedBracket: number): string {
  return `Bracket ${bracket} · est. ${estimatedBracket}`;
}

/**
 * The full sentence for an accessible name — a screen reader gets both facts
 * spelled out in plain words, not the abbreviated "est." form.
 */
export function bracketAriaWithEstimate(bracket: number, estimatedBracket: number): string {
  return `Bracket ${bracket} stated, estimate ${estimatedBracket}`;
}
