import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { lookupGameNightLandingMeta } from './game-nights';

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

/** Mutual requests — the second auto-accepts (see friends.ts). */
async function befriend(cookieA: string, usernameB: string, cookieB: string, usernameA: string) {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', cookieA)
    .send({ username: usernameB });
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', cookieB)
    .send({ username: usernameA });
}

async function friendIdOf(cookie: string, username: string): Promise<string> {
  const res = await request(app).get('/api/friends').set('Cookie', cookie);
  const friend = (res.body.friends as Array<{ id: string; username: string }>).find(
    (f) => f.username === username
  );
  expect(friend).toBeDefined();
  return friend!.id;
}

const IN_A_WEEK = () => Date.now() + 7 * 24 * 60 * 60 * 1000;

async function createNight(
  cookie: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; token: string }> {
  const res = await request(app)
    .post('/api/game-nights')
    .set('Cookie', cookie)
    .send({ title: 'Commander night', startsAt: IN_A_WEEK(), ...overrides });
  expect(res.status).toBe(201);
  return { id: res.body.night.id, token: res.body.night.token };
}

describe('POST /api/game-nights', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app)
      .post('/api/game-nights')
      .send({ title: 'x', startsAt: IN_A_WEEK() });
    expect(res.status).toBe(401);
  });

  it('rejects a missing/blank title and a bad startsAt (400)', async () => {
    const host = await makeUser('gn-create-validate');
    const noTitle = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: '   ', startsAt: IN_A_WEEK() });
    expect(noTitle.status).toBe(400);
    const badStart = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'x', startsAt: 'tomorrow' });
    expect(badStart.status).toBe(400);
  });

  it('creates a night with a token and auto-RSVPs the host as going', async () => {
    const host = await makeUser('gn-create-host');
    const startsAt = IN_A_WEEK();
    const res = await request(app).post('/api/game-nights').set('Cookie', host).send({
      title: 'Friday commander',
      startsAt,
      location: "Sam's place",
      notes: 'Bring bracket 2',
    });
    expect(res.status).toBe(201);
    const night = res.body.night;
    expect(night.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(night.title).toBe('Friday commander');
    expect(night.startsAt).toBe(startsAt);
    expect(night.location).toBe("Sam's place");
    expect(night.isHost).toBe(true);
    expect(night.myStatus).toBe('going');
    expect(night.rsvps).toEqual([{ displayName: 'gn-create-host', status: 'going', isHost: true }]);
  });

  it('keeps a valid IANA timezone and drops garbage', async () => {
    const host = await makeUser('gn-create-tz');
    const good = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'tz', startsAt: IN_A_WEEK(), timezone: 'America/Chicago' });
    expect(good.body.night.timezone).toBe('America/Chicago');
    const bad = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'tz', startsAt: IN_A_WEEK(), timezone: 'Not/AZone' });
    expect(bad.body.night.timezone).toBeNull();
  });

  it('rejects inviting a non-friend (403)', async () => {
    const host = await makeUser('gn-invite-stranger-a');
    const strangerCookie = await makeUser('gn-invite-stranger-b');
    // Grab the stranger's real id via a friendship with a third user? Simpler:
    // any unknown id has no friendship row, which is the same 403 path.
    void strangerCookie;
    const res = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'x', startsAt: IN_A_WEEK(), inviteUserIds: ['not-a-friend-id'] });
    expect(res.status).toBe(403);
  });

  it('invites friends, who then see the night with awaiting cleared once they RSVP', async () => {
    const host = await makeUser('gn-invite-host');
    const guest = await makeUser('gn-invite-guest');
    await befriend(host, 'gn-invite-guest', guest, 'gn-invite-host');
    const guestId = await friendIdOf(host, 'gn-invite-guest');

    const created = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'Invite night', startsAt: IN_A_WEEK(), inviteUserIds: [guestId] });
    expect(created.status).toBe(201);
    expect(created.body.night.awaiting).toEqual(['gn-invite-guest']);

    // The invited friend sees it.
    const list = await request(app).get('/api/game-nights').set('Cookie', guest);
    expect(list.status).toBe(200);
    const mine = list.body.nights.find((n: { id: string }) => n.id === created.body.night.id);
    expect(mine).toBeDefined();
    expect(mine.isHost).toBe(false);
    expect(mine.myStatus).toBeNull();
    expect(mine.hostUsername).toBe('gn-invite-host');

    // RSVP via the public endpoint while signed in → drops out of awaiting.
    const rsvp = await request(app)
      .post(`/api/game-nights/public/${created.body.night.token}/rsvp`)
      .set('Cookie', guest)
      .send({ status: 'going' });
    expect(rsvp.status).toBe(200);
    const after = await request(app).get('/api/game-nights').set('Cookie', host);
    const nightAfter = after.body.nights.find(
      (n: { id: string }) => n.id === created.body.night.id
    );
    expect(nightAfter.awaiting).toEqual([]);
    expect(nightAfter.rsvps).toContainEqual({
      displayName: 'gn-invite-guest',
      status: 'going',
      isHost: false,
    });
  });
});

