import { dayKey } from './value-history';

/**
 * Welcome-back digest data (E76, part 2): everything the daily price refresh
 * changed since the user last acknowledged the collection — the value delta
 * plus the binder auto-moves that fired as toasts and vanished (T21).
 *
 * All device-local (raw localStorage, mirroring `between-decks-dismissed.ts`
 * and T21's precedent): a different device re-sees its own digest, and none
 * of this ever rides the sync path.
 */

export interface LoggedBinderMove {
  at: number;
  cardName: string;
  /** Binder the card left, or null for the Uncategorized remainder. */
  fromBinder: string | null;
  /** Binder the card landed in, or null if it fell to Uncategorized. */
  toBinder: string | null;
}

export interface DigestBaseline {
  at: number;
  day: string;
  value: number;
}

export interface WelcomeDigest {
  /** Current value minus the baseline value (whole-dollar rounding is the caller's). */
  deltaAmount: number;
  baseline: DigestBaseline;
  /** Binder auto-moves logged after the baseline, oldest first. */
  moves: LoggedBinderMove[];
}

const MOVE_LOG_KEY = 'spellcontrol:binder-move-log';
const BASELINE_KEY = 'spellcontrol:value-digest-seen';
const SESSION_KEY = 'spellcontrol:value-digest-dismissed';

const MOVE_LOG_CAP = 100;
const MOVE_LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function getBinderMoveLog(): LoggedBinderMove[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOVE_LOG_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as LoggedBinderMove[]) : [];
  } catch {
    return [];
  }
}

/** Append a refresh run's binder moves; prunes entries older than 30 days and
 *  keeps only the newest 100 so the log can't grow unbounded. */
export function logBinderMoves(
  moves: Array<Pick<LoggedBinderMove, 'cardName' | 'fromBinder' | 'toBinder'>>,
  at = Date.now()
): void {
  if (moves.length === 0) return;
  try {
    const log = [...getBinderMoveLog(), ...moves.map((m) => ({ ...m, at }))]
      .filter((m) => at - m.at < MOVE_LOG_MAX_AGE_MS)
      .slice(-MOVE_LOG_CAP);
    localStorage.setItem(MOVE_LOG_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable — the digest just misses these moves */
  }
}

export function getDigestBaseline(): DigestBaseline | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(BASELINE_KEY) ?? 'null') as unknown;
    if (parsed && typeof parsed === 'object' && 'value' in parsed && 'at' in parsed) {
      return parsed as DigestBaseline;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Stamp "the user is caught up as of now, at this value". */
export function setDigestBaseline(value: number, at = Date.now()): void {
  try {
    localStorage.setItem(
      BASELINE_KEY,
      JSON.stringify({ at, day: dayKey(at), value } satisfies DigestBaseline)
    );
  } catch {
    /* storage unavailable */
  }
}

/** Once-per-app-open gate. sessionStorage scopes it to the app run/tab. */
export function isDigestDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markDigestDismissedThisSession(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

/**
 * Build the digest against the stored baseline, or null when there is nothing
 * to say — no baseline yet (first run; callers stamp one and stay silent), no
 * binder moves since it, and a value delta that rounds below a dollar.
 * Pure read: never stamps or clears anything.
 */
export function buildWelcomeDigest(currentValue: number): WelcomeDigest | null {
  const baseline = getDigestBaseline();
  if (!baseline) return null;
  const deltaAmount = currentValue - baseline.value;
  const moves = getBinderMoveLog().filter((m) => m.at > baseline.at);
  if (moves.length === 0 && Math.abs(Math.round(deltaAmount)) < 1) return null;
  return { deltaAmount, baseline, moves };
}
