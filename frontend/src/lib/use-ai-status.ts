import { useSyncExternalStore } from 'react';
import { fetchAiStatus, setAiOptIn, type AiStatus } from './ai-review';
import { useAuth } from '../store/auth';

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
// Bumped by every reset so a fetch started for the previous identity can't
// land its answer on the new one.
let generation = 0;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function load() {
  if (inFlight) return;
  const gen = generation;
  inFlight = fetchAiStatus()
    .then((s) => {
      if (gen === generation) emit(s);
    })
    .catch(() => {
      if (gen === generation) emit(null);
    })
    .finally(() => {
      if (gen === generation) inFlight = null;
    });
}

/**
 * Forget the cached status and, if anything is watching, fetch it again.
 * Availability is a property of WHO is asking — the backend answers 404 to
 * a guest or to an account the feature isn't open to, and a real status to
 * an account it is — so a snapshot taken before a sign-in or sign-out is
 * about someone else. Without this, a guest who signed in kept every AI
 * door hidden until a hard reload, and someone who signed out kept doors
 * that answered 401.
 */
export function resetAiStatus(): void {
  generation += 1;
  inFlight = null;
  emit(undefined);
  if (listeners.size > 0) load();
}

/** `authed:<id>` / `guest`; undefined while bootstrap hasn't decided yet. */
function identityOf(state: { status: string; user: { id: string } | null }): string | undefined {
  if (state.status === 'authed') return `authed:${state.user?.id ?? ''}`;
  if (state.status === 'guest') return 'guest';
  return undefined;
}

// A status fetched during bootstrap already carried the session cookie, so
// the first resolution (undefined → something) needs no refetch; only a
// change between two decided identities does. Guarded because several page
// tests replace the auth store with a bare function.
if (typeof useAuth.subscribe === 'function') {
  let identity = identityOf(useAuth.getState());
  useAuth.subscribe((state) => {
    const next = identityOf(state);
    if (next === undefined || next === identity) return;
    const wasDecided = identity !== undefined;
    identity = next;
    if (wasDecided) resetAiStatus();
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
  generation += 1;
  snapshot = undefined;
  inFlight = null;
}
