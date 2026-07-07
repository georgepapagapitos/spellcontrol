import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cancelGameNight,
  createGameNight,
  fetchPublicGameNight,
  GameNightNotFoundError,
  gameNightUrl,
  listGameNights,
  rsvpGameNight,
  updateGameNight,
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

describe('gameNightUrl', () => {
  it('builds a /gn/ URL', () => {
    expect(gameNightUrl('tok123')).toContain('/gn/tok123');
  });
});
