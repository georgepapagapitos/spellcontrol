import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

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
/** One createTestEnv() is shared by the whole file, so usernames must be
 *  collision-proof (mirrors activity.test.ts's own uid()). */
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

interface TestUser {
  cookie: string;
  username: string;
  id: string;
}

async function makeUser(prefix: string): Promise<TestUser> {
  const username = uid(prefix);
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return {
    cookie: extractSessionCookie(reg.headers['set-cookie'])!,
    username,
    id: reg.body.user.id as string,
  };
}

/** A requests B, then B's reverse request auto-accepts (see friends.ts). */
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
const RHYSTIC = {
  oracleId: 'oracle-rhystic',
  name: 'Rhystic Study',
  quantity: 1,
  copies: [],
};

/** The recipient's accept payload: same shape as what was asked for, with
 *  printings stamped on. */
const RHYSTIC_RESOLVED = {
  oracleId: 'oracle-rhystic',
  name: 'Rhystic Study',
  quantity: 1,
  copies: [{ scryfallId: 'scry-rhystic-jud', finish: 'foil' }],
};

async function propose(
  from: TestUser,
  to: TestUser,
  body: Record<string, unknown> = {}
): Promise<request.Response> {
  return request(app)
    .post('/api/trades')
    .set('Cookie', from.cookie)
    .send({ recipientId: to.id, give: [SOL_RING], receive: [RHYSTIC], ...body });
}

describe('POST /api/trades', () => {
  it('creates an offer between friends and names the sides from each viewpoint', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);

    const res = await propose(alice, bob, { note: 'trade at Thursday night?' });
    expect(res.status).toBe(201);
    expect(res.body.offer.mine).toBe(true);
    expect(res.body.offer.status).toBe('proposed');
    expect(res.body.offer.note).toBe('trade at Thursday night?');
    // Proposer's view: give = what they hand over.
    expect(res.body.offer.give[0].name).toBe('Sol Ring');
    expect(res.body.offer.receive[0].name).toBe('Rhystic Study');
    expect(res.body.offer.settled).toBe(false);

    // Recipient's view of the SAME offer is the mirror image.
    const theirs = await request(app).get('/api/trades').set('Cookie', bob.cookie);
    expect(theirs.status).toBe(200);
    const mirrored = theirs.body.offers.find((o: { id: string }) => o.id === res.body.offer.id);
    expect(mirrored.mine).toBe(false);
    expect(mirrored.give[0].name).toBe('Rhystic Study');
    expect(mirrored.receive[0].name).toBe('Sol Ring');
    expect(mirrored.counterpartyUsername).toBe(alice.username);
  });

  it('rejects an offer to a non-friend', async () => {
    const alice = await makeUser('alice');
    const stranger = await makeUser('stranger');
    const res = await propose(alice, stranger);
    expect(res.status).toBe(403);
  });

  it('rejects an offer to yourself', async () => {
    const alice = await makeUser('alice');
    const res = await propose(alice, alice);
    expect(res.status).toBe(400);
  });

  it('requires the proposer side to name a printing per copy', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    // quantity 2 but only one copy named — the far end could not settle this.
    const res = await propose(alice, bob, {
      give: [{ ...SOL_RING, quantity: 2 }],
    });
    expect(res.status).toBe(400);
  });

  it('accepts an oracle-level ask (the recipient resolves printings later)', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const res = await propose(alice, bob, { receive: [{ ...RHYSTIC, quantity: 3 }] });
    expect(res.status).toBe(201);
    expect(res.body.offer.receive[0].quantity).toBe(3);
  });

  it('rejects an empty trade', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const res = await propose(alice, bob, { give: [], receive: [] });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate card lines on one side', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const res = await propose(alice, bob, { give: [SOL_RING, SOL_RING] });
    expect(res.status).toBe(400);
  });

  it('rejects a quantity over the per-line cap', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const res = await propose(alice, bob, { receive: [{ ...RHYSTIC, quantity: 21 }] });
    expect(res.status).toBe(400);
  });

  it('rejects more lines than the per-side cap', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const many = Array.from({ length: 41 }, (_, i) => ({
      oracleId: `oracle-${i}`,
      name: `Card ${i}`,
      quantity: 1,
      copies: [],
    }));
    const res = await propose(alice, bob, { receive: many });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/trades', () => {
  it('never shows an offer between two other people', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const nosy = await makeUser('nosy');
    await befriend(alice, bob);
    const created = await propose(alice, bob);
    expect(created.status).toBe(201);

    const res = await request(app).get('/api/trades').set('Cookie', nosy.cookie);
    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(0);
  });

  it('filters to one counterparty with ?withUserId', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const carol = await makeUser('carol');
    await befriend(alice, bob);
    await befriend(alice, carol);
    await propose(alice, bob);
    await propose(alice, carol);

    const res = await request(app)
      .get(`/api/trades?withUserId=${bob.id}`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(1);
    expect(res.body.offers[0].counterpartyId).toBe(bob.id);
  });

  it('reports an un-truncated list honestly', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    await propose(alice, bob);

    const res = await request(app).get('/api/trades').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
  });

  it('flags truncation when more offers exist than the cap returns', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    // MAX_LISTED is 100, so 101 offers is the first list that must admit it is
    // cut. Without the flag the client cannot tell "exactly 100" from "more
    // than 100, silently dropped" — and /trades' history only ever grows.
    for (let i = 0; i < 101; i++) await propose(alice, bob);

    const res = await request(app).get('/api/trades').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(100);
    expect(res.body.truncated).toBe(true);
  });
});

