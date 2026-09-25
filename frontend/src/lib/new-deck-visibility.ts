import { useAuth } from '../store/auth';

/** What a new deck is created as (board T136 / T139). Friends is an explicit
 *  choice a create form offers — never a default. */
export type NewDeckVisibility = 'public' | 'private' | 'friends';

/**
 * The creation-time visibility stamped on a new deck when its flow offers no
 * choice of its own: public for a signed-in account, nothing for a guest.
 *
 * The server reads the stamp once, the first time it sees the deck, and makes
 * it public or private (publications/sync-hook.ts). A guest's deck carries no
 * stamp, so building signed out and then signing in never publishes anything
 * the owner didn't see go public.
 *
 * Read at the call sites, not inside `createDeck`: the decks store can't
 * import the auth store without an import cycle through sync.ts.
 */
export function defaultNewDeckVisibility(): NewDeckVisibility | undefined {
  return useAuth.getState().status === 'authed' ? 'public' : undefined;
}
