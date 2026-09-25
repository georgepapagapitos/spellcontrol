import type { JSX } from 'react';
import './DeckAnalysisSkeleton.css';

export interface DeckAnalysisSkeletonProps {
  /**
   * 'pending' shows the shimmer placeholder; 'error' shows a failure message +
   * retry. 'edhrec-missing' shows the same failure shape for a PARTIAL
   * analysis — the bracket already computed fine locally, but this lane is
   * EDHREC-derived and EDHREC couldn't be reached.
   */
  status: 'pending' | 'error' | 'edhrec-missing';
  /** Retries the failed/stalled analysis. Omit to hide the retry affordance. */
  onRetry?: () => void;
}

/**
 * The Power/Tune tabs' (and CoachFeed's) shared "analysis not ready yet"
 * placeholder — shimmer bars while the first commander-deck analysis is
 * in-flight, or a plain failure message + retry once it's given up (E162).
 * Previously this shimmer block was the ONLY state these surfaces rendered:
 * a fetch failure (EDHREC unreachable, an un-indexed commander, a stalled
 * request) left it shimmering "Analyzing your deck…" forever with no signal
 * that anything had gone wrong and no way to try again.
 */
export function DeckAnalysisSkeleton({ status, onRetry }: DeckAnalysisSkeletonProps): JSX.Element {
  if (status === 'error' || status === 'edhrec-missing') {
    return (
      <div className="deck-analysis-skeleton is-error" role="status" aria-live="polite">
        <p className="deck-analysis-skeleton-eyebrow">
          {status === 'edhrec-missing' ? 'Some insight unavailable' : 'Analysis unavailable'}
        </p>
        <p className="deck-analysis-skeleton-error-text">
          {status === 'edhrec-missing'
            ? "Couldn't reach EDHREC for this. The bracket and win conditions are current; suggestions that need EDHREC aren't."
            : "Couldn't analyze this deck. EDHREC may be unreachable, or this commander isn't indexed yet."}
          {onRetry && (
            <>
              {' '}
              <button type="button" className="deck-analysis-skeleton-retry" onClick={onRetry}>
                Retry
              </button>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      className="deck-analysis-skeleton"
      role="status"
      aria-label="Analyzing your deck…"
      aria-live="polite"
    >
      <p className="deck-analysis-skeleton-eyebrow">Analyzing your deck…</p>
      <div className="deck-analysis-skeleton-bar is-headline" />
      <div className="deck-analysis-skeleton-bar is-body" />
      <div className="deck-analysis-skeleton-bar is-body is-short" />
      <div className="deck-analysis-skeleton-lane">
        <div className="deck-analysis-skeleton-bar is-body" />
        <div className="deck-analysis-skeleton-bar is-body is-short" />
      </div>
      <div className="deck-analysis-skeleton-lane">
        <div className="deck-analysis-skeleton-bar is-body" />
        <div className="deck-analysis-skeleton-bar is-body is-short" />
      </div>
    </div>
  );
}
