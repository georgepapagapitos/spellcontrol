import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cancelGameNight,
  createGameNight,
  createGameNightGuestInvite,
  loadGuestInviteToken,
  resolveGuestInvite,
  revokeGameNightGuestInvite,
  saveGuestInviteToken,
  deleteGameNight,
  endGameNightSeries,
  fetchPublicGameNight,
  GameNightNotFoundError,
  gameNightSeriesUrl,
  gameNightUrl,
  listGameNights,
  lockGameNight,
  openGameNightPoll,
  removeGameNightInvite,
  removeGameNightRsvp,
  resolveGameNightSeries,
  rsvpGameNight,
  suggestGameNightOption,
  unblockGameNightUser,
  updateGameNight,
  voteGameNight,
} from './game-nights-api';

const NIGHT = { id: 'n1', token: 'tok', title: 'Friday commander' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createGameNight', () => {
  it('POSTs the input and unwraps the night', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ night: NIGHT }, 201));
    const night = await createGameNight({ title: 'Friday commander', startsAt: 123 });
    expect(night).toEqual(NIGHT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ title: 'Friday commander', startsAt: 123 });
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'title is required.' }, 400));
    await expect(createGameNight({ title: '', startsAt: 1 })).rejects.toThrow('title is required.');
  });
});

describe('listGameNights / updateGameNight / cancelGameNight', () => {
  it('lists nights', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nights: [NIGHT] }));
    expect(await listGameNights()).toEqual([NIGHT]);
  });

  it('PATCHes updates to the night id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ night: NIGHT }));
    await updateGameNight('n1', { title: 'Moved' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1');
    expect(init.method).toBe('PATCH');
  });

  it('treats 204 as success on cancel and surfaces other errors', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(cancelGameNight('n1')).resolves.toBeUndefined();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Game night not found.' }, 404));
    await expect(cancelGameNight('n2')).rejects.toThrow('Game night not found.');
  });
});

describe('host controls: delete night, remove attendee, un-invite', () => {
  it('deleteGameNight DELETEs with ?hard=1 and treats 204 as success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteGameNight('n1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1?hard=1');
    expect(init.method).toBe('DELETE');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Game night not found.' }, 404));
    await expect(deleteGameNight('n2')).rejects.toThrow('Game night not found.');
  });

  it('removeGameNightRsvp DELETEs the rsvp and surfaces errors', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(removeGameNightRsvp('n1', 'r9')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1/rsvps/r9');
    expect(String(url)).not.toContain('?block=1');
    expect(init.method).toBe('DELETE');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'RSVP not found.' }, 404));
    await expect(removeGameNightRsvp('n1', 'r9')).rejects.toThrow('RSVP not found.');
  });

  it('removeGameNightRsvp with block:true appends ?block=1', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(removeGameNightRsvp('n1', 'r9', { block: true })).resolves.toBeUndefined();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1/rsvps/r9?block=1');
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Guests can't be blocked — make the night invite-only instead." }, 400)
    );
    await expect(removeGameNightRsvp('n1', 'r9', { block: true })).rejects.toThrow(
      "Guests can't be blocked — make the night invite-only instead."
    );
  });

  it('unblockGameNightUser DELETEs by username and surfaces errors', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(unblockGameNightUser('n1', 'sam')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1/blocks/sam');
    expect(init.method).toBe('DELETE');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Block not found.' }, 404));
    await expect(unblockGameNightUser('n1', 'sam')).rejects.toThrow('Block not found.');
  });

  it('removeGameNightInvite DELETEs by username and surfaces errors', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(removeGameNightInvite('n1', 'sam')).resolves.toBeUndefined();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1/invites/sam');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Invite not found.' }, 404));
    await expect(removeGameNightInvite('n1', 'sam')).rejects.toThrow('Invite not found.');
  });

  it('createGameNight passes inviteOnly through', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ night: NIGHT }, 201));
    await createGameNight({ title: 'x', startsAt: 1, inviteOnly: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).inviteOnly).toBe(true);
  });
});

