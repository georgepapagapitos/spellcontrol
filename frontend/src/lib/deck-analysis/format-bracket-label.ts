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
  'Exhibition is a themed build, not a power level. Decks aimed there estimate at Core or higher.';

/**
 * One sentence naming where the estimate comes from — the Bracket panel's
 * source line, next to {@link bracketSource} (`@spellcontrol/deck-metrics`).
 * Kept here rather than inlined so the wording can't drift between the panel
 * and any future surface that shows it.
 */
export function bracketSourceSentence(source: 'contents' | 'power' | 'baseline'): string {
  switch (source) {
    case 'contents':
      return '';
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
// stated bracket AND a differing estimate exist ("only when they differ" per
// PowerHero's own rule). `bracketBadge` decides that itself; the text and aria
// forms format the pair once the caller knows the two differ.

/**
 * Compact badge form, for a deck tile: "B2 · Core", or "B2 · est. B4" when the
 * Estimate differs (the tier word gives way to the second number at phone
 * width). The number leads because a list sorted by bracket has to show the
 * thing it is sorted by; a bare "Core" read as one more tag beside the format
 * chip (2026-10-16). "B" is the short form `BracketVerdictStrip` already uses.
 */
export function bracketBadge(
  bracket: number,
  estimatedBracket?: number | null,
  floor = false
): string {
  if (estimatedBracket != null && estimatedBracket !== bracket) {
    return `B${bracket} · est. B${estimatedBracket}${floor ? '+' : ''}`;
  }
  return `B${bracket} · ${bracketLabel(bracket)}`;
}

/**
 * Running-text form, for a surface that already spells out "Bracket N" —
 * numbers, not tier words. "Bracket 2 · est. 4".
 */
export function bracketTextWithEstimate(
  bracket: number,
  estimatedBracket: number,
  floor = false
): string {
  return `Bracket ${bracket} · est. ${estimatedBracket}${floor ? '+' : ''}`;
}

/**
 * `floor` on all three: the Estimate ran before the combo match answered, so it
 * reads "est. 4+" (aria: "at least 4"), the same floor the deck page states.
 */

/**
 * The full sentence for an accessible name — a screen reader gets both facts
 * spelled out in plain words, not the abbreviated "est." form.
 */
export function bracketAriaWithEstimate(
  bracket: number,
  estimatedBracket: number,
  floor = false
): string {
  return `Bracket ${bracket} stated, estimate ${floor ? 'at least ' : ''}${estimatedBracket}`;
}

/**
 * The deck hero's bracket readout, the one place the owner's Deck tab states
 * the bracket. A stated bracket the Estimate disagrees with carries the
 * Estimate ("Bracket 2 · est. 4"); an estimate made before the combo match
 * answered is a floor ("Bracket 2+"). `aria` is set only when the short form
 * abbreviates something a screen reader should hear in full.
 */
export function heroBracketReadout(input: {
  /** The effective bracket (stated ?? estimate). */
  bracket: number;
  /** The owner's stated bracket, when there is one. */
  stated?: number | null;
  /** The computed Estimate, when there is one. */
  estimate?: number;
  /** The Estimate ran without the combo match, so it is only a floor. */
  missesCombos?: boolean;
}): { text: string; aria?: string } {
  const { bracket, stated, estimate, missesCombos } = input;
  if (stated != null && estimate !== undefined && estimate !== stated) {
    return {
      text: bracketTextWithEstimate(stated, estimate, missesCombos),
      aria: bracketAriaWithEstimate(stated, estimate, missesCombos),
    };
  }
  return { text: `Bracket ${bracket}${missesCombos && stated == null ? '+' : ''}` };
}
