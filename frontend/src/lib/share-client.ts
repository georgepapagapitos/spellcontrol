import type { PublicShareResponse, ShareAudience, ShareKind, ShareRow } from './shared-types';
import { apiUrl } from './api-base';
import { isNativePlatform } from './platform';

/** A friend's friends-visible share, with its resolved display label. */
export interface FriendShareRow {
  token: string;
  kind: ShareKind;
  resourceId: string;
  label: string;
  createdAt: number;
}

/** A share another user directed to you (your inbox). */
export interface InboxShareRow {
  token: string;
  kind: ShareKind;
  fromUsername: string;
  fromDisplayName: string | null;
  label: string;
  createdAt: number;
}

/**
 * Public origin the web app is hosted at. Used to build share links inside the
 * native app, where `window.location.origin` is the WebView origin
 * (`https://localhost`) and would produce a dead link.
 */
const WEB_ORIGIN = 'https://spellcontrol.com';

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Create (or return existing) share for the authenticated user. Omitting
 *  `audience` mints a public 'link' share (the default everywhere). */
export async function createShare(input: {
  kind: ShareKind;
  resourceId?: string;
  audience?: ShareAudience;
  /** Required when audience==='direct' — the recipient friend's user id. */
  addresseeId?: string;
}): Promise<ShareRow> {
  const res = await fetch(apiUrl('/api/shares'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to create share.'));
  }
  const body = (await res.json()) as { share: ShareRow };
  return body.share;
}

/** List the authenticated user's active shares. */
export async function listShares(): Promise<ShareRow[]> {
  const res = await fetch(apiUrl('/api/shares'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to list shares.'));
  }
  const body = (await res.json()) as { shares: ShareRow[] };
  return body.shares;
}

/** Revoke a share by token. Silently no-ops if already gone. */
export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/shares/${encodeURIComponent(token)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(await readError(res, 'Failed to revoke share.'));
  }
}

/**
 * Read a share. Public 'link' shares need no auth; 'friends' shares require the
 * session cookie (sent via credentials:'include' — a harmless no-op for link
 * shares) and throw ShareAuthRequiredError on 401 so the viewer can prompt
 * sign-in instead of showing a raw error.
 */
export async function fetchPublicShare(token: string): Promise<PublicShareResponse> {
  const res = await fetch(apiUrl(`/api/shares/public/${encodeURIComponent(token)}`), {
    credentials: 'include',
  });
  if (res.status === 404) {
    throw new ShareNotFoundError();
  }
  if (res.status === 401) {
    throw new ShareAuthRequiredError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load shared content.'));
  }
  return (await res.json()) as PublicShareResponse;
}

/** A friend's friends-visible shares (the friend hub). Requires friendship —
 *  the server 403s otherwise. */
export async function getFriendShares(
  friendId: string
): Promise<{ ownerUsername: string; ownerDisplayName: string | null; shares: FriendShareRow[] }> {
  const res = await fetch(apiUrl(`/api/friends/${encodeURIComponent(friendId)}/shares`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load shared content.'));
  }
  return (await res.json()) as {
    ownerUsername: string;
    ownerDisplayName: string | null;
    shares: FriendShareRow[];
  };
}

/** Shares other users have directed to the authenticated caller (their inbox). */
export async function getInbox(): Promise<InboxShareRow[]> {
  const res = await fetch(apiUrl('/api/shares/inbox'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load your inbox.'));
  }
  const body = (await res.json()) as { shares: InboxShareRow[] };
  return body.shares;
}

export class ShareNotFoundError extends Error {
  constructor() {
    super('Share not found.');
    this.name = 'ShareNotFoundError';
  }
}

/** Thrown when a friends-only share is opened without (or with insufficient) auth. */
export class ShareAuthRequiredError extends Error {
  constructor() {
    super('Sign in to view this shared content.');
    this.name = 'ShareAuthRequiredError';
  }
}

/**
 * Build a full, shareable HTTPS URL for a share token.
 *
 * On native the WebView origin is `https://localhost`, so we hard-code the
 * public web origin — the recipient opens the link in a browser (or, once
 * HTTPS App Links are verified, straight into the app). On web we use the
 * actual page origin so dev / preview / prod each link to themselves.
 */
export function shareUrl(token: string): string {
  if (isNativePlatform()) return `${WEB_ORIGIN}/s/${token}`;
  if (typeof window === 'undefined') return `/s/${token}`;
  return `${window.location.origin}/s/${token}`;
}