describe('fetchPublicGameNight', () => {
  it('appends the guest rsvpId and unwraps the payload', async () => {
    const payload = { night: NIGHT, rsvps: [], myRsvp: null };
    fetchMock.mockResolvedValue(jsonResponse(payload));
    expect(await fetchPublicGameNight('tok', 'r1')).toEqual(payload);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/game-nights/public/tok?rsvpId=r1');
  });

  it('throws GameNightNotFoundError on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 404));
    await expect(fetchPublicGameNight('gone')).rejects.toBeInstanceOf(GameNightNotFoundError);
  });
});

describe('rsvpGameNight', () => {
  it('POSTs the rsvp and returns the row', async () => {
    const rsvp = { id: 'r1', displayName: 'Pat', status: 'going' };
    fetchMock.mockResolvedValue(jsonResponse({ rsvp }, 201));
    expect(await rsvpGameNight('tok', { status: 'going', displayName: 'Pat' })).toEqual(rsvp);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/public/tok/rsvp');
    expect(JSON.parse(init.body)).toEqual({ status: 'going', displayName: 'Pat' });
  });

  it('surfaces validation errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'displayName is required.' }, 400));
    await expect(rsvpGameNight('tok', { status: 'going' })).rejects.toThrow(
      'displayName is required.'
    );
  });
});

describe('voteGameNight / suggestGameNightOption', () => {
  it('POSTs the vote set and returns the rsvp credential', async () => {
    const rsvp = { id: 'r1', displayName: 'Pat' };
    fetchMock.mockResolvedValue(jsonResponse({ rsvp }));
    expect(await voteGameNight('tok', { optionIds: ['o1', 'o2'], displayName: 'Pat' })).toEqual(
      rsvp
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/public/tok/votes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ optionIds: ['o1', 'o2'], displayName: 'Pat' });
  });

  it('POSTs a suggested slot and surfaces errors', async () => {
    const rsvp = { id: 'r1', displayName: 'Sam' };
    fetchMock.mockResolvedValue(jsonResponse({ rsvp }, 201));
    expect(await suggestGameNightOption('tok', { startsAt: 123, rsvpId: 'r1' })).toEqual(rsvp);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/game-nights/public/tok/options');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'That time is already an option.' }, 400));
    await expect(suggestGameNightOption('tok', { startsAt: 123 })).rejects.toThrow(
      'That time is already an option.'
    );
  });

  it('throws GameNightNotFoundError on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 404));
    await expect(voteGameNight('gone', { optionIds: [] })).rejects.toBeInstanceOf(
      GameNightNotFoundError
    );
  });
});

describe('lockGameNight', () => {
  it('POSTs the option id to /:id/lock and unwraps the night', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ night: NIGHT }));
    expect(await lockGameNight('n1', 'o1')).toEqual(NIGHT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1/lock');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ optionId: 'o1' });
  });

  it('surfaces the server error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Pick one of the poll options to lock in.' }, 400)
    );
    await expect(lockGameNight('n1', 'bad')).rejects.toThrow(
      'Pick one of the poll options to lock in.'
    );
  });
});

describe('recurring series (E125)', () => {
  it('createGameNight passes repeatsWeekly through', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ night: NIGHT }, 201));
    await createGameNight({ title: 'Weekly', startsAt: 123, repeatsWeekly: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: 'Weekly',
      startsAt: 123,
      repeatsWeekly: true,
    });
  });

  it('openGameNightPoll POSTs the slots to /:id/poll and unwraps the night', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ night: NIGHT }, 201));
    expect(await openGameNightPoll('n1', [1, 2])).toEqual(NIGHT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/n1/poll');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ options: [1, 2] });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'This night is already voting.' }, 400));
    await expect(openGameNightPoll('n1', [1, 2])).rejects.toThrow('This night is already voting.');
  });

  it('endGameNightSeries treats 204 as success and surfaces errors', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(endGameNightSeries('s1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/game-nights/series/s1');
    expect(init.method).toBe('DELETE');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Series not found.' }, 404));
    await expect(endGameNightSeries('s2')).rejects.toThrow('Series not found.');
  });

  it('resolveGameNightSeries returns the night token and 404s as not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nightToken: 'occ-tok' }));
    expect(await resolveGameNightSeries('ser-tok')).toBe('occ-tok');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/game-nights/public/series/ser-tok');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 404));
    await expect(resolveGameNightSeries('gone')).rejects.toBeInstanceOf(GameNightNotFoundError);
  });
});

