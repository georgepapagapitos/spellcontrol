import { useEffect, useRef, useState } from 'react';

/**
 * What an add-cards result row says out loud when the arrow keys land on it.
 *
 * The rows are plain list items holding their own buttons (STYLE_GUIDE §
 * Accessibility), so the search input cannot point at one with
 * `aria-activedescendant`; the host announces the row through a polite live
 * region instead. A sighted user reads the row's badges before pressing Enter
 * (off-color, not legal, already in the deck), so the announcement carries the
 * same ones, in the row's own order. The badge marks itself with
 * `data-status="<spoken text>"` and {@link rowStatuses} collects them from the
 * rendered row, so the spoken status and the badge are written in one place
 * and a new badge is either marked or caught by the guard in
 * `row-announcement.test.ts`.
 */

/** The spoken status of each badge on a rendered row, in the row's own order. */
export function rowStatuses(row: Element | null): string[] {
  if (!row) return [];
  return Array.from(row.querySelectorAll<HTMLElement>('[data-status]'))
    .map((el) => el.dataset.status ?? '')
    .filter(Boolean);
}

/** The "in deck × 2" badge, spoken. */
export function inDeckStatus(count: number): string {
  return `in deck, ${count} ${count === 1 ? 'copy' : 'copies'}`;
}

interface RowAnnouncement {
  name: string;
  statuses: string[];
  /** Zero-based index of the row. */
  index: number;
  total: number;
  /** The add button is disabled: Enter would do nothing. */
  atCopyLimit?: boolean;
  /** The key press hit the end of the list and the highlight did not move. */
  edge?: 'first' | 'last';
}

/** "Solemn Offering, Off-color, Unowned, 2 of 2. Enter adds it." */
export function rowAnnouncement(a: RowAnnouncement): string {
  const head = [a.name, ...a.statuses].join(', ');
  const edge = a.edge === 'last' ? ' Last result.' : a.edge === 'first' ? ' First result.' : '';
  const tail = a.atCopyLimit ? 'At its copy limit.' : 'Enter adds it.';
  return `${head}, ${a.index + 1} of ${a.total}.${edge} ${tail}`;
}

/**
 * Wait this long between emptying a live region and refilling it. Screen
 * readers skip a string identical to the one just spoken, so a repeat is
 * announced by clearing first; a gap shorter than ~100ms is coalesced into no
 * change by some browser and screen reader pairs (Angular CDK's LiveAnnouncer
 * settled on 100ms for JAWS and NVDA, WordPress's `speak()` clears first for
 * VoiceOver). Not a spec guarantee; a real NVDA, JAWS and VoiceOver pass is
 * the check.
 */
export const REANNOUNCE_GAP_MS = 100;

/**
 * Text for a visually hidden `aria-live="polite"` node, plus the `announce`
 * that fills it. Each call replaces the one before it (only the latest
 * message is ever spoken, so a burst of arrow presses doesn't queue up), and a
 * pending refill is dropped on unmount.
 */
export function useLiveAnnouncer() {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const announce = (next: string) => {
    window.clearTimeout(timer.current);
    setMessage('');
    timer.current = window.setTimeout(() => setMessage(next), REANNOUNCE_GAP_MS);
  };
  return { message, announce };
}
