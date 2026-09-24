import { useRef } from 'react';
import { markBoardGesturesSeen } from '../../lib/board-gestures-seen';
import { useOverlayDismiss } from '../../lib/use-overlay-dismiss';

/**
 * How the board works, shown once per device on the first shared board and
 * again from the game menu. The seats carry no buttons (the Lotus model), so
 * the gestures have to be taught somewhere; this is that somewhere.
 *
 * Screen-relative, never rotated to a seat: it is for whoever is holding the
 * device when the game starts, the same ruling as the clock and the win
 * celebration.
 */
export function BoardGestureHint({
  vertical,
  showClock,
  onClose,
}: {
  /** Tap zones are top/bottom rather than left/right. */
  vertical: boolean;
  /** The clock is on the board, so passing the turn there is worth a line. */
  showClock: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => {
    markBoardGesturesSeen();
    onClose();
  };
  useOverlayDismiss(close, panelRef);
  return (
    <div
      className="board-hint-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        className="board-hint"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-hint-title"
      >
        <h2 id="board-hint-title" className="board-hint-title">
          How the board works
        </h2>
        <ul className="board-hint-list">
          <li>
            <strong>Tap</strong> a seat&apos;s {vertical ? 'bottom or top' : 'left or right'} half
            for −1 or +1.
          </li>
          <li>
            <strong>Hold</strong> for ±10, and keep holding for more.
          </li>
          <li>
            <strong>Tap the number</strong> to type a total.
          </li>
          <li>
            <strong>Swipe a seat toward you</strong> for its drawer: name, counters, color, turn.
          </li>
          <li>
            <strong>Swipe it away from you</strong> for commander damage.
          </li>
          {showClock && (
            <li>
              <strong>Tap the turn on the clock</strong> to pass it.
            </li>
          )}
        </ul>
        <button type="button" className="board-hint-done" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}
