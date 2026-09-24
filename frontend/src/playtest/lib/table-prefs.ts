/**
 * The table's on/off preferences. Per-device, like card size and the felt:
 * snapping is how YOU like to lay cards down, and the turn alert is for the
 * tab YOU might have in the background. Opponents see positions you publish,
 * never the grid you snapped them to.
 */

const SNAP_KEY = 'playtest-snap-v1';
const TURN_ALERT_KEY = 'playtest-turn-alert-v1';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved === '1';
  } catch {
    // Private mode / blocked site data: the default still works.
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // A remembered preference is a convenience, never a requirement.
  }
}

/** Off by default: free placement is the table you know. */
export const readSnap = (): boolean => readFlag(SNAP_KEY, false);
export const writeSnap = (on: boolean): void => writeFlag(SNAP_KEY, on);

/** On by default: missing your turn in another tab stalls the whole pod. */
export const readTurnAlert = (): boolean => readFlag(TURN_ALERT_KEY, true);
export const writeTurnAlert = (on: boolean): void => writeFlag(TURN_ALERT_KEY, on);
