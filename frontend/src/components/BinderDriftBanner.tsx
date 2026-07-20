import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useCollectionStore } from '../store/collection';
import { useSealMoment } from './shared/SealMoment';
import {
  captureBinderSnapshot,
  computeDrift,
  formatDriftReason,
  hasDrift,
  referencedLegalityFormats,
} from '../lib/binder-drift';
import {
  buildReviewQueue,
  destinationKey,
  formatDestinationLabel,
  formatExcludeDestination,
  formatSourceLabel,
  sourceKey,
  type AddedGroup,
  type RemovedGroup,
  type ReviewQueueRow,
} from '../lib/binder-review-queue';
import type { MaterializedBinder } from '../types';
import { InfoTip } from './InfoTip';
import { formatRelativeTime } from '../lib/format-time';
import { toast } from '../store/toasts';

/** Binder ids whose drift-cleared moment already played this app-open —
 *  mirrors `celebratedDeckComplete` in DeckDisplay.tsx's module-level-Set
 *  pattern, so drift reappearing and re-clearing in the same session (a
 *  price refresh, a second import) doesn't replay the seal. */
const celebratedBinderCleared = new Set<string>();

const DRIFT_TIP = (
  <>
    <p className="info-tip-lead">
      <strong>Drift</strong> tracks cards moving between binders since you last physically reviewed
      this one — rules read live card data (prices, EDHREC rank, format legality), so filing changes
      on its own.
    </p>
    <ul className="info-tip-list">
      <li>
        <strong>Incoming (binder → here):</strong> cards that now file to this binder. The left side
        of each group is where the cardboard sits now, so you know which binder to pull it from.{' '}
        <strong>Added it</strong> means you've physically slotted the card in;{' '}
        <strong>Don't add</strong> excludes it (it re-files to wherever it would land next).
      </li>
      <li>
        <strong>Outgoing (here → binder):</strong> cards that no longer file here, grouped by where
        they're headed. <strong>Moved it</strong> means you've physically re-filed the card;{' '}
        <strong>Keep it here</strong> pins it back into this binder.
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
 * as an actionable queue — mirrors physically re-filing cards. Every group
 * header is a route anchored on this binder (`source → here` incoming,
 * `here → destination` outgoing). Hidden entirely when membership matches
 * the baseline (no drift to surface).
 *
 * Baseline capture is automatic — the first time a binder is viewed without
 * a snapshot AND it has cards, we silently stamp the current membership as
 * the baseline. Rationale: at creation time the binder's intentional
 * contents *are* the baseline by definition, so prompting the user to
 * "Mark reviewed" is noise. Legacy binders predating snapshots get the same
 * one-time silent capture on first view.
 *
 * After that, "Mark reviewed" re-stamps the whole binder; the per-row
 * actions (Added it / Moved it / Keep it here / Don't add) surgically resolve one card at a
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

  // Queue-cleared beat: when the user resolves the last review item (or hits
  // Mark reviewed), acknowledge the effort with one transient "caught up" row
  // + the seal moment instead of the banner silently vanishing. Watched in a
  // layout effect so the swap paints in the same frame as the queue's removal.
  const [justCleared, setJustCleared] = useState(false);
  const clearedTimer = useRef<number | undefined>(undefined);
  const prevHadDrift = useRef(false);
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  const binderId = binder.def.id;
  useLayoutEffect(() => {
    const has = !drift.neverReviewed && hasDrift(drift);
    if (prevHadDrift.current && !has) {
      setJustCleared(true);
      if (!celebratedBinderCleared.has(binderId)) {
        celebratedBinderCleared.add(binderId);
        fireSealMoment();
      }
      window.clearTimeout(clearedTimer.current);
      clearedTimer.current = window.setTimeout(() => setJustCleared(false), 2600);
    }
    prevHadDrift.current = has;
  }, [drift, fireSealMoment, binderId]);
  useEffect(() => () => window.clearTimeout(clearedTimer.current), []);

  // Auto-baseline on first view. Effect deps include `binder.def.id` so
  // switching to *another* unbaselined binder triggers its own capture
  // exactly once; the snapshot field then disqualifies it from re-firing.
  useEffect(() => {
    if (drift.neverReviewed && binder.totalCards > 0) {
      markBinderReviewed(
        binder.def.id,
        captureBinderSnapshot(binder, referencedLegalityFormats(binderDefs))
      );
    }
  }, [drift.neverReviewed, binder, binderDefs, markBinderReviewed]);

  const handleMarkReviewed = () => {
    markBinderReviewed(
      binder.def.id,
      captureBinderSnapshot(binder, referencedLegalityFormats(binderDefs))
    );
    setExpanded(false);
  };

  // While the auto-snapshot effect is pending (or the binder is genuinely
  // empty), there's nothing useful to show.
  if (drift.neverReviewed) return null;

  if (!hasDrift(drift)) {
    if (!justCleared) return null;
    return (
      <div className="binder-drift binder-drift--cleared" role="status">
        {sealMoment}
        <CheckCircle2 className="binder-drift-cleared-icon" width={16} height={16} aria-hidden />
        <span>All caught up — this binder matches your last review.</span>
      </div>
    );
  }

  const colorFor = (id: string) => binderDefs.find((d) => d.id === id)?.color ?? 'var(--accent)';

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

  const handleAcknowledgeAllAdded = (rows: ReviewQueueRow[]) => {
    for (const row of rows) {
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
          {queue.addedGroups.map((group) => (
            <AddedGroupBlock
              key={sourceKey(group.source)}
              group={group}
              colorFor={colorFor}
              onAcknowledgeOne={handleAcknowledgeAdded}
              onAcknowledgeAll={handleAcknowledgeAllAdded}
              onDontAdd={handleDontAdd}
            />
          ))}
          {queue.removedGroups.map((group) => (
            <RemovedGroupBlock
              key={destinationKey(group.destination)}
              group={group}
              colorFor={colorFor}
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

/**
 * A group header's route: the varying endpoint as a binder-identity chip
 * (color dot + name — the binder-picker pattern) or a hollow-dot
 * Uncategorized chip, with the viewed binder as the plain word "here"
 * ("Keep it here" already establishes that vocabulary on this surface).
 */
function RouteTitle({
  direction,
  endpoint,
}: {
  direction: 'in' | 'out';
  /** The varying end of the move; null = Uncategorized (the unsorted pile). */
  endpoint: { name: string; color: string } | null;
}) {
  const chip = endpoint ? (
    <span className="binder-drift-chip">
      <span className="binder-drift-chip-dot" style={{ background: endpoint.color }} aria-hidden />
      {endpoint.name}
    </span>
  ) : (
    <span className="binder-drift-chip binder-drift-chip--none">
      <span className="binder-drift-chip-dot binder-drift-chip-dot--none" aria-hidden />
      Uncategorized
    </span>
  );
  const here = <span className="binder-drift-route-here">here</span>;
  const arrow = (
    <ArrowRight className="binder-drift-route-arrow" width={12} height={12} aria-label="to" />
  );
  return (
    <span className="binder-drift-route">
      {direction === 'in' ? (
        <>
          {chip}
          {arrow}
          {here}
        </>
      ) : (
        <>
          {here}
          {arrow}
          {chip}
        </>
      )}
    </span>
  );
}

function AddedGroupBlock({
  group,
  colorFor,
  onAcknowledgeOne,
  onAcknowledgeAll,
  onDontAdd,
}: {
  group: AddedGroup;
  colorFor: (binderId: string) => string;
  onAcknowledgeOne: (row: ReviewQueueRow) => void;
  onAcknowledgeAll: (rows: ReviewQueueRow[]) => void;
  onDontAdd: (row: ReviewQueueRow) => void;
}) {
  return (
    <div className="binder-drift-queue-group">
      <div className="binder-drift-queue-group-header">
        <span className="binder-drift-list-title binder-drift-list-title--added">
          <RouteTitle
            direction="in"
            endpoint={
              group.source.kind === 'binder'
                ? { name: group.source.binderName, color: colorFor(group.source.binderId) }
                : null
            }
          />{' '}
          ({group.rows.length})
        </span>
        {group.rows.length > 1 && (
          <button
            type="button"
            className="btn-link"
            aria-label={`Added all — ${formatSourceLabel(group.source)}`}
            onClick={() => onAcknowledgeAll(group.rows)}
          >
            Added all
          </button>
        )}
      </div>
      <ul className="binder-drift-queue-list">
        {group.rows.map((row) => (
          <QueueRow
            key={row.key}
            row={row}
            acknowledgeLabel="Added it"
            primaryLabel="Don't add"
            onPrimary={() => onDontAdd(row)}
            onAcknowledge={() => onAcknowledgeOne(row)}
          />
        ))}
      </ul>
    </div>
  );
}

function RemovedGroupBlock({
  group,
  colorFor,
  onAcknowledgeOne,
  onAcknowledgeAll,
  onKeepHere,
}: {
  group: RemovedGroup;
  colorFor: (binderId: string) => string;
  onAcknowledgeOne: (row: ReviewQueueRow) => void;
  onAcknowledgeAll: (rows: ReviewQueueRow[]) => void;
  onKeepHere: (row: ReviewQueueRow) => void;
}) {
  return (
    <div className="binder-drift-queue-group">
      <div className="binder-drift-queue-group-header">
        <span className="binder-drift-list-title binder-drift-list-title--removed">
          {group.destination.kind === 'not-owned' ? (
            'no longer owned'
          ) : (
            <RouteTitle
              direction="out"
              endpoint={
                group.destination.kind === 'binder'
                  ? {
                      name: group.destination.binderName,
                      color: colorFor(group.destination.binderId),
                    }
                  : null
              }
            />
          )}{' '}
          ({group.rows.length})
        </span>
        {group.rows.length > 1 && (
          <button
            type="button"
            className="btn-link"
            aria-label={`Moved all — ${formatDestinationLabel(group.destination)}`}
            onClick={() => onAcknowledgeAll(group.rows)}
          >
            Moved all
          </button>
        )}
      </div>
      <ul className="binder-drift-queue-list">
        {group.rows.map((row) => (
          <QueueRow
            key={row.key}
            row={row}
            acknowledgeLabel="Moved it"
            primaryLabel="Keep it here"
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
  acknowledgeLabel,
  primaryLabel,
  onPrimary,
  onAcknowledge,
}: {
  row: ReviewQueueRow;
  acknowledgeLabel: string;
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
        <button
          type="button"
          className="btn-link"
          aria-label={`${acknowledgeLabel} — ${row.name}`}
          onClick={onAcknowledge}
        >
          {acknowledgeLabel}
        </button>
        <button
          type="button"
          className="btn-link"
          aria-label={`${primaryLabel} — ${row.name}`}
          onClick={onPrimary}
        >
          {primaryLabel}
        </button>
      </span>
    </li>
  );
}

function summarize(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} in`);
  if (removed > 0) parts.push(`${removed} out`);
  return parts.join(', ');
}
