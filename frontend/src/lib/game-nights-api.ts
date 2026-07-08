import { apiUrl } from './api-base';
import { isNativePlatform } from './platform';

/**
 * Client for the game-nights API (E123): schedule a night, invite friends,
 * or hand anyone the /gn/:token link — RSVPs work without an account.
 */

export type RsvpStatus = 'going' | 'maybe' | 'declined';

export interface NightRsvp {
  /** Removal handle, present only in the host's own view of their night. */
  id?: string;
  displayName: string;
  status: RsvpStatus;
  isHost: boolean;
  /** Present only for account-backed rsvps in an authed viewer's list — lets the
   *  attendee sheet offer "Add friend". Never present on the public payload. */
  username?: string;
}

/**
 * A candidate date slot while a night is polling (E124). A night with a
 * non-empty `options` list is in the voting phase — clients show the poll
 * instead of the RSVP/calendar UI until the host locks a slot in.
 */
export interface NightOption {
  id: string;
  startsAt: number;
  /** Who suggested the slot; null = one of the host's original candidates. */
  proposedBy: string | null;
  /** Display names of everyone who can make this slot. */
  voters: string[];
  myVote: boolean;
}

/**
 * The weekly series a night belongs to (E125). The series `token` powers the
 * stable /gn/s/:token link that always resolves to the upcoming occurrence —
 * the one to pin in the group chat. `endedAt` set = the host stopped it
 * repeating (existing nights stay as plain one-offs).
 */
export interface NightSeries {
  id: string;
  token: string;
  endedAt: number | null;
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
  /** Only people already in (host, invitees, existing RSVPs) can reply. */
  inviteOnly: boolean;
  /** Optional play format (e.g. 'commander'); null = undecided. */
  format: string | null;
  hostUsername: string;
  isHost: boolean;
  myStatus: RsvpStatus | null;
  rsvps: NightRsvp[];
  /** Invited friends who haven't replied yet. */
  awaiting: string[];
  /** Candidate date slots while polling; empty once a date is locked in. */
  options: NightOption[];
  /** The weekly series this night belongs to; null for a one-off night. */
  series: NightSeries | null;
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
    /** Only people already in (host, invitees, existing RSVPs) can reply. */
    inviteOnly: boolean;
    /** Optional play format (e.g. 'commander'); null = undecided. */
    format: string | null;
    hostUsername: string;
    series: NightSeries | null;
  };
  rsvps: NightRsvp[];
  /** The caller's own RSVP; its id is the guest's edit credential. */
  myRsvp: { id: string; displayName: string; status: RsvpStatus } | null;
  /** Candidate date slots while polling; empty once a date is locked in. */
  options: NightOption[];
  /** Whether THIS caller may reply — false on an invite-only night they're not in. */
  canRsvp: boolean;
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
  /** Required unless `options` is given (then the server derives it from the poll). */
  startsAt?: number;
  /** 2–5 candidate epoch-ms slots — creates the night in the date-polling phase. */
  options?: number[];
  timezone?: string;
  location?: string;
  notes?: string;
  /** Optional play format (e.g. 'commander'); omitted/undecided = null. */
  format?: string;
  inviteUserIds?: string[];
  /** Repeat weekly (E125): the next occurrence materializes as the date passes. */
  repeatsWeekly?: boolean;
  /** Invite-only: the link shows details, but only people you invite can reply. */
  inviteOnly?: boolean;
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

/** Host only: delete a night outright — gone from every list, the link 404s. */
export async function deleteGameNight(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/game-nights/${encodeURIComponent(id)}?hard=1`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Couldn't delete the game night."));
  }
}

/** Host only: remove an attendee's RSVP (and their pending invite with it). */
export async function removeGameNightRsvp(nightId: string, rsvpId: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/game-nights/${encodeURIComponent(nightId)}/rsvps/${encodeURIComponent(rsvpId)}`),
    { method: 'DELETE', credentials: 'include' }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Couldn't remove them from the night."));
  }
}

