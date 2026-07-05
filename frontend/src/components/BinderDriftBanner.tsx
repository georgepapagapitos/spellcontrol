import { useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import {
  captureBinderSnapshot,
  computeDrift,
  formatDriftReason,
  hasDrift,
} from '../lib/binder-drift';
import {
  buildReviewQueue,
  destinationKey,
  formatDestination,
  formatExcludeDestination,
  type RemovedGroup,
  type ReviewQueueRow,
} from '../lib/binder-review-queue';
import type { MaterializedBinder } from '../types';
import { InfoTip } from './InfoTip';
import { formatRelativeTime } from '../lib/format-time';
import { toast } from '../store/toasts';

const DRIFT_TIP = (
  <>
    <p className="info-tip-lead">
      <strong>Drift</strong> tracks what's changed in this binder since you last physically reviewed
      it.
    </p>
    <ul className="info-tip-list">
      <li>
        <strong>Newly matching:</strong> cards that now match this binder's rules but weren't here
        before. <strong>Got it</strong> accepts it into the baseline; <strong>Don't add</strong>{' '}
        excludes it (it re-files to wherever it would land next).
      </li>
      <li>
        <strong>No longer matching:</strong> cards that fell out (price changed, moved to another
        binder, etc.), grouped by where they now live. <strong>Got it</strong> accepts the removal;{' '}
        <strong>Keep here</strong> pins the card back.
      </li>
      <li>
        <strong>Mark reviewed</strong> means "I've seen everything and updated my physical binder."
        It saves a new baseline in one shot — drift is then measured from this point forward.
      </li>
    </ul>
  </>
);

interface Props {
  binder: MaterializedBinder;
}

/**
 * Shows what's changed in a binder since its review baseline was captured,
 * as an actionable queue — mirrors physically re-filing cards. Hidden
 * entirely when membership matches the baseline (no drift to surface).
 *
 * Baseline capture is automatic — the first time a binder is viewed without
 * a snapshot AND it has cards, we silently stamp the current membership as
 * the baseline. Rationale: at creation time the binder's intentional
 * contents *are* the baseline by definition, so prompting the user to
 * "Mark reviewed" is noise. Legacy binders predating snapshots get the same
 * one-time silent capture on first view.
 *
 * After that, "Mark reviewed" re-stamps the whole binder; the per-row
 * actions (Got it / Keep here / Don't add) surgically resolve one card at a
 * time without touching the rest of the baseline.
 */
export function BinderDriftBanner({ binder }: Props) {
  const allCards = useCollectionStore((s) => s.cards);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const binderDefs = useCollectionStore((s) => s.binders);
  const markBinderReviewed = useCollectionStore((s) => s.markBinderReviewed);
  const acknowledgeBinderCard = useCollectionStore((s) => s.acknowledgeBinderCard);
  const keepCardInBinder = useCollectionStore((s) => s.keepCardInBinder);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const [expanded, setExpanded] = useState(false);

  const drift = useMemo(
    () => computeDrift(binder, allCards, importHistory),
    [binder, allCards, importHistory]
  );
  const queue = useMemo(
    () => buildReviewQueue(drift, binder, allCards, binderDefs),
    [drift, binder, allCards, binderDefs]
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

  const binderId = binder.def.id;

  const handleAcknowledgeRemoved = (row: ReviewQueueRow) => {
    acknowledgeBinderCard(binderId, row.key, 'removed');
  };

  const handleAcknowledgeAllRemoved = (rows: ReviewQueueRow[]) => {
    for (const row of rows) acknowledgeBinderCard(binderId, row.key, 'removed');
  };

  const handleKeepHere = (row: ReviewQueueRow) => {
    for (const copyId of row.copyIds) keepCardInBinder(binderId, copyId);
    toast.show({
      message:
        row.copyIds.length > 1
          ? `Pinned ${row.copyIds.length} copies of ${row.name} — stay here`
          : `Pinned — ${row.name} stays here`,
      tone: 'success',
    });
  };

  const handleAcknowledgeAdded = (row: ReviewQueueRow) => {
    acknowledgeBinderCard(binderId, row.key, 'added', row.representative);
  };

  const handleAcknowledgeAllAdded = () => {
    for (const row of queue.addedRows) {
      acknowledgeBinderCard(binderId, row.key, 'added', row.representative);
    }
  };

  const handleDontAdd = (row: ReviewQueueRow) => {
    const message = row.representative
      ? formatExcludeDestination(row.representative, binderId, binderDefs)
      : 'Excluded';
    for (const copyId of row.copyIds) removeCardFromBinder(binderId, copyId, true);
    toast.show({ message, tone: 'info' });
  };

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
          {queue.addedRows.length > 0 && (
            <div className="binder-drift-queue-group">
              <div className="binder-drift-queue-group-header">
                <span className="binder-drift-list-title binder-drift-list-title--added">
                  Newly matching ({queue.addedRows.length})
                </span>
                {queue.addedRows.length > 1 && (
                  <button type="button" className="btn-link" onClick={handleAcknowledgeAllAdded}>
                    Got it — all
                  </button>
                )}
              </div>
              <ul className="binder-drift-queue-list">
                {queue.addedRows.map((row) => (
                  <QueueRow
                    key={row.key}
                    row={row}
                    primaryLabel="Don't add"
                    onPrimary={() => handleDontAdd(row)}
                    onAcknowledge={() => handleAcknowledgeAdded(row)}
                  />
                ))}
              </ul>
            </div>
          )}
          {queue.removedGroups.map((group) => (
            <RemovedGroupBlock
              key={destinationKey(group.destination)}
              group={group}
              onAcknowledgeOne={handleAcknowledgeRemoved}
              onAcknowledgeAll={handleAcknowledgeAllRemoved}
              onKeepHere={handleKeepHere}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RemovedGroupBlock({
  group,
  onAcknowledgeOne,
  onAcknowledgeAll,
  onKeepHere,
}: {
  group: RemovedGroup;
  onAcknowledgeOne: (row: ReviewQueueRow) => void;
  onAcknowledgeAll: (rows: ReviewQueueRow[]) => void;
  onKeepHere: (row: ReviewQueueRow) => void;
}) {
  return (
    <div className="binder-drift-queue-group">
      <div className="binder-drift-queue-group-header">
        <span className="binder-drift-list-title binder-drift-list-title--removed">
          {formatDestination(group.destination)} ({group.rows.length})
        </span>
        {group.rows.length > 1 && (
          <button type="button" className="btn-link" onClick={() => onAcknowledgeAll(group.rows)}>
            Got it — all
          </button>
        )}
      </div>
      <ul className="binder-drift-queue-list">
        {group.rows.map((row) => (
          <QueueRow
            key={row.key}
            row={row}
            primaryLabel="Keep here"
            onPrimary={() => onKeepHere(row)}
            onAcknowledge={() => onAcknowledgeOne(row)}
          />
        ))}
      </ul>
    </div>
  );
}

function QueueRow({
  row,
  primaryLabel,
  onPrimary,
  onAcknowledge,
}: {
  row: ReviewQueueRow;
  primaryLabel: string;
  onPrimary: () => void;
  onAcknowledge: () => void;
}) {
  const qty = row.copyIds.length;
  return (
    <li className="binder-drift-queue-row">
      <span className="binder-drift-card-name">{row.name}</span>
      {qty > 1 && (
        <span className="binder-drift-queue-qty" aria-label={`${qty} copies`}>
          ×{qty}
        </span>
      )}
      <span className="binder-drift-card-reason"> — {formatDriftReason(row.reason)}</span>
      <span className="binder-drift-queue-actions">
        <button type="button" className="btn-link" onClick={onAcknowledge}>
          Got it
        </button>
        <button type="button" className="btn-link" onClick={onPrimary}>
          {primaryLabel}
        </button>
      </span>
    </li>
  );
}

function summarize(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added} added`);
  if (removed > 0) parts.push(`−${removed} removed`);
  return parts.join(', ');
}
