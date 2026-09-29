import { createPortal } from 'react-dom';
import { AddCardSearchPanel } from './AddCardSearchPanel';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';
import { Button } from '@/components/shared/Button';

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

  // Below 1024px this is a bottom sheet with a slide-up entry, so dismissal
  // plays the symmetric `binder-sheet-slide-out` before unmount. On desktop
  // it's a centered panel with `animation: none` — exits stay instant there,
  // symmetric with its entry.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    onClose,
    'binder-sheet-slide-out',
    { instantAt: '(min-width: 1024px)' }
  );

  const title = binderId ? `Add card to ${binderName ?? 'binder'}` : 'Add card to collection';

  return createPortal(
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) beginClose();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet add-card-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onAnimationEnd={onAnimationEnd}
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

        <AddCardSearchPanel binderId={binderId} onEscape={beginClose} />

        <div className="card-picker-footer">
          <Button onClick={() => beginClose()}>Done</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
