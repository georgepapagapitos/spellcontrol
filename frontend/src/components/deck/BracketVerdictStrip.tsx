import type { JSX } from 'react';
import './BracketVerdictStrip.css';
import { VerdictBadge, type VerdictTone } from './VerdictBadge';
import { EXHIBITION_BRACKET_NOTE } from '@/lib/format-bracket-label';

export interface BracketVerdictStripProps {
  /** The deck's stated bracket (the owner's override), or null/undefined on Auto. */
  bracket?: 1 | 2 | 3 | 4 | 5 | null;
  /** The auto-estimated bracket, if an estimation exists. */
  estimate?: number;
  /**
   * The estimate was made before the combo match answered, so it is a floor:
   * combos only raise a bracket. It reads "B2+", and only a verdict the floor
   * already proves is given ("Plays above" when the floor clears the stated
   * bracket); anything else waits for combos.
   */
  estimateIsFloor?: boolean;
}

const COACH_HINT = "See the Coach tab's Bracket lane to";

/** Compare the deck's stated bracket against the auto-estimate. */
function verdictFor(
  bracket: number | null | undefined,
  estimate: number | undefined,
  estimateIsFloor = false
): { label: string; tone: VerdictTone; reason: string } {
  // Only "Plays above" survives a floor: combos can raise the estimate, never
  // lower it. For Bracket 1 a Core estimate is already the Exhibition reading,
  // so "above" starts one higher.
  const certainlyAboveFrom = bracket === 1 ? 3 : (bracket ?? 0) + 1;
  if (bracket != null && estimate != null && estimateIsFloor && estimate < certainlyAboveFrom) {
    // "Matches" or "Plays below" off a floor could flip once combos count, and
    // "Plays below" would send the owner to add power to a deck already above.
    return {
      label: 'Unconfirmed',
      tone: 'neutral',
      reason: "The estimate doesn't include combos yet, so it may be higher.",
    };
  }
  if (bracket == null) {
    return {
      label: 'Auto',
      tone: 'neutral',
      reason: 'No bracket set. Showing the estimate.',
    };
  }
  if (estimate == null) {
    return { label: 'No estimate', tone: 'neutral', reason: 'Add cards to estimate this deck.' };
  }
  // Exhibition (Bracket 1) is a theme-first build intent, not a power level the
  // estimator can confirm — it never estimates below Core (2). "Above target"
  // would misread a deck that already sits at the Core floor as needing cuts.
  if (bracket === 1) {
    if (estimate <= 2) {
      return { label: 'Exhibition', tone: 'neutral', reason: EXHIBITION_BRACKET_NOTE };
    }
    return {
      label: 'Plays above',
      tone: 'warn',
      reason: `${EXHIBITION_BRACKET_NOTE} ${COACH_HINT} bring cuts toward the Core floor.`,
    };
  }
  if (estimate === bracket) {
    return { label: 'Matches', tone: 'success', reason: 'The list plays at the bracket you set.' };
  }
  if (estimate > bracket) {
    return {
      label: 'Plays above',
      tone: 'warn',
      reason: `The list plays above the bracket you set. ${COACH_HINT} bring it down.`,
    };
  }
  return {
    label: 'Plays below',
    tone: 'info',
    reason: `The list plays below the bracket you set. ${COACH_HINT} bring it up.`,
  };
}

/**
 * A compact `Bracket B3 · Estimate B3 · [Verdict]` strip for the Bracket panel.
 * Bracket is the deck owner's stated bracket; Estimate is the auto-estimate.
 * The verdict chip reuses the shared VerdictBadge tones (matches/above/below).
 */
export function BracketVerdictStrip({
  bracket,
  estimate,
  estimateIsFloor = false,
}: BracketVerdictStripProps): JSX.Element | null {
  if (bracket == null && estimate == null) return null;
  const v = verdictFor(bracket, estimate, estimateIsFloor);

  return (
    <div className="bracket-verdict-strip">
      <dl className="bracket-verdict-figures">
        <div className="bracket-verdict-figure">
          <dt>Bracket</dt>
          <dd>{bracket == null ? 'Auto' : `B${bracket}`}</dd>
        </div>
        <div className="bracket-verdict-figure">
          <dt>Estimate</dt>
          <dd>{estimate == null ? '—' : `B${estimate}${estimateIsFloor ? '+' : ''}`}</dd>
        </div>
      </dl>
      <VerdictBadge
        tone={v.tone}
        label={v.label}
        reason={v.reason}
        className="bracket-verdict-badge"
      />
    </div>
  );
}
