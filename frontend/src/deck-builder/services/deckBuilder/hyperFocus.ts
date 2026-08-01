import type { Customization } from '@/deck-builder/types';

/**
 * Hyper Focus (Manafoundry ranked item 21) — bias the pick toward cards the
 * chosen THEME actually distinguishes, rather than the generic staples that
 * would show up under any theme for this commander.
 *
 * The signal is a diff: the theme pool against the commander's own no-theme
 * base pool. A card the theme page carries and the base page doesn't is the
 * theme's own identity; a card only the base page carries is a generic
 * goodstuff include that the theme didn't ask for.
 *
 * Ships behind `customization.hyperFocus`, default OFF — same posture as E221's
 * archetype blend. This is a composition change to shipped generation, so the
 * default must not flip until a 0-regressed `deckgen-eval-gate` panel clears.
 */

/** Theme-exclusive: the theme page carries it, the base page does not. */
export const HYPER_FOCUS_EXCLUSIVE = 1000;
/** Theme-favored: both pages carry it, but the theme plays it meaningfully more. */
export const HYPER_FOCUS_FAVORED = 500;
/** Theme-present: both pages carry it at comparable rates. */
export const HYPER_FOCUS_PRESENT = 200;
/** Base-only: a generic staple the theme page never asked for. */
export const HYPER_FOCUS_GENERIC_PENALTY = -500;

/** Inclusion-point margin before "both pages have it" counts as theme-favored.
 *  ponytail: flat margin — EDHREC inclusion is already a percentage, so a
 *  points threshold needs no normalization. */
export const HYPER_FOCUS_FAVORED_MARGIN = 5;

export function resolveHyperFocus(customization: Pick<Customization, 'hyperFocus'>): boolean {
  return customization.hyperFocus ?? false;
}

export interface HyperFocusInput {
  /** Names actually in the generation pool — the only cards a boost can matter for. */
  poolNames: Iterable<string>;
  /** name → inclusion% on the selected theme's page. */
  themeInclusion: ReadonlyMap<string, number>;
  /** name → inclusion% on the commander's own no-theme page. */
  baseInclusion: ReadonlyMap<string, number>;
}

/**
 * Additive pick-score deltas keyed by card name. Pure — the caller merges the
 * result into `staticComboBoosts`, so a card can carry a combo boost and a
 * focus boost at once.
 *
 * Cards on neither page get no entry at all (not a 0): absence of data is not
 * evidence that the theme rejected them, and an off-snapshot / owned-backfill
 * card must not be penalized for a page it was never eligible to appear on.
 */
export function computeHyperFocusBoosts({
  poolNames,
  themeInclusion,
  baseInclusion,
}: HyperFocusInput): Map<string, number> {
  const boosts = new Map<string, number>();
  for (const name of poolNames) {
    const theme = themeInclusion.get(name);
    const base = baseInclusion.get(name);
    if (theme != null && base == null) {
      boosts.set(name, HYPER_FOCUS_EXCLUSIVE);
    } else if (theme != null && base != null) {
      boosts.set(
        name,
        theme >= base + HYPER_FOCUS_FAVORED_MARGIN ? HYPER_FOCUS_FAVORED : HYPER_FOCUS_PRESENT
      );
    } else if (theme == null && base != null) {
      boosts.set(name, HYPER_FOCUS_GENERIC_PENALTY);
    }
  }
  return boosts;
}
