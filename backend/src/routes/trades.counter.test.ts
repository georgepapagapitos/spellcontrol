import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

const { mockNotifyUser } = vi.hoisted(() => ({ mockNotifyUser: vi.fn(() => Promise.resolve()) }));
vi.mock('../notify', () => ({ notifyUser: mockNotifyUser }));

let app: Server;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

let seq = 0;
interface TestUser {
  cookie: string;
  username: string;
  id: string;
}

async function makeUser(prefix: string): Promise<TestUser> {
  seq += 1;
  const username = `${prefix}-c${seq}`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  return {
    cookie: extractSessionCookie(reg.headers['set-cookie'])!,
    username,
    id: reg.body.user.id as string,
  };
}

async function befriend(a: TestUser, b: TestUser): Promise<void> {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', a.cookie)
    .send({ username: b.username });
  const auto = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', b.cookie)
    .send({ username: a.username });
  expect(auto.body.friendStatus).toBe('friends');
}

const SOL_RING = {
  oracleId: 'oracle-sol-ring',
  name: 'Sol Ring',
  quantity: 1,
  copies: [{ scryfallId: 'scry-sol-ring-c21', finish: 'nonfoil', condition: 'NM' }],
};
const RHYSTIC = { oracleId: 'oracle-rhystic', name: 'Rhystic Study', quantity: 1, copies: [] };
const BOLT = {
  oracleId: 'oracle-bolt',
  name: 'Lightning Bolt',
  quantity: 2,
  copies: [
    { scryfallId: 'scry-bolt-a', finish: 'nonfoil' },
    { scryfallId: 'scry-bolt-b', finish: 'foil' },
  ],
};

/** alice proposes to bob; bob will be the one countering. */
async function setup(): Promise<{ alice: TestUser; bob: TestUser; offerId: string }> {
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  await befriend(alice, bob);
  const created = await request(app)
    .post('/api/trades')
    .set('Cookie', alice.cookie)
    .send({ recipientId: bob.id, give: [SOL_RING], receive: [RHYSTIC] });
  expect(created.status).toBe(201);
  return { alice, bob, offerId: created.body.offer.id as string };
}