describe('named guest invite links (E208)', () => {
  /** Minimal Storage stand-in — this file runs in the node env. */
  function stubStorage(): Map<string, string> {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    return store;
  }

  it('resolves an invite token to its night, and 404s as not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nightToken: 'night-tok' }));
    expect(await resolveGuestInvite('inv-tok')).toEqual({ nightToken: 'night-tok' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/game-nights/public/invites/inv-tok');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 404));
    await expect(resolveGuestInvite('revoked')).rejects.toBeInstanceOf(GameNightNotFoundError);
  });

  it('stores the credential per night and survives unavailable storage', () => {
    const store = stubStorage();
    saveGuestInviteToken('night-tok', 'inv-tok');
    expect(store.get('gn-invite:night-tok')).toBe('inv-tok');
    expect(loadGuestInviteToken('night-tok')).toBe('inv-tok');
    expect(loadGuestInviteToken('other-night')).toBeNull();

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      },
    });
    expect(() => saveGuestInviteToken('night-tok', 'inv-tok')).not.toThrow();
    expect(loadGuestInviteToken('night-tok')).toBeNull();
  });

  it('sends the credential as a header on reads — never a query param', async () => {
    stubStorage();
    saveGuestInviteToken('tok', 'inv-tok');
    fetchMock.mockResolvedValue(jsonResponse({ night: {}, rsvps: [], options: [], canRsvp: true }));
    await fetchPublicGameNight('tok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('inv-tok');
    expect(init.headers['X-Night-Invite']).toBe('inv-tok');
  });

  it('attaches the credential to every reply path', async () => {
    stubStorage();
    saveGuestInviteToken('tok', 'inv-tok');
    // A fresh Response per call — a shared one has its body read once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ rsvp: { id: 'r1', displayName: 'Dave' } }))
    );
    await rsvpGameNight('tok', { status: 'going', displayName: 'Dave' });
    await voteGameNight('tok', { optionIds: ['o1'] });
    await suggestGameNightOption('tok', { startsAt: 123 });
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body).inviteToken).toBe('inv-tok');
    }
  });

  it('omits the credential entirely when there is none', async () => {
    stubStorage();
    fetchMock.mockResolvedValue(jsonResponse({ rsvp: { id: 'r1', displayName: 'Dave' } }));
    await rsvpGameNight('tok', { status: 'going', displayName: 'Dave' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('inviteToken');
  });

  it('mints and revokes host-side', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ invite: { id: 'i1', label: 'Dave', url: 'https://x/gn/i/inv-tok' } }, 201)
    );
    const invite = await createGameNightGuestInvite('n1', 'Dave');
    expect(invite).toEqual({
      id: 'i1',
      label: 'Dave',
      url: 'https://x/gn/i/inv-tok',
      weekly: false,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ label: 'Dave' });

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(revokeGameNightGuestInvite('n1', 'i1')).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/game-nights/n1/guest-invites/i1');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });
});

describe('gameNightUrl', () => {
  it('builds a /gn/ URL', () => {
    expect(gameNightUrl('tok123')).toContain('/gn/tok123');
  });

  it('builds a stable /gn/s/ URL for a series', () => {
    expect(gameNightSeriesUrl('ser123')).toContain('/gn/s/ser123');
  });
});
