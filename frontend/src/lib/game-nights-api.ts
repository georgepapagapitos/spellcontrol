import { apiUrl } from './api-base';
import { isNativePlatform } from './platform';

/**
 * Client for the game-nights API (E123): schedule a night, invite friends,
 * or hand anyone the /gn/:token link — RSVPs work without an account.
 */

export type RsvpStatus = 'going' | 'maybe' | 'declined';

export interface NightRsvp {
  displayName: string;
  status: RsvpStatus;
  isHost: boolean;
}

/** A night as seen by a signed-in caller (host, invitee, or link-joiner). */
export interface GameNight {
  id: string;
  token: string;
  title: string;
  startsAt: number;
  timezone: string | null;
  location: string | null;
  notes: string | null;
  createdAt: number;
  cancelledAt: number | null;
  hostUsername: string;
  isHost: boolean;
  myStatus: RsvpStatus | null;
  rsvps: NightRsvp[];
  /** Invited friends who haven't replied yet. */
  awaiting: string[];
}

/** The public (token) view — what a guest with the link sees. */
export interface PublicGameNight {
  night: {
    token: string;
    title: string;
    startsAt: number;
    timezone: string | null;
    location: string | null;
    notes: string | null;
    cancelledAt: number | null;
    hostUsername: string;
  };
  rsvps: NightRsvp[];
  /** The caller's own RSVP; its id is the guest's edit credential. */
  myRsvp: { id: string; displayName: string; status: RsvpStatus } | null;
}

export class GameNightNotFoundError extends Error {
  constructor() {
    super('Game night not found.');
    this.name = 'GameNightNotFoundError';
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

export interface GameNightInput {
  title: string;
  startsAt: number;
  timezone?: string;
  location?: string;
  notes?: string;
  inviteUserIds?: string[];
}

export async function createGameNight(input: GameNightInput): Promise<GameNight> {
  const res = await fetch(apiUrl('/api/game-nights'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't create the game night."));
  }
  const body = (await res.json()) as { night: GameNight };
  return body.night;
}

export async function listGameNights(): Promise<GameNight[]> {
  const res = await fetch(apiUrl('/api/game-nights'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't load game nights."));
  }
  const body = (await res.json()) as { nights: GameNight[] };
  return body.nights;
}

export async function updateGameNight(
  id: string,
  patch: Partial<GameNightInput> & { addInviteUserIds?: string[] }
): Promise<GameNight> {
  const res = await fetch(apiUrl(`/api/game-nights/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't update the game night."));
  }
  const body = (await res.json()) as { night: GameNight };
  return body.night;
}

export async function cancelGameNight(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/game-nights/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Couldn't cancel the game night."));
  }
}

/** Public read. `rsvpId` is the guest's stored credential for `myRsvp` resolution. */
export async function fetchPublicGameNight(
  token: string,
  rsvpId?: string
): Promise<PublicGameNight> {
  const query = rsvpId ? `?rsvpId=${encodeURIComponent(rsvpId)}` : '';
  const res = await fetch(apiUrl(`/api/game-nights/public/${encodeURIComponent(token)}${query}`), {
    credentials: 'include',
  });
  if (res.status === 404) {
    throw new GameNightNotFoundError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't load the game night."));
  }
  return (await res.json()) as PublicGameNight;
}

/** RSVP (signed in or guest). Returns the row — guests should store its id. */
export async function rsvpGameNight(
  token: string,
  input: { status: RsvpStatus; displayName?: string; rsvpId?: string }
): Promise<{ id: string; displayName: string; status: RsvpStatus }> {
  const res = await fetch(apiUrl(`/api/game-nights/public/${encodeURIComponent(token)}/rsvp`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 404) {
    throw new GameNightNotFoundError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't save your RSVP."));
  }
  const body = (await res.json()) as {
    rsvp: { id: string; displayName: string; status: RsvpStatus };
  };
  return body.rsvp;
}

/** Public web origin — see shareUrl in share-client.ts for the native rationale. */
const WEB_ORIGIN = 'https://spellcontrol.com';

/** Full shareable URL for a game night token. */
export function gameNightUrl(token: string): string {
  if (isNativePlatform()) return `${WEB_ORIGIN}/gn/${token}`;
  if (typeof window === 'undefined') return `/gn/${token}`;
  return `${window.location.origin}/gn/${token}`;
}
