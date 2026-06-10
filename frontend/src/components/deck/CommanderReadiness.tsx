import './CommanderReadiness.css';
import { Loader2 } from 'lucide-react';
import { InfoTip } from '../InfoTip';
import type { ReadinessScore } from '../../lib/commander-readiness';

/**
 * Compact readiness indicator for a result row / card:
 *   undefined  → nothing (not requested yet)
 *   'loading'  → spinner (fetch in flight)
 *   unavailable→ muted "—" (EDHREC has no staple data — NOT the same as 0% owned)
 *   available  → "{percent}%"
 *
 * Shared by CommanderSearch and CommanderResultCard. Styles live in
 * deck-builder.css (`.commander-search-item-readiness`).
 */
export function ReadinessChip({ score }: { score: ReadinessScore | 'loading' | undefined }) {
  if (score === undefined) return null;
  if (score === 'loading') {
    return (
      <span className="commander-search-item-readiness is-loading" aria-label="Loading readiness">
        <Loader2 className="commander-readiness-spin" width={11} height={11} aria-hidden />
      </span>
    );
  }
  if (!score.available) {
    return (
      <span
        className="commander-search-item-readiness is-muted"
        title="Readiness unavailable — no EDHREC staple data for this commander"
      >
        —
      </span>
    );
  }
  return (
    <span className="commander-search-item-readiness" title={score.explainerLine}>
      {score.percent}%
    </span>
  );
}

/**
 * Collection-readiness readout for a commander: an explainable bar answering
 * "how many of this commander's top staples do you already own?". Pure
 * presentation over a `ReadinessScore` (computed by `lib/commander-readiness`).
 *
 * `score === undefined` → loading skeleton (the EDHREC staple list is still
 * streaming in); `score.available === false` → unavailable note (offline / EDHREC
 * unreachable), never a misleading 0%.
 */
export function CommanderReadiness({ score }: { score: ReadinessScore | undefined }) {
  if (!score) {
    return <div className="cmdr-readiness is-loading" aria-hidden />;
  }
  if (!score.available) {
    return <p className="cmdr-readiness-unavailable">{score.explainerLine}</p>;
  }
  const extraOwned = score.ownedCount - score.ownedSamples.length;
  return (
    <div className="cmdr-readiness">
      <div className="cmdr-readiness-row">
        <span className="cmdr-readiness-eyebrow">Collection readiness</span>
        <span className="cmdr-readiness-pct">{score.percent}%</span>
      </div>
      <div className="cmdr-readiness-track" aria-hidden>
        <div className="cmdr-readiness-fill" style={{ width: `${score.percent}%` }} />
      </div>
      <p className="cmdr-readiness-explainer">
        {score.explainerLine}
        {score.ownedSamples.length > 0 && (
          <InfoTip
            label="readiness"
            text={
              <>
                <p className="info-tip-lead">Top staples you already own</p>
                <ul className="info-tip-list">
                  {score.ownedSamples.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                  {extraOwned > 0 && <li>+{extraOwned} more</li>}
                </ul>
              </>
            }
          />
        )}
      </p>
    </div>
  );
}
