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
  dismissCrossDeckMoves([id]);
}

/** Bulk dismiss — the strip's "hide these" affordance clears the whole current
 *  batch in one write instead of N. It silences exactly these ids, never the
 *  lane itself: a later batch of suggestions still surfaces. */
export function dismissCrossDeckMoves(ids: string[]): void {
  mutateDismissedIds((set) => {
    for (const id of ids) set.add(id);
  });
}

/** Undo partner for `dismissCrossDeckMoves` — one mistap on "hide these" would
 *  otherwise bury a whole batch with no recovery path. */
export function restoreCrossDeckMoves(ids: string[]): void {
  mutateDismissedIds((set) => {
    for (const id of ids) set.delete(id);
  });
}

function mutateDismissedIds(mutate: (set: Set<string>) => void): void {
  try {
    const dismissed = loadDismissedIds();
    mutate(dismissed);
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
