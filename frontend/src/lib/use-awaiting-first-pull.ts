import { useSyncExternalStore } from 'react';
import { getSyncState, hasSyncError, onSyncedChange } from './sync';
import { useAuth } from '../store/auth';

/**
 * True while a signed-in device's rows are still on their way from the first
 * pull — the window where the local store is legitimately EMPTY but the account
 * is not.
 *
 * `hydrating` (on each store) only covers *reading* IndexedDB. On a device that
 * has never cached this account there is nothing in it, so `hydrating` flips
 * false against an empty store while `pull()` is still in flight. A page that
 * renders its empty state on that signal tells the user they own nothing.
 *
 * Measured on the dev account (9 decks, 11.5k cards), cold browser context,
 * phone, local prod-like build — `.claude/tools/b5-empty-scope.mjs`:
 *
 *   /decks              blank -> SPIN -> EMPTY -> FULL   1380ms asserting "No decks yet"
 *   /decks/cube         blank -> EMPTY -> FULL           1052ms
 *   /collection/lists   blank -> EMPTY -> FULL           1049ms
 *   /collection/binders blank -> EMPTY -> FULL           1106ms
 *   /home               blank -> EMPTY -> FULL            998ms
 *   /collection         blank -> SPIN -> FULL            correct, and the model for this
 *
 * This existed five times before this hook, each spelling slightly different,
 * and three of those differences were real bugs rather than style:
 *
 *  - **`!== 'ready'`, not `=== 'syncing'`.** `startSync()` has not necessarily
 *    set `'syncing'` by first paint; the state is `'idle'` until it does, and
 *    an `=== 'syncing'` test reads that window as "settled" and shows the empty
 *    state anyway. BinderPage is the only prior copy that got this right.
 *  - **`hasSyncError()` is the bail.** A pull that fails leaves the state off
 *    `'ready'` forever, so without this the page spins instead of falling back
 *    to its empty state. BinderPage is, again, the only prior copy with it.
 *  - **It must SUBSCRIBE.** Most prior copies called `getSyncState()` during
 *    render with no subscription, so they only updated when something else
 *    happened to re-render them. `useSyncExternalStore` makes the transition
 *    out of this window actually repaint.
 *
 * Pair it with the page's own emptiness test, never on its own — a genuinely
 * empty account must still reach its empty state once sync settles:
 *
 *     const awaitingFirstPull = useAwaitingFirstPull();
 *     if (hydrating || (awaitingFirstPull && decks.length === 0)) return <Loader />;
 */
export function useAwaitingFirstPull(): boolean {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const settled = useSyncExternalStore(
    onSyncedChange,
    () => getSyncState() === 'ready' || hasSyncError(),
    // Server-render/no-store fallback: treat as settled so nothing hangs.
    () => true
  );
  return isAuthed && !settled;
}
