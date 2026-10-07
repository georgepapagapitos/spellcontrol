import type { JSX } from 'react';
import { ChevronRight } from 'lucide-react';
import { InfoTip } from '@/components/overlays/InfoTip';
import { Button } from '@/components/shared/Button';
import type { BracketFitPlan } from '@/deck-builder/services/deckBuilder/bracketFit';
import type { CutLane } from '@/lib/coach/coach-cut-swaps';
import { DeckAnalysisSkeleton } from './DeckAnalysisSkeleton';

/** What each budget-swap confidence badge means (budget lane only). */
export function BudgetConfidenceStrip(): JSX.Element {
  return (
    <div className="coach-feed-budget-strip">
      <span className="coach-feed-budget-summary">
        How close each cheaper pick is to the card it replaces:
      </span>
      <InfoTip
        label="budget confidence"
        text={
          <ul className="info-tip-list">
            <li>
              <strong>Drop-in</strong>: near-identical, swap freely.
            </li>
            <li>
              <strong>Sidegrade</strong>: a lateral trade, a bit less played.
            </li>
            <li>
              <strong>Budget</strong>: a real downgrade for the savings.
            </li>
          </ul>
        }
      />
    </div>
  );
}

/** The bracket-fit lane's summary line (a plan that is not already aligned). */
export function BracketFitStrip({ plan }: { plan: BracketFitPlan }): JSX.Element {
  return (
    <div className="coach-feed-bracket-strip">
      <span className="coach-feed-bracket-summary">{plan.summary}</span>
      {plan.note && <span className="coach-feed-bracket-note">{plan.note}</span>}
    </div>
  );
}

/**
 * What the Cuts lane shows besides its rows (E540 S6): the existing skeleton
 * while each cut is paired with its replacement (at most about 4 s), a note when
 * the rows are today's unpaired ones (the deck can't be scored, or the pairing
 * failed, with a retry), and the empty state when every cut had no replacement.
 */
export function CutsLaneStatus({
  lane,
  loading,
  rows,
  onRetry,
}: {
  lane: CutLane;
  loading: boolean;
  /** Rows the lane shows. */
  rows: number;
  onRetry: () => void;
}): JSX.Element | null {
  if (loading) return <DeckAnalysisSkeleton status="pending" />;
  if (lane.note && rows > 0) {
    return (
      <div className="coach-feed-collection-strip">
        <span className="coach-feed-collection-summary">
          {lane.note === 'fallback'
            ? "Coach can't judge swaps for this deck right now, so these cuts come without a replacement."
            : "Couldn't pair these cuts with replacements."}
        </span>
        {lane.note === 'error' && (
          <Button variant="link" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  if (rows === 0 && lane.withheld > 0) {
    return (
      <p className="coach-feed-empty-filter">
        Nothing to cut. No weak card here has a better one to take its place.
      </p>
    );
  }
  return null;
}

/** The one row that opens the upgrade plan (E458). */
export function UpgradePlanEntry({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <button type="button" className="upgrade-plan-entry" onClick={onOpen}>
      <span className="upgrade-plan-entry-text">
        <span className="upgrade-plan-entry-title">Upgrade plan</span>
        <span className="upgrade-plan-entry-hint">
          Spend a budget on the best swaps for this deck
        </span>
      </span>
      <ChevronRight width={18} height={18} aria-hidden />
    </button>
  );
}
