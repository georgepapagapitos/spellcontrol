import { WEB_ORIGIN } from './share-client';
import { apiUrl } from './api-base';
import { isNativePlatform } from './platform';

/**
 * Owner-facing view of a deck's publish status (`w0-publish-schema-endpoints`'s
 * `deck_publications` row, via `/api/publications/decks/:deckId`).
 * `unpublishedAt` is null while the deck is live at `/d/:slug`.
 */
export interface Publication {
  slug: string;
  url: string;
  publishedAt: number;
  updatedAt: number;
  unpublishedAt: number | null;
  viewCount: number;
  copyCount: number;
}

/** Mirrors share-client.ts's readError() exactly. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Thrown by publishDeck() when the server 400s with
 *  {error:'display_name_required'} — the caller needs to set a display name
 *  (the server's own defensive gate) before a deck can go public. */
export class DisplayNameRequiredError extends Error {
  constructor() {
    super('Set a display name before publishing.');
    this.name = 'DisplayNameRequiredError';
  }
}

/** Current publish status for the caller's own deck. Always resolves —
 *  `null` means "never published (or unpublished)", not an error. */
export async function getPublication(deckId: string): Promise<Publication | null> {
  const res = await fetch(apiUrl(`/api/publications/decks/${encodeURIComponent(deckId)}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load publish status.'));
  }
  const body = (await res.json()) as { publication: Publication | null };
  return body.publication;
}

/** Publish (or refresh / republish) the caller's own deck. */
export async function publishDeck(deckId: string): Promise<Publication> {
  const res = await fetch(apiUrl(`/api/publications/decks/${encodeURIComponent(deckId)}`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const message = await readError(res, 'Failed to publish deck.');
    if (message === 'display_name_required') throw new DisplayNameRequiredError();
    throw new Error(message);
  }
  const body = (await res.json()) as { publication: Publication };
  return body.publication;
}

/** Unpublish. Silently no-ops if already unpublished (mirrors revokeShare). */
export async function unpublishDeck(deckId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/publications/decks/${encodeURIComponent(deckId)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(await readError(res, 'Failed to unpublish deck.'));
  }
}

/**
 * Build the owner-facing, *displayed* URL for a published deck. Mirrors
 * shareUrl()'s exact native-origin-pinning logic. The server's own
 * `publication.url` field always bakes in the hardcoded prod origin (correct
 * for OG meta — see shares/og.ts's ORIGIN — but wrong for a dev-mode
 * user-facing copy button), so the dialog builds its own URL here instead of
 * trusting that field.
 */
export function publicationUrl(slug: string): string {
  if (isNativePlatform()) return `${WEB_ORIGIN}/d/${slug}`;
  if (typeof window === 'undefined') return `/d/${slug}`;
  return `${window.location.origin}/d/${slug}`;
}
