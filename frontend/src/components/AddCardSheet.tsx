import { useEffect } from 'react';
import { AddCardSearchPanel } from './AddCardSearchPanel';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';

interface Props {
  /** When provided, the card is also pinned to this binder after being added to the collection. */
  binderId?: string;
  binderName?: string;
  onClose: () => void;
}

/**
 * Bottom-sheet wrapper around {@link AddCardSearchPanel} for the
 * binder-pin variant. CollectionPage uses the unified
 * {@link AddCardsSheet} instead; this exists for `BinderPage`'s
 * "add card to this binder" flow, which is intentionally lightweight
 * (one card at a time, no paste/upload/scan).
 */
export function AddCardSheet({ binderId, binderName, onClose }: Props) {
  useLockBodyScroll();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = binderId ? `Add card to ${binderName ?? 'binder'}` : 'Add card to collection';

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
        className="card-picker-sheet add-card-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">{title}</h2>
          {binderId && (
            <p className="add-card-sheet-hint">
              Cards are added to your collection and pinned to this binder.
            </p>
          )}
        </div>

        <AddCardSearchPanel binderId={binderId} onEscape={onClose} />

        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
