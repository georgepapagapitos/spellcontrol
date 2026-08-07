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
 * archetype blend.
 *
 * ── E230 DEFAULT-ON: GATED 2026-08-07 AND REJECTED. DO NOT RE-RUN. ──
 *
 * A/B on `LIVE_GEN_PANEL=popular` (8 commander×theme pairs, 515–7030 decks),
 * same hour, sequential, 8/8 decks both sides, zero fallbacks: **77 cards
 * changed across 8 of 8 decks**, and the trade runs the wrong way — added cards
 * median 15.7% EDHREC inclusion, removed cards median 28.2%; 45 of 77 removals
 * were at >=25%. Theme-core losses on the theme's own page: Edgar×Vampires shed
 * Cruel Celebrant (65%) and Elenda (63%); Yuriko×Ninjutsu shed Triton
 * Shorestalker and Mothdust Changeling (51% each — the unblockable one-drops
 * ninjutsu is played FOR); Atraxa×Planeswalkers shed Narset (59%), Ugin (52%),
 * Elspeth (51%) and Teferi (45%).
 *
 * The cause is structural, not a magnitude that needs retuning. `base == null`
 * reads as "the theme distinguishes this card", but both EDHREC pages are
 * truncated at ~200-230 entries with the base list bottoming out near 1%
 * inclusion, so absence from the base page overwhelmingly means "fell below the
 * base page's cutoff" — i.e. the theme page's own long tail. Measured live: on
 * 10/10 pairs, EVERY theme-exclusive card ranked below its own theme page's
 * top 30 by inclusion (Atraxa: 77 fringe planeswalkers, 32.9% of the pool).
 * So {@link HYPER_FOCUS_EXCLUSIVE} — the largest tier, 13x the combo boost of
 * 75 — lands precisely on the least-played cards while the theme's real staples
 * get the smallest tier. The signal is anti-correlated with what it claims to
 * measure; no reweighting of these four constants fixes the predicate.
 *
 * Unlike E228/E221 (a correct signal with too high a weight floor), this needs a
 * different predicate entirely — a relative-inclusion comparison rather than set
 * membership — before default-on is worth asking about again.
 */

/** Theme-exclusive: the theme page carries it, the base page does not.
 *  ⚠️ Measured to be dominated by base-page TRUNCATION, not theme identity —
 *  read the E230 gate note above before giving this tier any weight. */
export const HYPER_FOCUS_EXCLUSIVE = 1000;
/** Theme-favored: both pages carry it, but the theme plays it meaningfully more. */
export const HYPER_FOCUS_FAVORED = 500;
/** Theme-present: both pages carry it at comparable rates. */
export const HYPER_FOCUS_PRESENT = 200;
/** Base-only: a generic staple the theme page never asked for.
 *  ⚠️ UNREACHABLE AS WIRED — measured 0 firings across all 10 gate pairs. The
 *  only caller passes `poolNames: themeInclusion.keys()` (dataAcquisition's
 *  applyHyperFocus), so every scored name is on the theme page and the
 *  `theme == null` branch below can never be taken. The shipped mechanism is
 *  therefore purely ADDITIVE: it cannot demote a generic staple, only promote
 *  other cards past it. Kept because the function itself is correct when called
 *  with a wider pool; do not read this constant as live behaviour. */
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
