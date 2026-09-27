import { useRef } from 'react';
import { markBoardGesturesSeen } from '../../lib/board-gestures-seen';
import { useOverlayDismiss } from '../../lib/use-overlay-dismiss';

export type BoardGestureId = 'tap' | 'hold' | 'number' | 'toward' | 'away' | 'pass';

/**
 * The board's gestures, one row each: the lead words bold, then the rest.
 * One list for both places that teach them, the first-run card below and the
 * hub's Help sheet, so the two can never drift.
 */
export function boardGestures(
  vertical: boolean,
  showTurnTracker: boolean
): Array<{ id: BoardGestureId; lead: string; rest: string }> {
  return [
    {
      id: 'tap',
      lead: 'Tap',
      rest: `a seat's ${vertical ? 'bottom or top' : 'left or right'} half for −1 or +1.`,
    },
    { id: 'hold', lead: 'Hold', rest: 'for ±10, and keep holding for more.' },
    { id: 'number', lead: 'Tap the number', rest: 'to type a total.' },
    {
      id: 'toward',
      lead: 'Swipe a seat toward you',
      rest: 'for its drawer: name, counters, color, turn.',
    },
    { id: 'away', lead: 'Swipe it away from you', rest: 'for commander damage.' },
    ...(showTurnTracker
      ? [
          {
            id: 'pass' as const,
            lead: 'Pass',
            rest: 'on the clock strip moves the turn to the next seat.',
          },
        ]
      : []),
  ];
}

/**
 * How the board works, shown once per device on the first shared board (the
 * hub's Help sheet shows the same rows on demand). The seats carry no buttons
 * (the Lotus model), so the gestures have to be taught somewhere; this is
 * that somewhere.
 *
 * Screen-relative, never rotated to a seat: it is for whoever is holding the
 * device when the game starts, the same ruling as the clock and the win
 * celebration.
 */
export function BoardGestureHint({
  vertical,
  showTurnTracker,
  onClose,
}: {
  /** Tap zones are top/bottom rather than left/right. */
  vertical: boolean;
  /** The turn tracker is on, so passing the turn from the clock is worth a line. */
  showTurnTracker: boolean;
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
          {boardGestures(vertical, showTurnTracker).map((g) => (
            <li key={g.id}>
              <strong>{g.lead}</strong> {g.rest}
            </li>
          ))}
        </ul>
        <button type="button" className="board-hint-done" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}