describe('PATCH /api/trades/:id', () => {
  async function setup(): Promise<{ alice: TestUser; bob: TestUser; offerId: string }> {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const created = await propose(alice, bob);
    expect(created.status).toBe(201);
    return { alice, bob, offerId: created.body.offer.id as string };
  }

  it('lets the recipient accept, stamping the printings they are giving', async () => {
    const { alice, bob, offerId } = await setup();
    const res = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'accept', resolved: [RHYSTIC_RESOLVED] });
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('accepted');

    // The proposer now sees the real printing on the card coming to them.
    const theirs = await request(app)
      .get(`/api/trades?withUserId=${bob.id}`)
      .set('Cookie', alice.cookie);
    expect(theirs.body.offers[0].receive[0].copies[0].scryfallId).toBe('scry-rhystic-jud');
    expect(theirs.body.offers[0].receive[0].copies[0].finish).toBe('foil');
  });

  it('refuses an accept that changes the deal', async () => {
    const { bob, offerId } = await setup();
    const res = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({
        action: 'accept',
        resolved: [
          {
            ...RHYSTIC_RESOLVED,
            quantity: 2,
            copies: [
              { scryfallId: 'scry-rhystic-jud', finish: 'foil' },
              { scryfallId: 'scry-rhystic-jud', finish: 'nonfoil' },
            ],
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('refuses an accept that names a card never asked for', async () => {
    const { bob, offerId } = await setup();
    const res = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({
        action: 'accept',
        resolved: [
          {
            oracleId: 'oracle-something-else',
            name: 'Swamp',
            quantity: 1,
            copies: [{ scryfallId: 'scry-swamp', finish: 'nonfoil' }],
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('does not let the proposer accept their own offer', async () => {
    const { alice, offerId } = await setup();
    const res = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', alice.cookie)
      .send({ action: 'accept', resolved: [RHYSTIC_RESOLVED] });
    expect(res.status).toBe(403);
  });

  it('does not let the recipient withdraw', async () => {
    const { bob, offerId } = await setup();
    const res = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'withdraw' });
    expect(res.status).toBe(403);
  });

  it('does not let the proposer decline', async () => {
    const { alice, offerId } = await setup();
    const res = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', alice.cookie)
      .send({ action: 'decline' });
    expect(res.status).toBe(403);
  });

  it('409s the second answer — accept then withdraw cannot both win', async () => {
    const { alice, bob, offerId } = await setup();
    const accepted = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'accept', resolved: [RHYSTIC_RESOLVED] });
    expect(accepted.status).toBe(200);

    const late = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', alice.cookie)
      .send({ action: 'withdraw' });
    expect(late.status).toBe(409);

    // And the accept stands.
    const after = await request(app).get('/api/trades').set('Cookie', alice.cookie);
    expect(after.body.offers[0].status).toBe('accepted');
  });

  it('409s a double accept', async () => {
    const { bob, offerId } = await setup();
    const first = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'accept', resolved: [RHYSTIC_RESOLVED] });
    expect(first.status).toBe(200);
    const second = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'accept', resolved: [RHYSTIC_RESOLVED] });
    expect(second.status).toBe(409);
  });

  it('lets the recipient decline', async () => {
    const { bob, offerId } = await setup();
    const res = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'decline' });
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('declined');
  });

  it('404s an offer the caller is not a party to, same as one that never existed', async () => {
    const { offerId } = await setup();
    const nosy = await makeUser('nosy');
    const real = await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', nosy.cookie)
      .send({ action: 'decline' });
    const fake = await request(app)
      .patch('/api/trades/00000000-0000-0000-0000-000000000000')
      .set('Cookie', nosy.cookie)
      .send({ action: 'decline' });
    expect(real.status).toBe(404);
    expect(fake.status).toBe(404);
    expect(real.body).toEqual(fake.body);
  });
});

describe('POST /api/trades/:id/settled', () => {
  async function accepted(): Promise<{ alice: TestUser; bob: TestUser; offerId: string }> {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const created = await propose(alice, bob);
    const offerId = created.body.offer.id as string;
    await request(app)
      .patch(`/api/trades/${offerId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'accept', resolved: [RHYSTIC_RESOLVED] });
    return { alice, bob, offerId };
  }

  it('marks only the calling side, and is idempotent', async () => {
    const { alice, bob, offerId } = await accepted();

    const first = await request(app)
      .post(`/api/trades/${offerId}/settled`)
      .set('Cookie', alice.cookie);
    expect(first.status).toBe(200);
    expect(first.body.offer.settled).toBe(true);

    // Re-reporting is a no-op, not an error — the client calls this after a
    // settlement it may replay.
    const again = await request(app)
      .post(`/api/trades/${offerId}/settled`)
      .set('Cookie', alice.cookie);
    expect(again.status).toBe(200);
    expect(again.body.offer.settled).toBe(true);

    // The other side is untouched: settling is per-person.
    const theirs = await request(app).get('/api/trades').set('Cookie', bob.cookie);
    expect(theirs.body.offers[0].settled).toBe(false);
  });

  it('409s on an offer that was never accepted', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await befriend(alice, bob);
    const created = await propose(alice, bob);
    const res = await request(app)
      .post(`/api/trades/${created.body.offer.id}/settled`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(409);
  });
});