/** Host only: un-invite a friend who hasn't replied yet. */
export async function removeGameNightInvite(nightId: string, username: string): Promise<void> {
  const res = await fetch(
    apiUrl(
      `/api/game-nights/${encodeURIComponent(nightId)}/invites/${encodeURIComponent(username)}`
    ),
    { method: 'DELETE', credentials: 'include' }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Couldn't remove the invite."));
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

/**
 * Cast votes — the full set of option ids the caller can make (replaces their
 * previous votes; empty retracts all). Returns the rsvp credential — guests
 * should store it, same as an RSVP.
 */
export async function voteGameNight(
  token: string,
  input: { optionIds: string[]; displayName?: string; rsvpId?: string }
): Promise<{ id: string; displayName: string }> {
  const res = await fetch(apiUrl(`/api/game-nights/public/${encodeURIComponent(token)}/votes`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 404) {
    throw new GameNightNotFoundError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't save your votes."));
  }
  const body = (await res.json()) as { rsvp: { id: string; displayName: string } };
  return body.rsvp;
}

/** Suggest an extra time slot for a polling night (auto-votes the proposer for it). */
export async function suggestGameNightOption(
  token: string,
  input: { startsAt: number; displayName?: string; rsvpId?: string }
): Promise<{ id: string; displayName: string }> {
  const res = await fetch(apiUrl(`/api/game-nights/public/${encodeURIComponent(token)}/options`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 404) {
    throw new GameNightNotFoundError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't suggest that time."));
  }
  const body = (await res.json()) as { rsvp: { id: string; displayName: string } };
  return body.rsvp;
}

/** Host only: open a date vote on an existing night (2–5 candidate slots). */
export async function openGameNightPoll(id: string, options: number[]): Promise<GameNight> {
  const res = await fetch(apiUrl(`/api/game-nights/${encodeURIComponent(id)}/poll`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't open the date vote."));
  }
  const body = (await res.json()) as { night: GameNight };
  return body.night;
}

/** Host only: stop a series repeating. Existing nights stay as one-offs. */
export async function endGameNightSeries(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/game-nights/series/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Couldn't stop the series."));
  }
}

/**
 * Resolve a stable series link to the night it currently points at. Reading
 * it materializes the next occurrence server-side when one is due.
 */
export async function resolveGameNightSeries(token: string): Promise<string> {
  const res = await fetch(apiUrl(`/api/game-nights/public/series/${encodeURIComponent(token)}`), {
    credentials: 'include',
  });
  if (res.status === 404) {
    throw new GameNightNotFoundError();
  }
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't load the game night."));
  }
  const body = (await res.json()) as { nightToken: string };
  return body.nightToken;
}

/** Host only: lock a poll option in — the night flips to a plain scheduled date. */
export async function lockGameNight(id: string, optionId: string): Promise<GameNight> {
  const res = await fetch(apiUrl(`/api/game-nights/${encodeURIComponent(id)}/lock`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Couldn't lock the date in."));
  }
  const body = (await res.json()) as { night: GameNight };
  return body.night;
}

/** Public web origin — see shareUrl in share-client.ts for the native rationale. */
const WEB_ORIGIN = 'https://spellcontrol.com';

/** Full shareable URL for a game night token. */
export function gameNightUrl(token: string): string {
  if (isNativePlatform()) return `${WEB_ORIGIN}/gn/${token}`;
  if (typeof window === 'undefined') return `/gn/${token}`;
  return `${window.location.origin}/gn/${token}`;
}

/** Stable URL for a weekly series — always opens the upcoming occurrence. */
export function gameNightSeriesUrl(token: string): string {
  if (isNativePlatform()) return `${WEB_ORIGIN}/gn/s/${token}`;
  if (typeof window === 'undefined') return `/gn/s/${token}`;
  return `${window.location.origin}/gn/s/${token}`;
}
