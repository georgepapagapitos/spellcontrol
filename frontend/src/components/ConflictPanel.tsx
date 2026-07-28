import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Modal } from './Modal';
import { useConflictsStore, type DeckConflict } from '../store/conflicts';
import { useDecksStore } from '../store/decks';
import { toast } from '../store/toasts';
import { diffDeckCards, type CardDelta } from '../lib/deck-diff';
import { DiffCardRow, type Tone } from '../pages/DeckComparePage';
import './ConflictPanel.css';

const SECTION_LABEL: Record<Tone, string> = {
  // Order matters — what the user is about to lose comes first.
  removed: 'Only in your edit (discarded)',
  added: 'Only in the kept version',
  changed: 'Quantity changed',
};
const SECTION_ORDER: Tone[] = ['removed', 'added', 'changed'];

/** One diff section, reusing DeckComparePage's row markup but with copy
 *  framed for "your edit vs. the version that was kept" instead of A-vs-B. */
function ConflictDiffSection({ tone, deltas }: { tone: Tone; deltas: CardDelta[] }) {
  if (deltas.length === 0) return null;
  return (
    <div className="deck-compare-diff-group">
      <h3 className="deck-compare-diff-group-title">
        {SECTION_LABEL[tone]} ({deltas.length})
      </h3>
      <ul className="deck-compare-diff-list" role="list">
        {deltas.map((d) => (
          <DiffCardRow key={d.card.oracle_id || d.card.name} delta={d} tone={tone} />
        ))}
      </ul>
    </div>
  );
}

function ConflictDialog({
  conflict,
  moreWaiting,
  onDismiss,
}: {
  conflict: DeckConflict;
  /** How many other conflicting decks are queued behind this one. */
  moreWaiting: number;
  onDismiss: () => void;
}) {
  const headingId = 'conflict-panel-title';
  const name = conflict.serverDeck.name || conflict.localDeck.name || 'this deck';

  // Pure + synchronous (both decks are already in memory), but defensively
  // caught: a malformed Deck slipping past sync.ts's shape check must not
  // crash an app-wide overlay that can mount on any page. The fallback still
  // offers the same Restore/Keep actions — they don't depend on the diff.
  const diff = useMemo(() => {
    try {
      return diffDeckCards(conflict.localDeck, conflict.serverDeck);
    } catch {
      return null;
    }
  }, [conflict]);
  const untouched =
    diff != null && diff.added.length + diff.removed.length + diff.changed.length === 0;

  const handleRestore = () => {
    // replaceDeck sets the deck to the captured local snapshot; the decks
    // store's sync subscriber (store/decks.ts) then persists + re-enqueues it
    // automatically, with clientRev re-derived from the IDB row applyServerRows
    // just stamped (the server's rev) — so this push targets the latest base
    // instead of the stale one that just got rejected.
    useDecksStore.getState().replaceDeck(conflict.id, conflict.localDeck);
    toast.show({ message: `Restored your changes to "${name}".`, tone: 'success' });
    onDismiss();
  };

  return (
    <Modal onClose={onDismiss} labelledBy={headingId} className="modal conflict-panel">
      <p className="conflict-panel-eyebrow">
        {moreWaiting > 0
          ? `Sync conflict — ${moreWaiting} more ${moreWaiting === 1 ? 'deck' : 'decks'} waiting`
          : 'Sync conflict'}
      </p>
      <h2 id={headingId} className="conflict-panel-title">
        &ldquo;{name}&rdquo; changed on another device
      </h2>
      <p className="conflict-panel-body">
        You edited this deck here, but another device saved a newer version first. The server&apos;s
        version is already saved — review what differs below, then keep it or restore your edits on
        top of it.
      </p>

      {diff == null ? (
        <p className="deck-compare-empty-hint">
          Couldn&apos;t compare card lists for this deck. You can still restore your full edit or
          keep the server&apos;s version.
        </p>
      ) : untouched ? (
        <p className="deck-compare-empty-hint">
          No card differences — only deck details (name, bracket, notes) changed.
        </p>
      ) : (
        <div className="conflict-panel-diff">
          <p className="deck-compare-summary">
            {diff.removed.length} only yours · {diff.added.length} only kept · {diff.changed.length}{' '}
            changed
          </p>
          {SECTION_ORDER.map((tone) => (
            <ConflictDiffSection key={tone} tone={tone} deltas={diff[tone]} />
          ))}
        </div>
      )}

      <div className="conflict-panel-actions">
        <Link to={`/decks/${conflict.id}`} className="btn conflict-panel-view" onClick={onDismiss}>
          View saved deck
        </Link>
        <button type="button" className="btn" onClick={onDismiss}>
          Keep server version
        </button>
        <button type="button" className="btn btn-primary" onClick={handleRestore} autoFocus>
          Restore my changes
        </button>
      </div>
    </Modal>
  );
}

/**
 * Root-mounted (Layout.tsx, alongside ToastViewport) global overlay for a
 * rejected deck push (E170). `applyPushResult` (lib/sync.ts) can fire from a
 * background push while the user is on any page — it isn't a React
 * component — so it pushes structured conflict data into `store/conflicts.ts`
 * instead of calling into a component directly; this always-mounted viewport
 * reads that queue and renders a Modal when it's non-empty.
 *
 * Multiple conflicting decks: a queue with a "N of M" indicator (not one
 * panel with N stacked sections) — a card-list diff can run long, and
 * stacking several decks' worth in one scrolling modal would bury the
 * decision under scroll. One deck, one focused decision at a time; dismissing
 * or restoring advances to the next.
 */
export function ConflictPanel() {
  const queueList = useConflictsStore((s) => s.queue);
  const dismiss = useConflictsStore((s) => s.dismiss);

  if (queueList.length === 0) return null;
  const current = queueList[0];

  return createPortal(
    <ConflictDialog
      key={current.id}
      conflict={current}
      moreWaiting={queueList.length - 1}
      onDismiss={() => dismiss(current.id)}
    />,
    document.body
  );
}
