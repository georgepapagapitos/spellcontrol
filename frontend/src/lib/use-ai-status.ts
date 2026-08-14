import { useSyncExternalStore } from 'react';
import { fetchAiStatus, setAiOptIn, type AiStatus } from './ai-review';

/**
 * One shared AI status for the whole page (T102).
 *
 * Two AI panels now sit on the Tune tab, and each fetching its own status
 * would show the user two different "N of 10 left today" numbers the moment
 * one of them spent a call. A module-level store keeps consent and the quota
 * meter in agreement, and costs one GET per page rather than one per panel.
 *
 * `undefined` = still loading, `null` = unavailable (backend key absent, or
 * signed out) which is every AI surface's cue to render nothing at all.
 */
type Snapshot = AiStatus | null | undefined;

let snapshot: Snapshot;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function load() {
  if (inFlight) return;
  inFlight = fetchAiStatus()
    .then((s) => emit(s))
    .catch(() => emit(null))
    .finally(() => {
      inFlight = null;
    });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (snapshot === undefined) load();
  return () => listeners.delete(fn);
}

/** The shared status. Panels render `null` while loading or unavailable. */
export function useAiStatus(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => undefined
  );
}

/** Count a spent generation locally so every panel's meter agrees at once. */
export function noteAiSpend(): void {
  if (snapshot) emit({ ...snapshot, used: snapshot.used + 1 });
}

/** A 429 means the server considers the day spent, whatever we counted. */
export function noteAiExhausted(): void {
  if (snapshot) emit({ ...snapshot, used: snapshot.limit });
}

/** Grant consent and publish it to every mounted AI surface. */
export async function grantAiConsent(): Promise<void> {
  const optIn = await setAiOptIn(true);
  if (snapshot) emit({ ...snapshot, optIn });
}

/** Test seam — reset the module store between cases. */
export function __resetAiStatus(): void {
  snapshot = undefined;
  inFlight = null;
}
