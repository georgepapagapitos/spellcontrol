import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cancelGameNight,
  createGameNight,
  endGameNightSeries,
  fetchPublicGameNight,
  GameNightNotFoundError,
  gameNightSeriesUrl,
  gameNightUrl,
  listGameNights,
  lockGameNight,
  openGameNightPoll,
  resolveGameNightSeries,
  rsvpGameNight,
  suggestGameNightOption,
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

describe('gameNightUrl', () => {
  it('builds a /gn/ URL', () => {
    expect(gameNightUrl('tok123')).toContain('/gn/tok123');
  });

  it('builds a stable /gn/s/ URL for a series', () => {
    expect(gameNightSeriesUrl('ser123')).toContain('/gn/s/ser123');
  });
});
