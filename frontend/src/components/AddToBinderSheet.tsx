import { useEffect, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import type { EnrichedCard } from '../types';

interface Props {
  card: EnrichedCard;
  onClose: () => void;
}

export function AddToBinderSheet({ card, onClose }: Props) {
  const binders = useCollectionStore((s) => s.binders);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const [addedTo, setAddedTo] = useState<string | null>(null);

  useLockBodyScroll();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-close after showing confirmation feedback.
  useEffect(() => {
    if (!addedTo) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [addedTo, onClose]);

  const sorted = [...binders].sort((a, b) => a.position - b.position);

  const handleAdd = (binderId: string) => {
    pinCardToBinder(binderId, card.copyId);
    setAddedTo(binderId);
  };

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
            {card.name}
            {card.foil ? <span className="card-picker-foil"> foil</span> : null}
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
              return (
                <li key={binder.id} className="add-to-binder-row">
                  <span
                    className="add-to-binder-swatch"
                    style={{ background: binder.color ?? 'var(--accent)' }}
                    aria-hidden
                  />
                  <span className="add-to-binder-name">{binder.name}</span>
                  {isAdded ? (
                    <span className="add-to-binder-added" aria-live="polite">
                      <CheckIcon /> Added
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn add-to-binder-btn"
                      onClick={() => handleAdd(binder.id)}
                      aria-label={`Add ${card.name} to ${binder.name}`}
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

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.2rem' }}
    >
      <path d="M3 8l4 4 6-6" />
    </svg>
  );
}
