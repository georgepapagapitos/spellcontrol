import type { PublicShareResponse, ShareKind, ShareRow } from './shared-types';
import { apiUrl } from './api-base';

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Create (or return existing) share for the authenticated user. */
export async function createShare(input: {
  kind: ShareKind;
  resourceId?: string;
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

/** Public read — no auth required. */
export async function fetchPublicShare(token: string): Promise<PublicShareResponse> {
  const res = await fetch(apiUrl(`/api/shares/public/${encodeURIComponent(token)}`));
  if (res.status === 404) {
    throw new ShareNotFoundError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load shared content.'));
  }
  return (await res.json()) as PublicShareResponse;
}

export class ShareNotFoundError extends Error {
  constructor() {
    super('Share not found.');
    this.name = 'ShareNotFoundError';
  }
}

/** Build a full share URL using the page origin. */
export function shareUrl(token: string): string {
  if (typeof window === 'undefined') return `/s/${token}`;
  return `${window.location.origin}/s/${token}`;
}
