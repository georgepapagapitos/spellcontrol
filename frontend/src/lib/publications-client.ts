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

/** Thrown by publishDeck() when the server 404s with {error:'Deck not
 *  found.'} for a deckId the caller just created. The local persist that
 *  writes a new deck to the server is fire-and-forget from the store's
 *  perspective (store/decks.ts's sync subscriber) — a publish attempt fired
 *  immediately after `createDeck()` can race ahead of it. Never surfaced to
 *  the user directly; `usePublishOnCreate`'s one bounded retry covers the
 *  gap instead. */
export class DeckNotSyncedYetError extends Error {
  constructor() {
    super('Deck not found.');
    this.name = 'DeckNotSyncedYetError';
  }
}

/**
 * One row of the caller's own publications list (`GET /api/publications/decks`)
 * — deliberately thinner than `Publication` (no `url`/`publishedAt`): the
 * visibility chip and the decks-index badge only need `deckId` +
 * `unpublishedAt` to tell "live" from "was public" from "never published";
 * `slug`/counts ride along for a future per-row link without another
 * round-trip.
 */
export interface OwnedPublication {
  deckId: string;
  slug: string;
  unpublishedAt: number | null;
  viewCount: number;
  copyCount: number;
}

/** All of the caller's own publications, live and unpublished alike. Always
 *  resolves to an array — empty means "never published anything". */
export async function listMyPublications(): Promise<OwnedPublication[]> {
  const res = await fetch(apiUrl('/api/publications/decks'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load your publications.'));
  }
  const body = (await res.json()) as { publications: OwnedPublication[] };
  return body.publications;
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

/** `publishDeck()`'s result, extended with a client-derived flag the wire
 *  payload itself doesn't carry (see below). */
export interface PublishResult extends Publication {
  /** True only when this call minted the `deck_publications` row for the
   *  very first time (server 201, a genuine INSERT) — false on any refresh-
   *  while-live or republish-after-unpublish (server 200, existing row
   *  updated in place; see routes/publications.ts's INSERT-vs-UPDATE
   *  branch). Derived from `res.status` since the row itself carries no such
   *  flag — the sole input to `shouldCelebrateFirstPublish`
   *  (first-publish-celebration.ts), the seal moment's dedup choke point. */
  isFirstPublish: boolean;
}

/** Publish (or refresh / republish) the caller's own deck. */
export async function publishDeck(deckId: string): Promise<PublishResult> {
  const res = await fetch(apiUrl(`/api/publications/decks/${encodeURIComponent(deckId)}`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const message = await readError(res, 'Failed to publish deck.');
    if (message === 'display_name_required') throw new DisplayNameRequiredError();
    if (res.status === 404 && message === 'Deck not found.') throw new DeckNotSyncedYetError();
    throw new Error(message);
  }
  const body = (await res.json()) as { publication: Publication };
  return { ...body.publication, isFirstPublish: res.status === 201 };
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
