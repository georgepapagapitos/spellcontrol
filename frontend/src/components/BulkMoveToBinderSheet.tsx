import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useEscapeKey } from '../lib/use-escape-key';

interface Props {
  /** Physical copyIds to move into the chosen binder. */
  copyIds: string[];
  /**
   * Maps each copyId to the binder it currently lives in (primary assignment),
   * mirroring the single-card move path. Copies present here are *moved* (excluded
   * /unpinned from their current binder before being pinned to the target); copies
   * absent here have no current home and are simply added.
   */
  currentBinderByCopyId?: Map<string, string>;
  onClose: () => void;
}

export function BulkMoveToBinderSheet({ copyIds, currentBinderByCopyId, onClose }: Props) {
  const binders = useCollectionStore((s) => s.binders);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const [doneTo, setDoneTo] = useState<string | null>(null);

  useLockBodyScroll();
  useEscapeKey(onClose);

  // Auto-close after showing confirmation feedback.
  useEffect(() => {
    if (!doneTo) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [doneTo, onClose]);

  const sorted = [...binders].sort((a, b) => a.position - b.position);

  // If any selected copy currently lives in a binder, this is a move (those get
  // pulled out of their current binder first); otherwise it's a plain add.
  const isMove = useMemo(
    () => copyIds.some((id) => currentBinderByCopyId?.has(id)),
    [copyIds, currentBinderByCopyId]
  );

  const handlePick = (binderId: string) => {
    for (const copyId of copyIds) {
      const currentId = currentBinderByCopyId?.get(copyId);
      // Mirror the single-card path: a true move first removes the copy from its
      // current binder. If it isn't pinned there it landed via rule routing, so
      // we exclude (true) rather than unpin (false).
      if (currentId && currentId !== binderId) {
        const current = binders.find((b) => b.id === currentId);
        const wasPinned = !!current?.pinnedCopyIds?.includes(copyId);
        removeCardFromBinder(currentId, copyId, !wasPinned);
      }
      pinCardToBinder(binderId, copyId);
    }
    setDoneTo(binderId);
  };

  const count = copyIds.length;

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={isMove ? 'Move to binder' : 'Add to binder'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="add-to-binder-label">{isMove ? 'Moving' : 'Adding'}</p>
          <p className="add-to-binder-card-name">
            {count} {count === 1 ? 'card' : 'cards'}
          </p>
        </div>

        {sorted.length === 0 ? (
          <div className="card-picker-empty" style={{ padding: '2rem 1rem' }}>
            No binders yet. Create a binder first.
          </div>
        ) : (
          <ul className="card-picker-list" role="list">
            {sorted.map((binder) => {
              const isDone = doneTo === binder.id;
              const isManual = binder.mode === 'manual';
              const actionWord = isMove ? 'Move' : 'Add';
              return (
                <li key={binder.id} className="add-to-binder-row">
                  <span
                    className="add-to-binder-swatch"
                    style={{ background: binder.color ?? 'var(--accent)' }}
                    aria-hidden
                  />
                  <span className="add-to-binder-name">
                    {binder.name}
                    {isManual && <span className="add-to-binder-mode-hint">Manual</span>}
                  </span>
                  {isDone ? (
                    <span className="add-to-binder-added" aria-live="polite">
                      <Check
                        width={12}
                        height={12}
                        strokeWidth={2}
                        aria-hidden
                        style={{
                          display: 'inline',
                          verticalAlign: 'middle',
                          marginRight: '0.2rem',
                        }}
                      />{' '}
                      {isMove ? 'Moved' : 'Added'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn add-to-binder-btn"
                      onClick={() => handlePick(binder.id)}
                      aria-label={`${actionWord} ${count} ${count === 1 ? 'card' : 'cards'} to ${binder.name}`}
                      disabled={!!doneTo}
                    >
                      {actionWord}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
