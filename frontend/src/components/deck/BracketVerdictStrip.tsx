import './BracketVerdictStrip.css';
import { VerdictBadge, type VerdictTone } from './VerdictBadge';

export interface BracketVerdictStripProps {
  /** The bracket the player is aiming for (override), or null/undefined on Auto. */
  target?: 1 | 2 | 3 | 4 | 5 | null;
  /** The auto-estimated bracket, if an estimation exists. */
  detected?: number;
}

/** Compare the player's intended bracket against the auto-estimate. */
function verdictFor(
  target: number | null | undefined,
  detected: number | undefined
): { label: string; tone: VerdictTone; reason: string } {
  if (target == null) {
    return {
      label: 'Auto',
      tone: 'neutral',
      reason: 'No target set — showing the auto-estimated power level.',
    };
  }
  if (detected == null) {
    return { label: 'No estimate', tone: 'neutral', reason: 'Set a deck to estimate its bracket.' };
  }
  if (detected === target) {
    return { label: 'Aligned', tone: 'success', reason: 'The deck plays at the bracket you set.' };
  }
  if (detected > target) {
    return {
      label: 'Above target',
      tone: 'warn',
      reason: 'The deck estimates hotter than your target — consider trimming high-power cards.',
    };
  }
  return {
    label: 'Below target',
    tone: 'info',
    reason: 'The deck estimates softer than your target — room to add power.',
  };
}

/**
 * A compact `Target B3 · Detected B3 · [Verdict]` strip for the Bracket panel.
 * Target is the player's override; Detected is the auto-estimate. The verdict
 * chip reuses the shared VerdictBadge tones (aligned/above/below target).
 */
export function BracketVerdictStrip({
  target,
  detected,
}: BracketVerdictStripProps): JSX.Element | null {
  if (target == null && detected == null) return null;
  const v = verdictFor(target, detected);

  return (
    <div className="bracket-verdict-strip">
      <dl className="bracket-verdict-figures">
        <div className="bracket-verdict-figure">
          <dt>Target</dt>
          <dd>{target == null ? 'Auto' : `B${target}`}</dd>
        </div>
        <div className="bracket-verdict-figure">
          <dt>Detected</dt>
          <dd>{detected == null ? '—' : `B${detected}`}</dd>
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
