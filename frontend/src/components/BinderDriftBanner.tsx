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
              <span className="binder-drift-when"> ({formatRelative(drift.snapshotAt)})</span>
            )}
            : {summarize(drift.added.length, drift.removed.length)}
          </span>
        </button>
        <button type="button" className="btn-link" onClick={handleMarkReviewed}>
          Mark reviewed
        </button>
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

function formatRelative(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  if (diffMs < 0) return 'just now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}
