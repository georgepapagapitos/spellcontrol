import './SubScoreTile.css';
import type { SubScore, SubScoreKey } from '@/deck-builder/services/deckBuilder/planScore';

/** Human label for each subscore key. */
const KEY_LABELS: Record<SubScoreKey, string> = {
  strategy: 'Strategy',
  roles: 'Roles',
  curve: 'Curve',
  cardFit: 'Card fit',
};

/** Band tier for a 0-100 score → drives the tile accent color class. */
function bandClass(value: number): string {
  if (value >= 75) return 'is-emerald';
  if (value >= 60) return 'is-accent';
  if (value >= 40) return 'is-amber';
  return 'is-rose';
}

export interface SubScoreTileProps {
  scoreKey: SubScoreKey;
  score: SubScore;
  /** When provided the tile renders as a button (e.g. to deep-link a tab). */
  onClick?: () => void;
}

/**
 * Compact tile for one PlanScore subscore: label, value (or em-dash when
 * partial), band label, and the one-line `surface` summary. Renders as a
 * <button> when `onClick` is given, else a static <div>. Purely presentational.
 */
export function SubScoreTile({ scoreKey, score, onClick }: SubScoreTileProps): JSX.Element {
  const { value, surface, bandLabel, partial } = score;
  const label = KEY_LABELS[scoreKey];
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const band = partial ? 'is-partial' : bandClass(clamped);
  const valueText = partial ? '—' : String(clamped);

  const className = `sub-score-tile ${band}${onClick ? ' is-interactive' : ''}`;

  const inner = (
    <>
      <div className="sub-score-tile-head">
        <span className="sub-score-tile-label">{label}</span>
        <span className="sub-score-tile-value" aria-hidden={partial ? 'true' : undefined}>
          {valueText}
        </span>
      </div>
      <span className="sub-score-tile-band">{bandLabel}</span>
      <p className="sub-score-tile-surface">{surface}</p>
    </>
  );

  const ariaLabel = partial
    ? `${label}: not yet scored, ${bandLabel}. ${surface}`
    : `${label}: ${clamped} out of 100, ${bandLabel}. ${surface}`;

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-label={ariaLabel}>
        {inner}
      </button>
    );
  }

  return (
    <div className={className} role="group" aria-label={ariaLabel}>
      {inner}
    </div>
  );
}
