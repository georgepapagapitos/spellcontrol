import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useEscapeKey } from '../lib/use-escape-key';

interface Props {
  /** Physical copyIds to pin into the chosen binder. */
  copyIds: string[];
  onClose: () => void;
}

export function BulkMoveToBinderSheet({ copyIds, onClose }: Props) {
  const binders = useCollectionStore((s) => s.binders);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const [addedTo, setAddedTo] = useState<string | null>(null);

  useLockBodyScroll();
  useEscapeKey(onClose);

  // Auto-close after showing confirmation feedback.
  useEffect(() => {
    if (!addedTo) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [addedTo, onClose]);

  const sorted = [...binders].sort((a, b) => a.position - b.position);

  const handlePick = (binderId: string) => {
    for (const id of copyIds) pinCardToBinder(binderId, id);
    setAddedTo(binderId);
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
        aria-label="Add to binder"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="add-to-binder-label">Adding</p>
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
              const isAdded = addedTo === binder.id;
              const isManual = binder.mode === 'manual';
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
                  {isAdded ? (
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
                      Added
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn add-to-binder-btn"
                      onClick={() => handlePick(binder.id)}
                      aria-label={`Add ${count} ${count === 1 ? 'card' : 'cards'} to ${binder.name}`}
                      disabled={!!addedTo}
                    >
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="card-picker-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
