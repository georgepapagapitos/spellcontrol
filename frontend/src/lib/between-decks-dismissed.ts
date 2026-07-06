/**
 * Device-local dismissal for "Between your decks" suggestions (E90). Mirrors
 * `build-report-seen.ts`'s raw-localStorage Set pattern: a suggestion is keyed
 * by a stable id (`fromDeckId:cardName:toDeckId`), dismissal is per-device (a
 * different device re-sees a dismissed move — same precedent as T21's binder
 * price-move notify), and it never rides the sync path, so one device
 * dismissing a suggestion can't silently clobber another's.
 */

const DISMISSED_KEY = 'between-decks-dismissed-ids';

export function dismissCrossDeckMove(id: string): void {
  try {
    const dismissed = loadDismissedIds();
    dismissed.add(id);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
  } catch {
    /* ignore storage failures */
  }
}

export function isCrossDeckMoveDismissed(id: string): boolean {
  return loadDismissedIds().has(id);
}

function loadDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed as string[]);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}
