import { useCallback, type ReactNode } from 'react';
import { useEscapeKey } from '../../lib/use-escape-key';
import { useSheetExit } from '../../lib/use-sheet-exit';

interface Props {
  /** Deck-specific variant class on the sheet element (e.g. `deck-add-sheet`). */
  className?: string;
  ariaLabel: string;
  onClose: () => void;
  /**
   * Receives the animated dismiss so inner controls (close / cancel / done)
   * exit symmetrically too. Handoffs to another overlay should call their own
   * instant close instead (no point sliding a sheet out under a new modal).
   */
  children: (close: () => void) => ReactNode;
}

/**
 * Symmetric-exit wrapper for the DeckEditor card-picker overlays (test hand,
 * add-cards, the needs-a-commander interstitial). They share the global
 * `.card-picker-sheet` chrome, whose `.is-closing` rule already plays
 * `binder-sheet-slide-out` — these renders just never set it, so they
 * teleport-vanished. Routes backdrop tap / Escape / inner controls through
 * `useSheetExit` so the close slides down (mobile) and the unmount waits for
 * the animation. Desktop (≥1024px) is a centered panel with no entry
 * animation, so it closes instantly — mirroring CardPickerSheet.
 */
export function DeckPickerSheet({ className, ariaLabel, onClose, children }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  return (
    <div className="card-picker-root" role="presentation" onClick={dismiss}>
      <div
        className={`card-picker-sheet${className ? ` ${className}` : ''}${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        {children(dismiss)}
      </div>
    </div>
  );
}
