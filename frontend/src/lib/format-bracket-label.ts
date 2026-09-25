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
      return "Set by what's in the list.";
    case 'power':
      return 'Raised by the power signal.';
    case 'baseline':
      return 'Nothing in the list pushes it past Core.';
  }
}
