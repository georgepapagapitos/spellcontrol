/**
 * Tiny shared flag between store mutators and the sync layer.
 *
 * Destructive mutators (clearCards, deleteBinder, etc) call markDestructive()
 * right before/after their set(). It carries two independent signals:
 *
 *  1. immediateFlush — consumed by schedulePush() to skip the debounce so a
 *     fast reload can't lose the deletion to a still-pending timer.
 *  2. pendingDestructive — read by pushNow() to decide whether a *blank-slate*
 *     snapshot (no collection/binders/decks/games) is allowed to overwrite
 *     the server. Without an explicit user deletion, an empty local state is
 *     "I don't know yet" (failed/empty hydrate, post-signout re-login, a
 *     mid-session glitch) and MUST NOT be pushed as truth. Consumed only when
 *     a push actually succeeds, so the deletion still propagates across a 409
 *     re-base/retry.
 */

let immediateFlush = false;
let pendingDestructive = false;

export function markDestructive(): void {
  immediateFlush = true;
  pendingDestructive = true;
}

export function consumeImmediateFlush(): boolean {
  const v = immediateFlush;
  immediateFlush = false;
  return v;
}

/** Non-consuming read: is an explicit user deletion awaiting a successful push? */
export function peekDestructive(): boolean {
  return pendingDestructive;
}

/** Clear the destructive latch once the deletion has been durably accepted. */
export function consumeDestructive(): void {
  pendingDestructive = false;
}
