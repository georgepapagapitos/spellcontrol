import { useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import {
  captureBinderSnapshot,
  computeDrift,
  formatDriftReason,
  hasDrift,
  type DriftCard,
} from '../lib/binder-drift';
import type { MaterializedBinder } from '../types';
import { InfoTip } from './InfoTip';
import { formatRelativeTime } from '../lib/format-time';

const DRIFT_TIP = (
  <>
    <p className="info-tip-lead">
      <strong>Drift</strong> tracks what's changed in this binder since you last physically reviewed
      it.
    </p>
    <ul className="info-tip-list">
      <li>
        <strong>Added:</strong> cards that now match this binder's rules but weren't here before.
      </li>
      <li>
        <strong>Removed:</strong> cards that no longer match (price changed, moved to another
        binder, etc.).
      </li>
      <li>
        <strong>Mark reviewed</strong> means "I've seen these changes and updated my physical
        binder." It saves a new baseline — drift is then measured from this point forward.
      </li>
    </ul>
  </>
);

interface Props {
  binder: MaterializedBinder;
}

/**
 * Shows what's changed in a binder since its review baseline was captured.
 * Hidden entirely when membership matches the baseline (no drift to surface).
 *
 * Baseline capture is automatic — the first time a binder is viewed without
 * a snapshot AND it has cards, we silently stamp the current membership as
 * the baseline. Rationale: at creation time the binder's intentional
 * contents *are* the baseline by definition, so prompting the user to
 * "Mark reviewed" is noise. Legacy binders predating snapshots get the same
 * one-time silent capture on first view.
 *
 * After that, the only way the snapshot updates is the explicit "Mark
 * reviewed" button — clicking it means "I've physically reviewed the binder
 * and want future drift measured from this point."
 */
export function BinderDriftBanner({ binder }: Props) {
  const allCards = useCollectionStore((s) => s.cards);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const markBinderReviewed = useCollectionStore((s) => s.markBinderReviewed);
  const [expanded, setExpanded] = useState(false);

  const drift = useMemo(
    () => computeDrift(binder, allCards, importHistory),
    [binder, allCards, importHistory]
  );

  // Auto-baseline on first view. Effect deps include `binder.def.id` so
  // switching to *another* unbaselined binder triggers its own capture
  // exactly once; the snapshot field then disqualifies it from re-firing.
  useEffect(() => {
    if (drift.neverReviewed && binder.totalCards > 0) {
      markBinderReviewed(binder.def.id, captureBinderSnapshot(binder));
    }
  }, [drift.neverReviewed, binder, markBinderReviewed]);

  const handleMarkReviewed = () => {
    markBinderReviewed(binder.def.id, captureBinderSnapshot(binder));
    setExpanded(false);
  };

  // While the auto-snapshot effect is pending (or the binder is genuinely
  // empty), there's nothing useful to show.
  if (drift.neverReviewed) return null;

  if (!hasDrift(drift)) return null;

  return (
    <div className={`binder-drift ${expanded ? '' : 'collapsed'}`}>
      <div className="binder-drift-header">
        <button
          type="button"
          className="binder-drift-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="section-chevron" aria-hidden="true">
            ▾
          </span>
          <span className="binder-drift-summary">
            <strong>Since last reviewed</strong>
            {drift.snapshotAt !== undefined && (
              <span className="binder-drift-when"> ({formatRelativeTime(drift.snapshotAt)})</span>
            )}
            : {summarize(drift.added.length, drift.removed.length)}
          </span>
        </button>
        <span className="binder-drift-reviewed-wrap">
          <button type="button" className="btn-link" onClick={handleMarkReviewed}>
            Mark reviewed
          </button>
          <InfoTip label="drift and Mark reviewed" text={DRIFT_TIP} wide />
        </span>
      </div>
      {expanded && (
        <div className="binder-drift-details">
          {drift.added.length > 0 && (
            <DriftList title="Newly matching" tone="added" cards={drift.added} />
          )}
          {drift.removed.length > 0 && (
            <DriftList title="No longer matching" tone="removed" cards={drift.removed} />
          )}
        </div>
      )}
    </div>
  );
}

function DriftList({
  title,
  tone,
  cards,
}: {
  title: string;
  tone: 'added' | 'removed';
  cards: DriftCard[];
}) {
  return (
    <div className={`binder-drift-list binder-drift-list--${tone}`}>
      <div className="binder-drift-list-title">
        {title} ({cards.length})
      </div>
      <ul>
        {cards.map((c) => (
          <li key={c.key}>
            <span className="binder-drift-card-name">{c.name}</span>
            <span className="binder-drift-card-reason"> — {formatDriftReason(c.reason)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function summarize(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added} added`);
  if (removed > 0) parts.push(`−${removed} removed`);
  return parts.join(', ');
}
