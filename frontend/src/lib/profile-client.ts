import { apiUrl } from './api-base';

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
}

/** Thrown for an unknown username, a stranger viewing a hidden profile, or a
 *  real user with zero live publications — the server 404s all three
 *  identically (stealth: a stranger can't distinguish which applies). */
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
