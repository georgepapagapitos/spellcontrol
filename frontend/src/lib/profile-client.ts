import { apiUrl } from './api-base';
import type { PublicCollection } from './shared-types';

export interface PublicProfileDeck {
  slug: string;
  name: string;
  format: string;
  commanderName: string | null;
  commanderImage: string | null;
  colorIdentity: string[];
  cardCount: number;
  bracket: number | null;
  viewCount: number;
  copyCount: number;
  publishedAt: number;
  updatedAt: number;
}

export interface PublicProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarCardName: string | null;
  avatarImageUrl: string | null;
  joinedAt: number;
  isOwner: boolean;
  moderationHidden: boolean;
  deckCount: number;
  decks: PublicProfileDeck[];
  /** The Collection tab (board T136). `canView` is decided per viewer on the
   *  server; `visibility` is the owner's choice (null = never chose). */
  collection?: { visibility: 'public' | 'friends' | 'private' | null; canView: boolean };
}

/** Thrown for an unknown username or a stranger viewing a moderator-hidden
 *  profile; the server 404s both identically, so a stranger can't tell which
 *  applies. Every other account resolves, public decks or not (T136). */
export class ProfileNotFoundError extends Error {
  constructor() {
    super('Profile not found.');
    this.name = 'ProfileNotFoundError';
  }
}

/**
 * The handle in the URL was released by a rename and nobody has claimed it
 * since, so the server told us where that account lives now.
 *
 * It arrives as a 404 with a pointer rather than a 3xx on purpose: `fetch`
 * follows redirects transparently, which would render the right profile under
 * the wrong address and leave a stale link in the person's history and in
 * anything they copy from the address bar.
 */
export class ProfileRenamedError extends Error {
  readonly renamedTo: string;

  constructor(renamedTo: string) {
    super(`Profile moved to @${renamedTo}.`);
    this.name = 'ProfileRenamedError';
    this.renamedTo = renamedTo;
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read a public profile (`GET /api/public/users/:username`). `credentials:
 * 'include'` so a signed-in viewer's own session cookie rides along — the
 * server needs it to compute `isOwner`/`moderationHidden`, a harmless no-op
 * for an anonymous viewer or a stranger's profile.
 */
export async function fetchPublicProfile(username: string): Promise<PublicProfile> {
  const res = await fetch(apiUrl(`/api/public/users/${encodeURIComponent(username)}`), {
    credentials: 'include',
  });
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { renamedTo?: unknown };
    if (typeof body.renamedTo === 'string' && body.renamedTo) {
      throw new ProfileRenamedError(body.renamedTo);
    }
    throw new ProfileNotFoundError();
  }
  if (!res.ok) {
    throw new Error(
      await readError(res, "Couldn't load this profile. Check the link and try again.")
    );
  }
  return (await res.json()) as PublicProfile;
}

/**
 * The full collection on a profile's Collection tab (board T136): one entry
 * per physical copy, with printing, finish and market price, the same shape
 * a collection share link serves. 404s like a missing profile when the
 * viewer may not see it.
 */
export async function fetchProfileCollection(username: string): Promise<PublicCollection> {
  const res = await fetch(apiUrl(`/api/public/users/${encodeURIComponent(username)}/collection`), {
    credentials: 'include',
  });
  if (res.status === 404) throw new ProfileNotFoundError();
  if (!res.ok) throw new Error(await readError(res, "Couldn't load this collection. Try again."));
  return (await res.json()) as PublicCollection;
}

/** Where a public or friends-only collection lives: its owner's profile. */
export function profileCollectionUrl(username: string): string {
  return `${window.location.origin}/u/${username}?tab=collection`;
}
