import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import {
  lookupGameNightLandingMeta,
  lookupGameNightSeriesLandingMeta,
  plusWeek,
} from './game-nights';

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
    expect(night.rsvps).toEqual([
      // The host's own view carries the rsvp id — their removal handle. Account-backed
      // rsvps also carry username, for friend-requesting attendees from the sheet.
      {
        id: expect.any(String),
        displayName: 'gn-create-host',
        status: 'going',
        isHost: true,
        username: 'gn-create-host',
      },
    ]);
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

  it('is optional (defaults to null) and round-trips through the view and public payload', async () => {
    const host = await makeUser('gn-create-format');
    const undecided = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'no format', startsAt: IN_A_WEEK() });
    expect(undecided.body.night.format).toBeNull();

    const withFormat = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'commander night', startsAt: IN_A_WEEK(), format: 'commander' });
    expect(withFormat.body.night.format).toBe('commander');
    const pub = await request(app).get(`/api/game-nights/public/${withFormat.body.night.token}`);
    expect(pub.body.night.format).toBe('commander');
  });

  it('drops an invalid (non-string) format rather than rejecting the request', async () => {
    const host = await makeUser('gn-create-format-invalid');
    const res = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'bad format', startsAt: IN_A_WEEK(), format: 42 });
    expect(res.status).toBe(201);
    expect(res.body.night.format).toBeNull();
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
      id: expect.any(String),
      displayName: 'gn-invite-guest',
      status: 'going',
      isHost: false,
      username: 'gn-invite-guest',
    });
  });
});

describe('rsvp username exposure (authed views only, never public)', () => {
  it('carries username on account-backed rsvp rows in both the host’s and an attendee’s authed list view', async () => {
    const host = await makeUser('gn-username-host');
    const attendee = await makeUser('gn-username-attendee');
    const { id, token } = await createNight(host, { title: 'Username night' });
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', attendee)
      .send({ status: 'going' });

    const hostView = await request(app).get('/api/game-nights').set('Cookie', host);
    const hostNight = hostView.body.nights.find((n: { id: string }) => n.id === id);
    expect(hostNight.rsvps).toContainEqual(
      expect.objectContaining({
        displayName: 'gn-username-attendee',
        username: 'gn-username-attendee',
      })
    );
    expect(hostNight.rsvps).toContainEqual(
      expect.objectContaining({ displayName: 'gn-username-host', username: 'gn-username-host' })
    );

    const attendeeView = await request(app).get('/api/game-nights').set('Cookie', attendee);
    const attendeeNight = attendeeView.body.nights.find((n: { id: string }) => n.id === id);
    expect(attendeeNight.rsvps).toContainEqual(
      expect.objectContaining({ displayName: 'gn-username-host', username: 'gn-username-host' })
    );
  });

  it('guest rsvp rows carry no username in the authed host view', async () => {
    const host = await makeUser('gn-username-guest-host');
    const { id, token } = await createNight(host, { title: 'Guest username night' });
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'maybe', displayName: 'Guesty' });

    const hostView = await request(app).get('/api/game-nights').set('Cookie', host);
    const hostNight = hostView.body.nights.find((n: { id: string }) => n.id === id);
    const guestRow = hostNight.rsvps.find(
      (r: { displayName: string }) => r.displayName === 'Guesty'
    );
    expect(guestRow).toBeDefined();
    expect(guestRow.username).toBeUndefined();
  });

  it('the public payload keeps its exact {displayName,status,isHost} rsvp shape — no username, no id', async () => {
    const host = await makeUser('gn-username-public-host');
    const attendee = await makeUser('gn-username-public-attendee');
    const { token } = await createNight(host, { title: 'Public shape night' });
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', attendee)
      .send({ status: 'going' });

    const pub = await request(app).get(`/api/game-nights/public/${token}`);
    expect(pub.status).toBe(200);
    for (const r of pub.body.rsvps) {
      expect(Object.keys(r).sort()).toEqual(['displayName', 'isHost', 'status']);
    }
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

  it('updates the format, and drops an invalid value instead of rejecting', async () => {
    const host = await makeUser('gn-patch-format');
    const { id } = await createNight(host, { format: 'commander' });
    const set = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', host)
      .send({ format: 'pauper' });
    expect(set.status).toBe(200);
    expect(set.body.night.format).toBe('pauper');

    const invalid = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', host)
      .send({ format: 42 });
    expect(invalid.status).toBe(200);
    expect(invalid.body.night.format).toBeNull();
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

/** A polling night (E124): three candidate slots a week-ish out. */
const SLOT_A = () => Date.now() + 7 * 24 * 60 * 60 * 1000;

async function createPollNight(
  cookie: string,
  slots?: number[],
  overrides: Record<string, unknown> = {}
): Promise<{
  id: string;
  token: string;
  startsAt: number;
  options: Array<{ id: string; startsAt: number; proposedBy: string | null }>;
}> {
  const base = SLOT_A();
  const options = slots ?? [base + 2 * 86_400_000, base, base + 86_400_000];
  const res = await request(app)
    .post('/api/game-nights')
    .set('Cookie', cookie)
    .send({ title: 'Poll night', options, ...overrides });
  expect(res.status).toBe(201);
  return res.body.night;
}

describe('POST /api/game-nights with options (date poll)', () => {
  it('creates a polling night: slots sorted soonest-first, startsAt mirrors the latest', async () => {
    const host = await makeUser('gn-poll-create');
    const base = SLOT_A();
    const night = await createPollNight(host, [base + 2 * 86_400_000, base, base + 86_400_000]);
    expect(night.options).toHaveLength(3);
    expect(night.options.map((o) => o.startsAt)).toEqual([
      base,
      base + 86_400_000,
      base + 2 * 86_400_000,
    ]);
    expect(night.options.every((o) => o.proposedBy === null)).toBe(true);
    expect(night.startsAt).toBe(base + 2 * 86_400_000);
  });

  it('validates the options list (count, distinctness, timestamps)', async () => {
    const host = await makeUser('gn-poll-validate');
    const base = SLOT_A();
    const send = (options: unknown) =>
      request(app).post('/api/game-nights').set('Cookie', host).send({ title: 'x', options });
    expect((await send([base])).status).toBe(400); // too few
    expect((await send([1, 2, 3, 4, 5, 6].map((i) => base + i * 3_600_000))).status).toBe(400); // too many
    expect((await send([base, base])).status).toBe(400); // duplicate
    expect((await send([base, 'friday'])).status).toBe(400); // not a timestamp
    // No startsAt and no options → still the plain startsAt error.
    const neither = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'x' });
    expect(neither.status).toBe(400);
  });

  it('a plain single-date night has an empty options list', async () => {
    const host = await makeUser('gn-poll-plain');
    const res = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'Plain', startsAt: IN_A_WEEK() });
    expect(res.body.night.options).toEqual([]);
  });

  it('blocks plain RSVPs and startsAt edits while the date is up for vote', async () => {
    const host = await makeUser('gn-poll-blocked');
    const night = await createPollNight(host);
    const rsvp = await request(app)
      .post(`/api/game-nights/public/${night.token}/rsvp`)
      .send({ status: 'going', displayName: 'Pat' });
    expect(rsvp.status).toBe(400);
    const patch = await request(app)
      .patch(`/api/game-nights/${night.id}`)
      .set('Cookie', host)
      .send({ startsAt: IN_A_WEEK() });
    expect(patch.status).toBe(400);
    // Other fields still editable while polling.
    const title = await request(app)
      .patch(`/api/game-nights/${night.id}`)
      .set('Cookie', host)
      .send({ title: 'Renamed poll' });
    expect(title.status).toBe(200);
    expect(title.body.night.options).toHaveLength(3);
  });
});

