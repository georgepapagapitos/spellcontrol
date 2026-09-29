import { loadBrewerCardMap } from '../brewers/cards';

/**
 * What a friend row shows beside the name: avatar, a taste of their public
 * decks. Friends are accepted mutuals, and every field here is already on
 * their public profile, so nothing private rides along. A friend whose
 * profile a moderator hid (or who has published nothing) reads as no peek.
 */
export interface FriendPeek {
  avatarImageUrl: string | null;
  deckCount: number;
  bannerImage: string | null;
  topColors: string[];
  topCommander: string | null;
}

const EMPTY_PEEK: FriendPeek = {
  avatarImageUrl: null,
  deckCount: 0,
  bannerImage: null,
  topColors: [],
  topCommander: null,
};

/** A peek per friend id, in one round of brewer-card queries. */
export async function loadFriendPeeks(ids: string[]): Promise<Map<string, FriendPeek>> {
  const cards = await loadBrewerCardMap(ids);
  const peeks = new Map<string, FriendPeek>();
  for (const id of ids) {
    const c = cards.get(id);
    peeks.set(
      id,
      c
        ? {
            avatarImageUrl: c.avatarImageUrl,
            deckCount: c.deckCount,
            bannerImage: c.bannerImage,
            topColors: c.topColors,
            topCommander: c.topCommander,
          }
        : EMPTY_PEEK
    );
  }
  return peeks;
}
