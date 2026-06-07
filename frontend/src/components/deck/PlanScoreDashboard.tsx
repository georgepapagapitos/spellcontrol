import type { JSX } from 'react';
import './PlanScoreDashboard.css';
import type { PlanScore, SubScoreKey } from '@/deck-builder/services/deckBuilder/planScore';
import { HeroScore } from './HeroScore';
import { SubScoreTile } from './SubScoreTile';

/** Canonical display order for the four dimensions. */
const ORDER: SubScoreKey[] = ['strategy', 'roles', 'curve', 'cardFit'];

export interface PlanScoreDashboardProps {
  plan: PlanScore;
  /**
   * Optional deep-link handler — when provided each sub-score tile becomes a
   * button that calls this with its dimension key (e.g. to switch the editor
   * to the Mana / Improve view). Wired in a later phase; omit for a static
   * read-only dashboard.
   */
  onSelect?: (key: SubScoreKey) => void;
}

/**
 * The PlanScore overview dashboard: the hero ring (overall 0-100 + headline)
 * above a responsive grid of the four sub-score tiles. Purely presentational —
 * the score is computed upstream and kept live on the deck record.
 */
export function PlanScoreDashboard({ plan, onSelect }: PlanScoreDashboardProps): JSX.Element {
  return (
    <div className="plan-score-dashboard">
      <HeroScore plan={plan} />
      <div className="plan-score-tiles">
        {ORDER.map((key) => (
          <SubScoreTile
            key={key}
            scoreKey={key}
            score={plan.subscores[key]}
            onClick={onSelect ? () => onSelect(key) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