describe('POST /api/game-nights/public/:token/votes', () => {
  it('guest votes create a maybe-RSVP identity and the credential re-votes later', async () => {
    const host = await makeUser('gn-vote-guest');
    const night = await createPollNight(host);
    const [a, b, c] = night.options.map((o) => o.id);

    const first = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .send({ optionIds: [a, b], displayName: 'Pat' });
    expect(first.status).toBe(200);
    const rsvpId = first.body.rsvp.id as string;

    const read = await request(app).get(`/api/game-nights/public/${night.token}?rsvpId=${rsvpId}`);
    const byId = new Map(
      (read.body.options as Array<{ id: string; voters: string[]; myVote: boolean }>).map((o) => [
        o.id,
        o,
      ])
    );
    expect(byId.get(a)!.myVote).toBe(true);
    expect(byId.get(a)!.voters).toContain('Pat');
    expect(byId.get(b)!.myVote).toBe(true);
    expect(byId.get(c)!.myVote).toBe(false);
    // The voter shows up as a 'maybe' reply, never exposing their rsvp id.
    expect(read.body.rsvps).toContainEqual({ displayName: 'Pat', status: 'maybe', isHost: false });

    // Re-voting with the credential replaces the whole set.
    const second = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .send({ optionIds: [c], rsvpId });
    expect(second.status).toBe(200);
    expect(second.body.rsvp.id).toBe(rsvpId);
    const after = await request(app).get(`/api/game-nights/public/${night.token}?rsvpId=${rsvpId}`);
    const afterById = new Map(
      (after.body.options as Array<{ id: string; myVote: boolean }>).map((o) => [o.id, o])
    );
    expect(afterById.get(a)!.myVote).toBe(false);
    expect(afterById.get(c)!.myVote).toBe(true);
  });

  it('validates option ids and requires a name for a brand-new guest', async () => {
    const host = await makeUser('gn-vote-validate');
    const night = await createPollNight(host);
    const bad = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .send({ optionIds: ['nope'], displayName: 'Pat' });
    expect(bad.status).toBe(400);
    const notArray = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .send({ optionIds: 'all', displayName: 'Pat' });
    expect(notArray.status).toBe(400);
    const noName = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .send({ optionIds: [night.options[0].id] });
    expect(noName.status).toBe(400);
  });

  it('authed votes use the username and never clobber an existing RSVP status', async () => {
    const host = await makeUser('gn-vote-authed');
    const night = await createPollNight(host);
    // The host is auto-RSVP'd 'going' — voting must not overwrite that.
    const res = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .set('Cookie', host)
      .send({ optionIds: [night.options[0].id] });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/game-nights').set('Cookie', host);
    const mine = list.body.nights.find((n: { id: string }) => n.id === night.id);
    expect(mine.myStatus).toBe('going');
    expect(mine.options.find((o: { id: string }) => o.id === night.options[0].id).myVote).toBe(
      true
    );
    expect(mine.options.find((o: { id: string }) => o.id === night.options[0].id).voters).toContain(
      'gn-vote-authed'
    );
  });

  it('rejects votes on a non-polling night', async () => {
    const host = await makeUser('gn-vote-locked');
    const { token } = await createNight(host);
    const res = await request(app)
      .post(`/api/game-nights/public/${token}/votes`)
      .send({ optionIds: [], displayName: 'Pat' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/game-nights/public/:token/options (suggest a time)', () => {
  it('adds a slot flagged with the proposer, auto-voted, and keeps startsAt at the latest', async () => {
    const host = await makeUser('gn-suggest');
    const night = await createPollNight(host);
    const later = night.startsAt + 86_400_000;
    const res = await request(app)
      .post(`/api/game-nights/public/${night.token}/options`)
      .send({ startsAt: later, displayName: 'Sam' });
    expect(res.status).toBe(201);

    const read = await request(app).get(`/api/game-nights/public/${night.token}`);
    expect(read.body.options).toHaveLength(4);
    const suggested = read.body.options.find((o: { startsAt: number }) => o.startsAt === later);
    expect(suggested.proposedBy).toBe('Sam');
    expect(suggested.voters).toEqual(['Sam']);
    // The polling invariant: night.startsAt mirrors the latest candidate.
    expect(read.body.night.startsAt).toBe(later);
  });

  it('rejects duplicates, bad timestamps, and enforces the option cap', async () => {
    const host = await makeUser('gn-suggest-validate');
    const base = SLOT_A();
    const night = await createPollNight(
      host,
      [1, 2, 3, 4, 5].map((i) => base + i * 3_600_000)
    );
    const dup = await request(app)
      .post(`/api/game-nights/public/${night.token}/options`)
      .send({ startsAt: base + 3_600_000, displayName: 'Sam' });
    expect(dup.status).toBe(400);
    const bad = await request(app)
      .post(`/api/game-nights/public/${night.token}/options`)
      .send({ startsAt: 'friday', displayName: 'Sam' });
    expect(bad.status).toBe(400);
    // 5 host slots + 3 suggestions = the cap of 8; the 4th suggestion bounces.
    for (let i = 6; i <= 8; i++) {
      const ok = await request(app)
        .post(`/api/game-nights/public/${night.token}/options`)
        .send({ startsAt: base + i * 3_600_000, displayName: 'Sam' });
      expect(ok.status).toBe(201);
    }
    const over = await request(app)
      .post(`/api/game-nights/public/${night.token}/options`)
      .send({ startsAt: base + 9 * 3_600_000, displayName: 'Sam' });
    expect(over.status).toBe(400);
  });

  it('rejects suggestions on a non-polling night', async () => {
    const host = await makeUser('gn-suggest-locked');
    const { token } = await createNight(host);
    const res = await request(app)
      .post(`/api/game-nights/public/${token}/options`)
      .send({ startsAt: IN_A_WEEK(), displayName: 'Sam' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/game-nights/:id/lock', () => {
  it('locks the chosen slot in: startsAt set, poll gone, RSVPs open again', async () => {
    const host = await makeUser('gn-lock');
    const night = await createPollNight(host);
    const chosen = night.options[0];
    const res = await request(app)
      .post(`/api/game-nights/${night.id}/lock`)
      .set('Cookie', host)
      .send({ optionId: chosen.id });
    expect(res.status).toBe(200);
    expect(res.body.night.startsAt).toBe(chosen.startsAt);
    expect(res.body.night.options).toEqual([]);

    const read = await request(app).get(`/api/game-nights/public/${night.token}`);
    expect(read.body.night.startsAt).toBe(chosen.startsAt);
    expect(read.body.options).toEqual([]);

    // The night now behaves like a plain scheduled one.
    const rsvp = await request(app)
      .post(`/api/game-nights/public/${night.token}/rsvp`)
      .send({ status: 'going', displayName: 'Pat' });
    expect(rsvp.status).toBe(201);
    const vote = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .send({ optionIds: [], rsvpId: rsvp.body.rsvp.id });
    expect(vote.status).toBe(400);
    const relock = await request(app)
      .post(`/api/game-nights/${night.id}/lock`)
      .set('Cookie', host)
      .send({ optionId: chosen.id });
    expect(relock.status).toBe(400);
  });

  it('404s for a non-host and 400s for a foreign option id', async () => {
    const host = await makeUser('gn-lock-host');
    const other = await makeUser('gn-lock-other');
    const night = await createPollNight(host);
    const nonHost = await request(app)
      .post(`/api/game-nights/${night.id}/lock`)
      .set('Cookie', other)
      .send({ optionId: night.options[0].id });
    expect(nonHost.status).toBe(404);
    const otherNight = await createPollNight(host);
    const foreign = await request(app)
      .post(`/api/game-nights/${night.id}/lock`)
      .set('Cookie', host)
      .send({ optionId: otherNight.options[0].id });
    expect(foreign.status).toBe(400);
  });

  it('rejects locking a cancelled night', async () => {
    const host = await makeUser('gn-lock-cancelled');
    const night = await createPollNight(host);
    await request(app).delete(`/api/game-nights/${night.id}`).set('Cookie', host);
    const res = await request(app)
      .post(`/api/game-nights/${night.id}/lock`)
      .set('Cookie', host)
      .send({ optionId: night.options[0].id });
    expect(res.status).toBe(400);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

interface NightBody {
  id: string;
  token: string;
  title: string;
  startsAt: number;
  cancelledAt: number | null;
  myStatus: string | null;
  awaiting: string[];
  location: string | null;
  format: string | null;
  options: Array<{ id: string; startsAt: number }>;
  series: { id: string; token: string; endedAt: number | null } | null;
  blocked: string[];
}

async function createWeeklyNight(
  cookie: string,
  overrides: Record<string, unknown> = {}
): Promise<NightBody> {
  const res = await request(app)
    .post('/api/game-nights')
    .set('Cookie', cookie)
    .send({ title: 'Weekly commander', startsAt: IN_A_WEEK(), repeatsWeekly: true, ...overrides });
  expect(res.status).toBe(201);
  return res.body.night;
}

async function listNights(cookie: string): Promise<NightBody[]> {
  const res = await request(app).get('/api/game-nights').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.nights;
}

describe('recurring game nights (E125)', () => {
  it('creates a weekly night carrying a stable series token', async () => {
    const host = await makeUser('gn-rec-create');
    const night = await createWeeklyNight(host);
    expect(night.series).not.toBeNull();
    expect(night.series!.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(night.series!.endedAt).toBeNull();
    // A one-off night has no series.
    const plain = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'One-off', startsAt: IN_A_WEEK() });
    expect(plain.body.night.series).toBeNull();
  });

  it('rejects repeatsWeekly combined with a date poll (400)', async () => {
    const host = await makeUser('gn-rec-poll-clash');
    const base = IN_A_WEEK();
    const res = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'x', options: [base, base + DAY_MS], repeatsWeekly: true });
    expect(res.status).toBe(400);
  });

  it('materializes the next occurrence on list-read, copying the latest night as the template', async () => {
    const host = await makeUser('gn-rec-mat-host');
    const guest = await makeUser('gn-rec-mat-guest');
    await befriend(host, 'gn-rec-mat-guest', guest, 'gn-rec-mat-host');
    const guestId = await friendIdOf(host, 'gn-rec-mat-guest');
    // Anchor two days in the past: the first occurrence has already happened,
    // so the next one (five days out) is due.
    const anchor = Date.now() - 2 * DAY_MS;
    const first = await createWeeklyNight(host, {
      startsAt: anchor,
      inviteUserIds: [guestId],
      format: 'commander',
    });
    // The template evolves by editing the current night.
    await request(app)
      .patch(`/api/game-nights/${first.id}`)
      .set('Cookie', host)
      .send({ title: 'Renamed weekly', location: 'New spot' });

    const nights = await listNights(host);
    const occurrence = nights.find((n) => n.series?.token === first.series!.token);
    expect(occurrence).toBeDefined();
    expect(occurrence!.id).not.toBe(first.id);
    expect(occurrence!.token).not.toBe(first.token);
    expect(occurrence!.startsAt).toBe(anchor + WEEK_MS);
    // Copied template fields + invites, and the host is auto-going again.
    expect(occurrence!.title).toBe('Renamed weekly');
    expect(occurrence!.location).toBe('New spot');
    expect(occurrence!.format).toBe('commander');
    expect(occurrence!.awaiting).toEqual(['gn-rec-mat-guest']);
    expect(occurrence!.myStatus).toBe('going');

    // Idempotent: a second read doesn't mint a second occurrence.
    const again = await listNights(host);
    expect(again.filter((n) => n.series?.token === first.series!.token)).toHaveLength(1);

    // The invited friend sees the new week too (their read also materializes).
    const guestNights = await listNights(guest);
    expect(guestNights.some((n) => n.id === occurrence!.id)).toBe(true);
  });

  it('skipping a week: cancelling the upcoming occurrence materializes the following one', async () => {
    const host = await makeUser('gn-rec-skip');
    const night = await createWeeklyNight(host, { startsAt: Date.now() + DAY_MS });
    await request(app).delete(`/api/game-nights/${night.id}`).set('Cookie', host);

    const nights = await listNights(host);
    const mine = nights.filter((n) => n.series?.token === night.series!.token);
    expect(mine).toHaveLength(2); // the skipped week (still visible) + next week
    const next = mine.find((n) => n.cancelledAt === null);
    expect(next).toBeDefined();
    expect(next!.startsAt).toBe(night.startsAt + WEEK_MS);

    // The pinned series link points past the skipped week at the live one.
    const resolved = await request(app).get(
      `/api/game-nights/public/series/${night.series!.token}`
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.nightToken).toBe(next!.token);
  });

  it('the public series link 404s for unknown tokens and materializes without auth', async () => {
    expect((await request(app).get('/api/game-nights/public/series/nope')).status).toBe(404);

    const host = await makeUser('gn-rec-public');
    const night = await createWeeklyNight(host, { startsAt: Date.now() - 2 * DAY_MS });
    // No host list-read happened — the guest's pinned link does the work.
    const resolved = await request(app).get(
      `/api/game-nights/public/series/${night.series!.token}`
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.nightToken).not.toBe(night.token);
    const pub = await request(app).get(`/api/game-nights/public/${resolved.body.nightToken}`);
    expect(pub.status).toBe(200);
    expect(pub.body.night.startsAt).toBe(night.startsAt + WEEK_MS);
    expect(pub.body.night.series.token).toBe(night.series!.token);
  });

  it('stop repeating: 204 once then 404, non-host 404s, and no new weeks materialize', async () => {
    const host = await makeUser('gn-rec-end');
    const other = await makeUser('gn-rec-end-other');
    // Past anchor, so a live series would materialize on read — an ended one must not.
    const night = await createWeeklyNight(host, { startsAt: Date.now() - 2 * DAY_MS });
    const seriesId = night.series!.id;
    expect(
      (await request(app).delete(`/api/game-nights/series/${seriesId}`).set('Cookie', other)).status
    ).toBe(404);
    expect(
      (await request(app).delete(`/api/game-nights/series/${seriesId}`).set('Cookie', host)).status
    ).toBe(204);
    expect(
      (await request(app).delete(`/api/game-nights/series/${seriesId}`).set('Cookie', host)).status
    ).toBe(404);

    // The link never dies: it resolves to the last night instead of minting new ones.
    const resolved = await request(app).get(
      `/api/game-nights/public/series/${night.series!.token}`
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.nightToken).toBe(night.token);
  });

  it('plusWeek holds the wall-clock steady across DST and is a plain week without a timezone', () => {
    const t = Date.UTC(2026, 0, 6, 19, 0);
    expect(plusWeek(t, null)).toBe(t + WEEK_MS);
    // US fall-back (Nov 1 2026): Fri Oct 30 19:00 CDT → Fri Nov 6 19:00 CST.
    const beforeFallBack = Date.UTC(2026, 9, 31, 0, 0); // Oct 30 19:00 in UTC-5
    expect(plusWeek(beforeFallBack, 'America/Chicago')).toBe(Date.UTC(2026, 10, 7, 1, 0));
    // US spring-forward (Mar 8 2026): Fri Mar 6 19:00 CST → Fri Mar 13 19:00 CDT.
    const beforeSpring = Date.UTC(2026, 2, 7, 1, 0); // Mar 6 19:00 in UTC-6
    expect(plusWeek(beforeSpring, 'America/Chicago')).toBe(Date.UTC(2026, 2, 14, 0, 0));
  });
});

describe('POST /api/game-nights/:id/poll (open a date vote on an existing night)', () => {
  it('404s for a non-host, validates options, and rejects an already-polling night', async () => {
    const host = await makeUser('gn-openpoll-host');
    const other = await makeUser('gn-openpoll-other');
    const { id } = await createNight(host);
    const base = IN_A_WEEK();
    expect(
      (
        await request(app)
          .post(`/api/game-nights/${id}/poll`)
          .set('Cookie', other)
          .send({ options: [base, base + DAY_MS] })
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/game-nights/${id}/poll`)
          .set('Cookie', host)
          .send({
            options: [base],
          })
      ).status
    ).toBe(400);
    const opened = await request(app)
      .post(`/api/game-nights/${id}/poll`)
      .set('Cookie', host)
      .send({ options: [base, base + DAY_MS] });
    expect(opened.status).toBe(201);
    const again = await request(app)
      .post(`/api/game-nights/${id}/poll`)
      .set('Cookie', host)
      .send({ options: [base, base + DAY_MS] });
    expect(again.status).toBe(400);
  });

  it('rejects opening a vote on a cancelled night (400)', async () => {
    const host = await makeUser('gn-openpoll-cancelled');
    const { id } = await createNight(host);
    await request(app).delete(`/api/game-nights/${id}`).set('Cookie', host);
    const base = IN_A_WEEK();
    const res = await request(app)
      .post(`/api/game-nights/${id}/poll`)
      .set('Cookie', host)
      .send({ options: [base, base + DAY_MS] });
    expect(res.status).toBe(400);
  });

  it('flips the night to polling with the invariant startsAt, and the E124 flow composes', async () => {
    const host = await makeUser('gn-openpoll-flow');
    const { id, token } = await createNight(host);
    const base = IN_A_WEEK();
    const opened = await request(app)
      .post(`/api/game-nights/${id}/poll`)
      .set('Cookie', host)
      .send({ options: [base, base + DAY_MS] });
    expect(opened.status).toBe(201);
    expect(opened.body.night.options).toHaveLength(2);
    // The polling invariant: startsAt mirrors the latest candidate.
    expect(opened.body.night.startsAt).toBe(base + DAY_MS);

    // Plain RSVPs are blocked while polling; votes + lock-in work unchanged.
    const rsvp = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Pat' });
    expect(rsvp.status).toBe(400);
    const optionId = opened.body.night.options[0].id as string;
    const vote = await request(app)
      .post(`/api/game-nights/public/${token}/votes`)
      .send({ optionIds: [optionId], displayName: 'Pat' });
    expect(vote.status).toBe(200);
    const locked = await request(app)
      .post(`/api/game-nights/${id}/lock`)
      .set('Cookie', host)
      .send({ optionId });
    expect(locked.status).toBe(200);
    expect(locked.body.night.startsAt).toBe(base);
    expect(locked.body.night.options).toEqual([]);
  });
});

describe('lookupGameNightSeriesLandingMeta', () => {
  it('unfurls the current occurrence flagged as weekly, at the series URL', async () => {
    const host = await makeUser('gn-og-series');
    const night = await createWeeklyNight(host, { title: 'Tuesday commander' });
    const meta = await lookupGameNightSeriesLandingMeta(night.series!.token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('Tuesday commander — hosted by gn-og-series');
    expect(meta!.description).toContain('Repeats weekly.');
    expect(meta!.url).toContain(`/gn/s/${night.series!.token}`);
  });

  it('returns null for an unknown token', async () => {
    expect(await lookupGameNightSeriesLandingMeta('nope')).toBeNull();
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

  it('unfurls a polling night as a date vote, not a confidently wrong time', async () => {
    const host = await makeUser('gn-og-poll');
    const night = await createPollNight(host);
    const meta = await lookupGameNightLandingMeta(night.token);
    expect(meta!.description).toContain('Voting on a date');
    expect(meta!.description).toContain('3 times proposed');
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

describe('invite-only nights', () => {
  it('gates guest and uninvited-user RSVPs (403) but lets invited friends reply', async () => {
    const host = await makeUser('gn-io-host');
    const friendCookie = await makeUser('gn-io-friend');
    const strangerCookie = await makeUser('gn-io-stranger');
    await befriend(host, 'gn-io-friend', friendCookie, 'gn-io-host');
    const friendId = await friendIdOf(host, 'gn-io-friend');
    const { token } = await createNight(host, {
      inviteOnly: true,
      inviteUserIds: [friendId],
    });

    const guest = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Pat' });
    expect(guest.status).toBe(403);

    const stranger = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', strangerCookie)
      .send({ status: 'going' });
    expect(stranger.status).toBe(403);

    const friend = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', friendCookie)
      .send({ status: 'going' });
    expect(friend.status).toBe(200);
  });

  it('a guest who joined before the toggle keeps their credential after it flips on', async () => {
    const host = await makeUser('gn-io-flip');
    const { id, token } = await createNight(host);
    const joined = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Pat' });
    expect(joined.status).toBe(201);
    const rsvpId = joined.body.rsvp.id as string;

    const patched = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', host)
      .send({ inviteOnly: true });
    expect(patched.status).toBe(200);
    expect(patched.body.night.inviteOnly).toBe(true);

    const update = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'maybe', rsvpId });
    expect(update.status).toBe(200);

    const newcomer = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Riley' });
    expect(newcomer.status).toBe(403);
  });

  it('rejects a non-boolean inviteOnly patch (400)', async () => {
    const host = await makeUser('gn-io-badpatch');
    const { id } = await createNight(host);
    const res = await request(app)
      .patch(`/api/game-nights/${id}`)
      .set('Cookie', host)
      .send({ inviteOnly: 'yes' });
    expect(res.status).toBe(400);
  });

  it('gates poll votes and suggestions the same way', async () => {
    const host = await makeUser('gn-io-poll');
    const night = await createPollNight(host, undefined, { inviteOnly: true });
    const vote = await request(app)
      .post(`/api/game-nights/public/${night.token}/votes`)
      .send({ optionIds: [night.options[0].id], displayName: 'Pat' });
    expect(vote.status).toBe(403);
    const suggest = await request(app)
      .post(`/api/game-nights/public/${night.token}/options`)
      .send({ startsAt: SLOT_A() + 5 * 86_400_000, displayName: 'Pat' });
    expect(suggest.status).toBe(403);
  });

  it('public read exposes inviteOnly and per-caller canRsvp', async () => {
    const host = await makeUser('gn-io-read');
    const { token } = await createNight(host, { inviteOnly: true });
    const anon = await request(app).get(`/api/game-nights/public/${token}`);
    expect(anon.body.night.inviteOnly).toBe(true);
    expect(anon.body.canRsvp).toBe(false);
    const asHost = await request(app).get(`/api/game-nights/public/${token}`).set('Cookie', host);
    expect(asHost.body.canRsvp).toBe(true);

    const open = await createNight(host);
    const openRead = await request(app).get(`/api/game-nights/public/${open.token}`);
    expect(openRead.body.night.inviteOnly).toBe(false);
    expect(openRead.body.canRsvp).toBe(true);
  });
});

describe('DELETE /api/game-nights/:id/rsvps/:rsvpId (host removes an attendee)', () => {
  it('removes a guest RSVP; non-hosts get 404; the host row is protected (400)', async () => {
    const host = await makeUser('gn-rm-host');
    const other = await makeUser('gn-rm-other');
    const { id, token } = await createNight(host);
    const joined = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Pat' });
    const guestRsvpId = joined.body.rsvp.id as string;

    const notHost = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${guestRsvpId}`)
      .set('Cookie', other);
    expect(notHost.status).toBe(404);

    const removed = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${guestRsvpId}`)
      .set('Cookie', host);
    expect(removed.status).toBe(204);
    const after = await request(app).get(`/api/game-nights/public/${token}`);
    expect(after.body.rsvps).toHaveLength(1); // just the host

    const list = await request(app).get('/api/game-nights').set('Cookie', host);
    const mine = list.body.nights.find((n: { id: string }) => n.id === id);
    const hostRsvpId = mine.rsvps[0].id as string;
    const self = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${hostRsvpId}`)
      .set('Cookie', host);
    expect(self.status).toBe(400);

    const unknown = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${guestRsvpId}`)
      .set('Cookie', host);
    expect(unknown.status).toBe(404);
  });

  it("removing an invited friend's RSVP also revokes their invite", async () => {
    const host = await makeUser('gn-rm-friend-host');
    const friendCookie = await makeUser('gn-rm-friend');
    await befriend(host, 'gn-rm-friend', friendCookie, 'gn-rm-friend-host');
    const friendId = await friendIdOf(host, 'gn-rm-friend');
    const { id, token } = await createNight(host, { inviteUserIds: [friendId] });
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', friendCookie)
      .send({ status: 'going' });

    const list = await request(app).get('/api/game-nights').set('Cookie', host);
    const mine = list.body.nights.find((n: { id: string }) => n.id === id);
    const friendRsvp = mine.rsvps.find(
      (r: { displayName: string }) => r.displayName === 'gn-rm-friend'
    );
    const removed = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${friendRsvp.id}`)
      .set('Cookie', host);
    expect(removed.status).toBe(204);

    // Invite gone too: not back in awaiting, and the night left their list.
    const hostList = await request(app).get('/api/game-nights').set('Cookie', host);
    const hostView = hostList.body.nights.find((n: { id: string }) => n.id === id);
    expect(hostView.awaiting).toEqual([]);
    const friendList = await request(app).get('/api/game-nights').set('Cookie', friendCookie);
    expect(friendList.body.nights.find((n: { id: string }) => n.id === id)).toBeUndefined();
  });
});

describe('DELETE /api/game-nights/:id/invites/:username (host un-invites)', () => {
  it('removes a pending invite; unknown usernames 404; non-hosts 404', async () => {
    const host = await makeUser('gn-uninv-host');
    const friendCookie = await makeUser('gn-uninv-friend');
    await befriend(host, 'gn-uninv-friend', friendCookie, 'gn-uninv-host');
    const friendId = await friendIdOf(host, 'gn-uninv-friend');
    const { id } = await createNight(host, { inviteUserIds: [friendId] });

    const notHost = await request(app)
      .delete(`/api/game-nights/${id}/invites/gn-uninv-friend`)
      .set('Cookie', friendCookie);
    expect(notHost.status).toBe(404);

    const removed = await request(app)
      .delete(`/api/game-nights/${id}/invites/gn-uninv-friend`)
      .set('Cookie', host);
    expect(removed.status).toBe(204);
    const list = await request(app).get('/api/game-nights').set('Cookie', host);
    const mine = list.body.nights.find((n: { id: string }) => n.id === id);
    expect(mine.awaiting).toEqual([]);

    const again = await request(app)
      .delete(`/api/game-nights/${id}/invites/gn-uninv-friend`)
      .set('Cookie', host);
    expect(again.status).toBe(404);
  });
});

describe('block on remove (host blocks an attendee)', () => {
  it('blocked account gets 403 on rsvp/votes, public canRsvp is false, and only the host sees the blocked list', async () => {
    const host = await makeUser('gn-block-host');
    const target = await makeUser('gn-block-target');
    const other = await makeUser('gn-block-other');
    const { id, token } = await createNight(host);
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', target)
      .send({ status: 'going' });
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', other)
      .send({ status: 'going' });

    const before = await request(app).get('/api/game-nights').set('Cookie', host);
    const targetRsvpId = before.body.nights
      .find((n: { id: string }) => n.id === id)
      .rsvps.find((r: { displayName: string }) => r.displayName === 'gn-block-target').id;

    const blockRes = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${targetRsvpId}?block=1`)
      .set('Cookie', host);
    expect(blockRes.status).toBe(204);

    const reRsvp = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', target)
      .send({ status: 'going' });
    expect(reRsvp.status).toBe(403);
    expect(reRsvp.body.error).toBe("You can't reply to this game night.");

    const pub = await request(app).get(`/api/game-nights/public/${token}`).set('Cookie', target);
    expect(pub.body.canRsvp).toBe(false);

    const hostAfter = await request(app).get('/api/game-nights').set('Cookie', host);
    expect(hostAfter.body.nights.find((n: { id: string }) => n.id === id).blocked).toEqual([
      'gn-block-target',
    ]);

    // A non-host attendee never sees the blocked list.
    const otherAfter = await request(app).get('/api/game-nights').set('Cookie', other);
    expect(otherAfter.body.nights.find((n: { id: string }) => n.id === id).blocked).toEqual([]);

    // Votes are refused too, once blocked on a polling night they already have an rsvp row on.
    const poll = await createPollNight(host);
    await request(app)
      .post(`/api/game-nights/public/${poll.token}/votes`)
      .set('Cookie', target)
      .send({ optionIds: [] });
    const pollHostView = await request(app).get('/api/game-nights').set('Cookie', host);
    const pollTargetRsvpId = pollHostView.body.nights
      .find((n: { id: string }) => n.id === poll.id)
      .rsvps.find((r: { displayName: string }) => r.displayName === 'gn-block-target').id;
    await request(app)
      .delete(`/api/game-nights/${poll.id}/rsvps/${pollTargetRsvpId}?block=1`)
      .set('Cookie', host);
    const vote = await request(app)
      .post(`/api/game-nights/public/${poll.token}/votes`)
      .set('Cookie', target)
      .send({ optionIds: [poll.options[0].id] });
    expect(vote.status).toBe(403);
    expect(vote.body.error).toBe("You can't reply to this game night.");
  });

  it('refuses to block a guest rsvp (400) and leaves the guest row in place', async () => {
    const host = await makeUser('gn-block-guest-host');
    const { id, token } = await createNight(host);
    const joined = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Casual Casey' });
    const guestRsvpId = joined.body.rsvp.id as string;

    const res = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${guestRsvpId}?block=1`)
      .set('Cookie', host);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Guests can't be blocked — make the night invite-only instead.");

    const pub = await request(app).get(`/api/game-nights/public/${token}`);
    expect(
      pub.body.rsvps.some((r: { displayName: string }) => r.displayName === 'Casual Casey')
    ).toBe(true);
  });

  it('unblocking lets the account rejoin and drops them from the blocked list', async () => {
    const host = await makeUser('gn-unblock-host');
    const target = await makeUser('gn-unblock-target');
    const { id, token } = await createNight(host);
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', target)
      .send({ status: 'going' });
    const before = await request(app).get('/api/game-nights').set('Cookie', host);
    const targetRsvpId = before.body.nights
      .find((n: { id: string }) => n.id === id)
      .rsvps.find((r: { displayName: string }) => r.displayName === 'gn-unblock-target').id;
    await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${targetRsvpId}?block=1`)
      .set('Cookie', host);

    const unblocked = await request(app)
      .delete(`/api/game-nights/${id}/blocks/gn-unblock-target`)
      .set('Cookie', host);
    expect(unblocked.status).toBe(204);

    const rejoin = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', target)
      .send({ status: 'maybe' });
    expect(rejoin.status).toBe(200);

    const after = await request(app).get('/api/game-nights').set('Cookie', host);
    expect(after.body.nights.find((n: { id: string }) => n.id === id).blocked).toEqual([]);
  });

  it('unblocking an unknown username 404s; non-host block/unblock both 404', async () => {
    const host = await makeUser('gn-block-404-host');
    const other = await makeUser('gn-block-404-other');
    const { id, token } = await createNight(host);
    await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .set('Cookie', other)
      .send({ status: 'going' });

    const unknownUnblock = await request(app)
      .delete(`/api/game-nights/${id}/blocks/nobody-here`)
      .set('Cookie', host);
    expect(unknownUnblock.status).toBe(404);

    const list = await request(app).get('/api/game-nights').set('Cookie', host);
    const otherRsvpId = list.body.nights
      .find((n: { id: string }) => n.id === id)
      .rsvps.find((r: { displayName: string }) => r.displayName === 'gn-block-404-other').id;

    const nonHostBlock = await request(app)
      .delete(`/api/game-nights/${id}/rsvps/${otherRsvpId}?block=1`)
      .set('Cookie', other);
    expect(nonHostBlock.status).toBe(404);

    const nonHostUnblock = await request(app)
      .delete(`/api/game-nights/${id}/blocks/gn-block-404-other`)
      .set('Cookie', other);
    expect(nonHostUnblock.status).toBe(404);
  });

  it('a blocked account stays blocked on the next materialized weekly occurrence', async () => {
    const host = await makeUser('gn-block-weekly-host');
    const target = await makeUser('gn-block-weekly-target');
    // Just past due (so the next occurrence is due to materialize) but still
    // inside the reply grace window, so the RSVP below is accepted.
    const anchor = Date.now() - 60_000;
    const first = await createWeeklyNight(host, { startsAt: anchor });
    await request(app)
      .post(`/api/game-nights/public/${first.token}/rsvp`)
      .set('Cookie', target)
      .send({ status: 'going' });
    // Read via PATCH-by-id (not GET /, which would materialize the next
    // occurrence prematurely — before the block below has a row to carry).
    const patched = await request(app)
      .patch(`/api/game-nights/${first.id}`)
      .set('Cookie', host)
      .send({});
    const targetRsvpId = patched.body.night.rsvps.find(
      (r: { displayName: string }) => r.displayName === 'gn-block-weekly-target'
    ).id;
    await request(app)
      .delete(`/api/game-nights/${first.id}/rsvps/${targetRsvpId}?block=1`)
      .set('Cookie', host);

    const nights = await listNights(host);
    const occurrence = nights.find(
      (n) => n.series?.token === first.series!.token && n.id !== first.id
    )!;
    expect(occurrence.blocked).toEqual(['gn-block-weekly-target']);

    const reRsvp = await request(app)
      .post(`/api/game-nights/public/${occurrence.token}/rsvp`)
      .set('Cookie', target)
      .send({ status: 'going' });
    expect(reRsvp.status).toBe(403);
  });
});

describe('DELETE /api/game-nights/:id?hard=1 (host deletes outright)', () => {
  it('deletes the night for everyone — the link 404s and the list forgets it', async () => {
    const host = await makeUser('gn-del-host');
    const other = await makeUser('gn-del-other');
    const { id, token } = await createNight(host);

    const notHost = await request(app).delete(`/api/game-nights/${id}?hard=1`).set('Cookie', other);
    expect(notHost.status).toBe(404);

    const deleted = await request(app).delete(`/api/game-nights/${id}?hard=1`).set('Cookie', host);
    expect(deleted.status).toBe(204);
    const read = await request(app).get(`/api/game-nights/public/${token}`);
    expect(read.status).toBe(404);
    const list = await request(app).get('/api/game-nights').set('Cookie', host);
    expect(list.body.nights.find((n: { id: string }) => n.id === id)).toBeUndefined();
  });

  it('also deletes an already-cancelled night', async () => {
    const host = await makeUser('gn-del-cancelled');
    const { id, token } = await createNight(host);
    await request(app).delete(`/api/game-nights/${id}`).set('Cookie', host);
    const deleted = await request(app).delete(`/api/game-nights/${id}?hard=1`).set('Cookie', host);
    expect(deleted.status).toBe(204);
    const read = await request(app).get(`/api/game-nights/public/${token}`);
    expect(read.status).toBe(404);
  });

  it('refuses to delete a live weekly occurrence (400) — skip or stop instead', async () => {
    const host = await makeUser('gn-del-weekly');
    const res = await request(app)
      .post('/api/game-nights')
      .set('Cookie', host)
      .send({ title: 'Weekly', startsAt: IN_A_WEEK(), repeatsWeekly: true });
    expect(res.status).toBe(201);
    const refused = await request(app)
      .delete(`/api/game-nights/${res.body.night.id}?hard=1`)
      .set('Cookie', host);
    expect(refused.status).toBe(400);
  });
});