describe('GET /api/game-nights', () => {
  it('lists nights the caller RSVP’d to via link (not just hosted/invited)', async () => {
    const host = await makeUser('gn-list-host');
    const joiner = await makeUser('gn-list-joiner');
    const { id, token } = await createNight(host);
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', joiner)
      .send({ status: 'maybe' });
    const list = await request(app).get('/api/game-nights').set('Cookie', joiner);
    const mine = list.body.nights.find((n: { id: string }) => n.id === id);
    expect(mine).toBeDefined();
    expect(mine.myStatus).toBe('maybe');
  });

  it('excludes nights that ended more than a day ago', async () => {
    const host = await makeUser('gn-list-old');
    await createNight(host, { startsAt: Date.now() - 3 * 24 * 60 * 60 * 1000, title: 'Old night' });
    const list = await request(app).get('/api/game-nights').set('Cookie', host);
    expect(list.body.nights.some((n: { title: string }) => n.title === 'Old night')).toBe(false);
  });
});

describe('PATCH /api/game-nights/:id', () => {
  it('404s for a non-host caller', async () => {
    const host = await makeUser('gn-patch-host');
    const other = await makeUser('gn-patch-other');
    const { id } = await createNight(host);
    const res = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', other)
      .send({ title: 'hijack' });
    expect(res.status).toBe(404);
  });

  it('updates details and validates them', async () => {
    const host = await makeUser('gn-patch-edit');
    const { id } = await createNight(host);
    const newStart = IN_A_WEEK() + 60_000;
    const ok = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', host)
      .send({ title: 'Moved night', startsAt: newStart, location: 'New spot' });
    expect(ok.status).toBe(200);
    expect(ok.body.night.title).toBe('Moved night');
    expect(ok.body.night.startsAt).toBe(newStart);
    expect(ok.body.night.location).toBe('New spot');

    const bad = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', host)
      .send({ title: '' });
    expect(bad.status).toBe(400);
  });

  it('rejects edits to a cancelled night (400)', async () => {
    const host = await makeUser('gn-patch-cancelled');
    const { id } = await createNight(host);
    await request(app).delete(`/api/game-nights/${id}`).set('Cookie', host);
    const res = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', host)
      .send({ title: 'too late' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/game-nights/:id (cancel)', () => {
  it('cancels once (204), then 404s, and the public page shows the cancellation', async () => {
    const host = await makeUser('gn-cancel-host');
    const { id, token } = await createNight(host);
    const first = await request(app).delete(`/api/game-nights/${id}`).set('Cookie', host);
    expect(first.status).toBe(204);
    const second = await request(app).delete(`/api/game-nights/${id}`).set('Cookie', host);
    expect(second.status).toBe(404);
    const pub = await request(app).get(`/api/game-nights/public/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.night.cancelledAt).not.toBeNull();
  });

  it('404s for a non-host caller', async () => {
    const host = await makeUser('gn-cancel-nonhost-a');
    const other = await makeUser('gn-cancel-nonhost-b');
    const { id } = await createNight(host);
    const res = await request(app).delete(`/api/game-nights/${id}`).set('Cookie', other);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/game-nights/public/:token', () => {
  it('404s for an unknown token', async () => {
    const res = await request(app).get('/api/game-nights/public/nope');
    expect(res.status).toBe(404);
  });

  it('needs no auth and never exposes other attendees’ rsvp ids', async () => {
    const host = await makeUser('gn-public-host');
    const { token } = await createNight(host);
    const res = await request(app).get(`/api/game-nights/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.night.hostUsername).toBe('gn-public-host');
    expect(res.body.myRsvp).toBeNull();
    for (const r of res.body.rsvps) {
      expect(r).toEqual({
        displayName: expect.any(String),
        status: expect.any(String),
        isHost: expect.any(Boolean),
      });
    }
  });
});

describe('POST /api/game-nights/public/:token/rsvp', () => {
  it('rejects a bad status (400) and a guest with no displayName (400)', async () => {
    const host = await makeUser('gn-rsvp-validate');
    const { token } = await createNight(host);
    const badStatus = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'yes', displayName: 'Pat' });
    expect(badStatus.status).toBe(400);
    const noName = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going' });
    expect(noName.status).toBe(400);
  });

  it('guest RSVP creates a row and the returned id can update it later', async () => {
    const host = await makeUser('gn-rsvp-guest');
    const { token } = await createNight(host);
    const created = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Pat' });
    expect(created.status).toBe(201);
    const rsvpId = created.body.rsvp.id as string;

    // myRsvp resolves via the stored id.
    const read = await request(app).get(`/api/game-nights/public/${token}?rsvpId=${rsvpId}`);
    expect(read.body.myRsvp).toEqual({ id: rsvpId, displayName: 'Pat', status: 'going' });

    // Update keeps the name when displayName is omitted.
    const updated = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'declined', rsvpId });
    expect(updated.status).toBe(200);
    expect(updated.body.rsvp).toEqual({ id: rsvpId, displayName: 'Pat', status: 'declined' });

    // Still one guest row (the public list has host + Pat).
    const after = await request(app).get(`/api/game-nights/public/${token}`);
    expect(after.body.rsvps).toHaveLength(2);
  });

  it('a stale guest rsvpId falls through to create when a name is supplied', async () => {
    const host = await makeUser('gn-rsvp-stale');
    const { token } = await createNight(host);
    const res = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'maybe', displayName: 'Sam', rsvpId: 'gone' });
    expect(res.status).toBe(201);
    expect(res.body.rsvp.displayName).toBe('Sam');
  });

  it('authed RSVP upserts a single row per user', async () => {
    const host = await makeUser('gn-rsvp-authed-host');
    const player = await makeUser('gn-rsvp-authed-player');
    const { token } = await createNight(host);
    const first = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', player)
      .send({ status: 'going' });
    expect(first.status).toBe(200);
    expect(first.body.rsvp.displayName).toBe('gn-rsvp-authed-player');
    const second = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', player)
      .send({ status: 'maybe' });
    expect(second.status).toBe(200);
    expect(second.body.rsvp.id).toBe(first.body.rsvp.id);

    const pub = await request(app).get(`/api/game-nights/public/${token}`);
    expect(pub.body.rsvps).toHaveLength(2); // host + player, not three
  });

  it('rejects RSVPs to a cancelled night and to a long-past night (400)', async () => {
    const host = await makeUser('gn-rsvp-closed');
    const { id, token } = await createNight(host);
    await request(app).delete(`/api/game-nights/${id}`).set('Cookie', host);
    const cancelled = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Late' });
    expect(cancelled.status).toBe(400);

    const past = await createNight(host, { startsAt: Date.now() - 3 * 24 * 60 * 60 * 1000 });
    const tooLate = await request(app)
      .post(`/api/game-nights/public/${past.token}/rsvp`)
      .send({ status: 'going', displayName: 'Late' });
    expect(tooLate.status).toBe(400);
  });
});

describe('lookupGameNightLandingMeta', () => {
  it('returns unfurl meta with host, count, and the /gn URL', async () => {
    const host = await makeUser('gn-og-host');
    const { token } = await createNight(host, {
      title: 'Friday commander',
      timezone: 'America/Chicago',
      location: 'The shop',
    });
    const meta = await lookupGameNightLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('Friday commander — hosted by gn-og-host');
    expect(meta!.url).toContain(`/gn/${token}`);
    expect(meta!.description).toContain('The shop');
    expect(meta!.description).toContain('1 going');
  });

  it('returns null for an unknown token and a cancelled description after cancel', async () => {
    expect(await lookupGameNightLandingMeta('nope')).toBeNull();
    const host = await makeUser('gn-og-cancel');
    const { id, token } = await createNight(host);
    await request(app).delete(`/api/game-nights/${id}`).set('Cookie', host);
    const meta = await lookupGameNightLandingMeta(token);
    expect(meta!.description).toContain('cancelled');
  });
});
