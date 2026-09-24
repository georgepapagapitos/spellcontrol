/**
 * Whether this device has been shown how the play board works. Plain
 * localStorage: a per-device convenience, not account state, and a blocked or
 * private store just shows the card again.
 */
const SEEN_KEY = 'sc-board-gestures-seen';

export function hasSeenBoardGestures(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return true;
  }
}

export function markBoardGesturesSeen(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode or blocked storage: the card shows again next time.
  }
}
