import { areFriends } from '../friends/relations';

/** Who can see a collection (board T136). */
export type CollectionVisibility = 'public' | 'friends' | 'private';

/** A valid visibility value, or null for anything else. Validates input (the
 *  PATCH body); reads of the stored column go through
 *  {@link storedCollectionVisibility}. */
export function parseCollectionVisibility(raw: unknown): CollectionVisibility | null {
  return raw === 'public' || raw === 'friends' || raw === 'private' ? raw : null;
}

/**
 * `users.collection_visibility` as it applies. NULL is an account from before
 * T136 that never chose, and it reads as friends-only (user ruling
 * 2026-09-29): a friend sees the whole collection unless the owner makes it
 * Private, the same as any account that picked Friends. Until then those
 * friends saw which cards, never quantities or prices; the owner's Collection
 * tab and settings dialog now show Friends as the setting in force.
 */
export function storedCollectionVisibility(raw: unknown): CollectionVisibility {
  return parseCollectionVisibility(raw) ?? 'friends';
}

/**
 * May `viewerId` see the FULL collection (quantities, printings, prices) on
 * the owner's profile? The owner always; anyone when public; a friend when
 * friends-only (which is also what "never chose" reads as; see
 * {@link storedCollectionVisibility}).
 */
export async function canViewFullCollection(
  ownerId: string,
  visibility: CollectionVisibility,
  viewerId: string | undefined
): Promise<boolean> {
  if (viewerId === ownerId) return true;
  if (visibility === 'public') return true;
  if (visibility === 'friends') return !!viewerId && (await areFriends(ownerId, viewerId));
  return false;
}
