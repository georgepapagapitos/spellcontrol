import { areFriends } from '../friends/relations';

/** Who can see a collection (board T136). */
export type CollectionVisibility = 'public' | 'friends' | 'private';

/** `users.collection_visibility` as stored. NULL (and anything unknown) is
 *  "never chose": every account from before this shipped. */
export function parseCollectionVisibility(raw: unknown): CollectionVisibility | null {
  return raw === 'public' || raw === 'friends' || raw === 'private' ? raw : null;
}

/**
 * May `viewerId` see the FULL collection (quantities, printings, prices) on
 * the owner's profile? The owner always; anyone when public; a friend when
 * friends-only. "Never chose" is not a yes: those owners were promised
 * friends see which cards, never quantities or prices, and that stays true
 * until they pick something (the ambient friend view still works for them).
 */
export async function canViewFullCollection(
  ownerId: string,
  visibility: CollectionVisibility | null,
  viewerId: string | undefined
): Promise<boolean> {
  if (viewerId === ownerId) return true;
  if (visibility === 'public') return true;
  if (visibility === 'friends') return !!viewerId && (await areFriends(ownerId, viewerId));
  return false;
}