function counter(who: TestUser, offerId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/trades/${offerId}/counter`)
    .set('Cookie', who.cookie)
    .send({ give: [BOLT], receive: [SOL_RING], note: '  how about this  ', ...body });
}

async function listFor(who: TestUser): Promise<Array<{ id: string; status: string }>> {
  const res = await request(app).get('/api/trades').set('Cookie', who.cookie);
  return res.body.offers;
}

async function statusOf(who: TestUser, id: string): Promise<string | undefined> {
  return (await listFor(who)).find((o) => o.id === id)?.status;
}

describe('POST /api/trades/:id/counter', () => {
  it('declines the original and creates the counter in one call, viewer-correct', async () => {
    const { alice, bob, offerId } = await setup();
    mockNotifyUser.mockClear();

    const res = await counter(bob, offerId);
    expect(res.status).toBe(201);
    expect(res.body.declinedId).toBe(offerId);
    const offer = res.body.offer;
    expect(offer.id).not.toBe(offerId);
    expect(offer.mine).toBe(true);
    expect(offer.status).toBe('proposed');
    expect(offer.note).toBe('how about this');
    expect(offer.counterpartyId).toBe(alice.id);
    expect(offer.give[0].name).toBe('Lightning Bolt');
    expect(offer.receive[0].name).toBe('Sol Ring');

    expect(await statusOf(bob, offerId)).toBe('declined');

    // The original proposer sees the counter as an incoming offer, mirrored.
    const theirs = (await request(app).get('/api/trades').set('Cookie', alice.cookie)).body
      .offers as Array<{
      id: string;
      mine: boolean;
      status: string;
      give: Array<{ name: string }>;
      receive: Array<{ name: string }>;
    }>;
    const incoming = theirs.find((o) => o.id === offer.id)!;
    expect(incoming.mine).toBe(false);
    expect(incoming.status).toBe('proposed');
    expect(incoming.give[0].name).toBe('Sol Ring');
    expect(incoming.receive[0].name).toBe('Lightning Bolt');

    // Exactly one notification, to the original proposer, for the new offer.
    expect(mockNotifyUser).toHaveBeenCalledTimes(1);
    expect(mockNotifyUser).toHaveBeenCalledWith(
      alice.id,
      'trade_offer',
      expect.objectContaining({ path: '/trades' })
    );
  });

  it('404s a non-party, same as a missing offer', async () => {
    const { offerId } = await setup();
    const carol = await makeUser('carol');
    const stranger = await counter(carol, offerId);
    const missing = await counter(carol, '00000000-0000-0000-0000-000000000000');
    expect(stranger.status).toBe(404);
    expect(stranger.body).toEqual(missing.body);
  });

  it('refuses the original proposer countering their own offer', async () => {
    const { alice, offerId } = await setup();
    const res = await counter(alice, offerId);
    expect(res.status).toBe(403);
    expect(await statusOf(alice, offerId)).toBe('proposed');
  });

  it('409s a counter on an accepted offer and creates nothing', async () => {
    const { alice, bob, offerId } = await setup();
    const acc = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({
        action: 'accept',
        resolved: [{ ...RHYSTIC, copies: [{ scryfallId: 'scry-rhystic-jud', finish: 'foil' }] }],
      });
    expect(acc.status).toBe(200);
    const before = (await listFor(bob)).length;

    const res = await counter(bob, offerId);
    expect(res.status).toBe(409);
    expect((await listFor(bob)).length).toBe(before);
    expect(await statusOf(alice, offerId)).toBe('accepted');
  });

  it('409s a counter on a declined offer', async () => {
    const { bob, offerId } = await setup();
    await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'decline' });
    const before = (await listFor(bob)).length;
    const res = await counter(bob, offerId);
    expect(res.status).toBe(409);
    expect((await listFor(bob)).length).toBe(before);
  });

  it('409s a counter on a withdrawn offer', async () => {
    const { alice, bob, offerId } = await setup();
    await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', alice.cookie)
      .send({ action: 'withdraw' });
    const before = (await listFor(bob)).length;
    const res = await counter(bob, offerId);
    expect(res.status).toBe(409);
    expect((await listFor(bob)).length).toBe(before);
  });

  it('a second counter after the first loses with a 409 and adds no offer', async () => {
    const { bob, offerId } = await setup();
    expect((await counter(bob, offerId)).status).toBe(201);
    const before = (await listFor(bob)).length;
    expect((await counter(bob, offerId)).status).toBe(409);
    expect((await listFor(bob)).length).toBe(before);
  });

  it.each([
    ['empty sides', { give: [], receive: [] }],
    ['a bad oracleId', { give: [{ ...SOL_RING, oracleId: '' }] }],
    ['a quantity over the cap', { give: [{ ...SOL_RING, quantity: 10_000 }] }],
    [
      'more lines than the per-side cap',
      {
        receive: Array.from({ length: 200 }, (_, i) => ({
          oracleId: `o-${i}`,
          name: `Card ${i}`,
          quantity: 1,
          copies: [],
        })),
      },
    ],
    ['a give side with no pinned printings', { give: [RHYSTIC] }],
  ])('400s %s and leaves the original proposed', async (_label, body) => {
    const { bob, offerId } = await setup();
    const before = (await listFor(bob)).length;
    const res = await counter(bob, offerId, body);
    expect(res.status).toBe(400);
    expect(await statusOf(bob, offerId)).toBe('proposed');
    expect((await listFor(bob)).length).toBe(before);
  });

  it('403s once the two are no longer friends and leaves the original untouched', async () => {
    const { alice, bob, offerId } = await setup();
    const unfriend = await request(app)
      .delete(`/api/friends/${alice.id}`)
      .set('Cookie', bob.cookie);
    expect(unfriend.status).toBeLessThan(300);

    const res = await counter(bob, offerId);
    expect(res.status).toBe(403);
    expect(await statusOf(bob, offerId)).toBe('proposed');
  });
});
