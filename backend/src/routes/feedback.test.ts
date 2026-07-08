import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  createTestEnv,
  extractSessionCookie,
  setSnapshotViaSyncApi,
  type SnapshotShape,
} from '../test-helpers';

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

async function setSnapshot(cookie: string, body: SnapshotShape): Promise<number> {
  return setSnapshotViaSyncApi(request(app), cookie, body);
}

function makeDeck(id: string): Record<string, unknown> {
  return {
    id,
    name: 'Edric Combo',
    format: 'commander',
    source: 'manual',
    commander: { id: 'edric-id', name: 'Edric' },
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [
      { slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null },
      { slotId: 's2', card: { id: 'arcane-signet', name: 'Arcane Signet' }, allocatedCopyId: null },
    ],
    sideboard: [],
    generationContext: null,
    color: '#7aa6c2',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

/** Register an owner with one deck and mint a feedback share; returns both. */
async function makeFeedbackShare(
  username: string,
  deckId = 'd-1'
): Promise<{ cookie: string; token: string }> {
  const cookie = await makeUser(username);
  await setSnapshot(cookie, { decks: [makeDeck(deckId)] });
  const create = await request(app)
    .post('/api/shares')
    .set('Cookie', cookie)
    .send({ kind: 'feedback', resourceId: deckId });
  expect(create.status).toBe(201);
  return { cookie, token: create.body.share.token as string };
}

describe('feedback share kind', () => {
  it('mints a feedback share and serves the deck projection under kind=feedback', async () => {
    const { token } = await makeFeedbackShare('fb-owner-view');
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('feedback');
    expect(res.body.data.name).toBe('Edric Combo');
    expect(res.body.data.cards).toHaveLength(2);
  });

  it('is a distinct token from the plain deck share of the same deck', async () => {
    const { cookie, token } = await makeFeedbackShare('fb-owner-distinct');
    const deckShare = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'deck', resourceId: 'd-1' });
    expect(deckShare.body.share.token).not.toBe(token);
  });
});

describe('POST /api/feedback/public/:token', () => {
  it('accepts a guest submission with suggestions and a comment', async () => {
    const { token } = await makeFeedbackShare('fb-owner-guest');
    const res = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({
        authorName: 'Random Redditor',
        comment: 'Cut the slow rock, add a counterspell.',
        bracketSuggestion: 3,
        suggestions: [
          { type: 'cut', cardName: 'Arcane Signet', oracleId: 'sig-oracle' },
          { type: 'add', cardName: 'Counterspell', card: { name: 'Counterspell', cmc: 2 } },
        ],
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.feedback.id).toBe('string');
  });

  it('defaults an authed responder’s name to their username', async () => {
    const { cookie: ownerCookie, token } = await makeFeedbackShare('fb-owner-authed');
    const responder = await makeUser('fb-responder');
    const res = await request(app)
      .post(`/api/feedback/public/${token}`)
      .set('Cookie', responder)
      .send({ suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] });
    expect(res.status).toBe(201);
    const list = await request(app).get('/api/feedback/deck/d-1').set('Cookie', ownerCookie);
    expect(list.body.responses[0].authorName).toBe('fb-responder');
  });

  it('rejects a guest submission without a name', async () => {
    const { token } = await makeFeedbackShare('fb-owner-noname');
    const res = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] });
    expect(res.status).toBe(400);
  });

  it('rejects an empty submission (no suggestions, no comment)', async () => {
    const { token } = await makeFeedbackShare('fb-owner-empty');
    const res = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'Ghost', suggestions: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed suggestion type and an out-of-range bracket', async () => {
    const { token } = await makeFeedbackShare('fb-owner-bad');
    const badType = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'G', suggestions: [{ type: 'swap', cardName: 'X' }] });
    expect(badType.status).toBe(400);
    const badBracket = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({
        authorName: 'G',
        bracketSuggestion: 9,
        suggestions: [{ type: 'cut', cardName: 'Sol Ring' }],
      });
    expect(badBracket.status).toBe(400);
  });

  it('404s for unknown tokens and for non-feedback share tokens', async () => {
    const unknown = await request(app)
      .post('/api/feedback/public/definitely-not-a-token')
      .send({ authorName: 'G', suggestions: [{ type: 'cut', cardName: 'X' }] });
    expect(unknown.status).toBe(404);

    const cookie = await makeUser('fb-owner-deckkind');
    await setSnapshot(cookie, { decks: [makeDeck('d-1')] });
    const deckShare = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'deck', resourceId: 'd-1' });
    const res = await request(app)
      .post(`/api/feedback/public/${deckShare.body.share.token}`)
      .send({ authorName: 'G', suggestions: [{ type: 'cut', cardName: 'X' }] });
    expect(res.status).toBe(404);
  });

  it('404s after the share is revoked', async () => {
    const { cookie, token } = await makeFeedbackShare('fb-owner-revoked');
    await request(app).delete(`/api/shares/${token}`).set('Cookie', cookie);
    const res = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'G', suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/feedback/deck/:deckId', () => {
  it('lists only the owner’s responses, newest first, with pending statuses', async () => {
    const { cookie, token } = await makeFeedbackShare('fb-owner-list');
    await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'First', suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] });
    await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'Second', comment: 'Nice deck', suggestions: [] });

    const res = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.responses).toHaveLength(2);
    expect(res.body.responses[0].authorName).toBe('Second');
    expect(res.body.responses[1].suggestions[0].status).toBe('pending');

    // Another user sees none of it.
    const stranger = await makeUser('fb-stranger');
    const other = await request(app).get('/api/feedback/deck/d-1').set('Cookie', stranger);
    expect(other.body.responses).toHaveLength(0);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/feedback/deck/d-1');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/feedback/:id/suggestions/:suggestionId', () => {
  it('lets the owner accept, reject, and revert a suggestion', async () => {
    const { cookie, token } = await makeFeedbackShare('fb-owner-verdict');
    await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'G', suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] });
    const list = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    const feedbackId = list.body.responses[0].id as string;
    const suggestionId = list.body.responses[0].suggestions[0].id as string;

    const accept = await request(app)
      .post(`/api/feedback/${feedbackId}/suggestions/${suggestionId}`)
      .set('Cookie', cookie)
      .send({ status: 'accepted' });
    expect(accept.status).toBe(200);
    expect(accept.body.suggestion.status).toBe('accepted');

    const revert = await request(app)
      .post(`/api/feedback/${feedbackId}/suggestions/${suggestionId}`)
      .set('Cookie', cookie)
      .send({ status: 'pending' });
    expect(revert.status).toBe(200);

    const after = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    expect(after.body.responses[0].suggestions[0].status).toBe('pending');
  });

  it('404s for a non-owner and 400s on a bogus status', async () => {
    const { cookie, token } = await makeFeedbackShare('fb-owner-verdict2');
    await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'G', suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] });
    const list = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    const feedbackId = list.body.responses[0].id as string;
    const suggestionId = list.body.responses[0].suggestions[0].id as string;

    const stranger = await makeUser('fb-verdict-stranger');
    const denied = await request(app)
      .post(`/api/feedback/${feedbackId}/suggestions/${suggestionId}`)
      .set('Cookie', stranger)
      .send({ status: 'accepted' });
    expect(denied.status).toBe(404);

    const bogus = await request(app)
      .post(`/api/feedback/${feedbackId}/suggestions/${suggestionId}`)
      .set('Cookie', cookie)
      .send({ status: 'maybe' });
    expect(bogus.status).toBe(400);
  });
});

describe('DELETE /api/feedback/:id', () => {
  it('owner can delete a response; strangers cannot', async () => {
    const { cookie, token } = await makeFeedbackShare('fb-owner-delete');
    await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'G', comment: 'hi', suggestions: [] });
    const list = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    const feedbackId = list.body.responses[0].id as string;

    const stranger = await makeUser('fb-delete-stranger');
    const denied = await request(app).delete(`/api/feedback/${feedbackId}`).set('Cookie', stranger);
    expect(denied.status).toBe(404);

    const ok = await request(app).delete(`/api/feedback/${feedbackId}`).set('Cookie', cookie);
    expect(ok.status).toBe(204);
    const after = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    expect(after.body.responses).toHaveLength(0);
  });
});

async function userIdByName(cookie: string, username: string): Promise<string> {
  const search = await request(app).get(`/api/users/search?q=${username}`).set('Cookie', cookie);
  return search.body.users[0].id as string;
}

/** Make two registered users accepted friends (A requests, B's reverse request auto-accepts). */
async function befriend(
  aCookie: string,
  aName: string,
  bCookie: string,
  bName: string
): Promise<void> {
  await request(app).post('/api/friends/requests').set('Cookie', aCookie).send({ username: bName });
  const auto = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', bCookie)
    .send({ username: aName });
  expect(auto.body.friendStatus).toBe('friends');
}

describe('audience gates on submit', () => {
  it('a friends feedback link 401s anonymous, 403s a stranger, 201s a friend', async () => {
    const ownerName = 'fb-aud-owner';
    const owner = await makeUser(ownerName);
    const friendName = 'fb-aud-friend';
    const friend = await makeUser(friendName);
    const stranger = await makeUser('fb-aud-stranger');
    await befriend(owner, ownerName, friend, friendName);
    await setSnapshot(owner, { decks: [makeDeck('d-aud')] });
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', owner)
      .send({ kind: 'feedback', resourceId: 'd-aud', audience: 'friends' });
    const token = create.body.share.token as string;
    const payload = { authorName: 'G', suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] };

    expect((await request(app).post(`/api/feedback/public/${token}`).send(payload)).status).toBe(
      401
    );
    expect(
      (
        await request(app)
          .post(`/api/feedback/public/${token}`)
          .set('Cookie', stranger)
          .send(payload)
      ).status
    ).toBe(403);
    expect(
      (await request(app).post(`/api/feedback/public/${token}`).set('Cookie', friend).send(payload))
        .status
    ).toBe(201);
  });

  it('a direct feedback link only accepts the addressee', async () => {
    const ownerName = 'fb-dir-owner';
    const owner = await makeUser(ownerName);
    const addresseeName = 'fb-dir-addressee';
    const addressee = await makeUser(addresseeName);
    const other = await makeUser('fb-dir-other');
    await befriend(owner, ownerName, addressee, addresseeName);
    await setSnapshot(owner, { decks: [makeDeck('d-dir')] });
    const addresseeId = await userIdByName(owner, addresseeName);
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', owner)
      .send({ kind: 'feedback', resourceId: 'd-dir', audience: 'direct', addresseeId });
    const token = create.body.share.token as string;
    const payload = { authorName: 'G', suggestions: [{ type: 'cut', cardName: 'Sol Ring' }] };

    expect(
      (await request(app).post(`/api/feedback/public/${token}`).set('Cookie', other).send(payload))
        .status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/feedback/public/${token}`)
          .set('Cookie', addressee)
          .send(payload)
      ).status
    ).toBe(201);
  });
});

describe('abuse bounds', () => {
  it('rejects an oversized card blob instead of silently dropping it', async () => {
    const { token } = await makeFeedbackShare('fb-oversize');
    const res = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({
        authorName: 'G',
        suggestions: [{ type: 'add', cardName: 'Big', card: { blob: 'x'.repeat(65 * 1024) } }],
      });
    expect(res.status).toBe(400);
  });

  it('caps total responses per feedback link', async () => {
    const { token } = await makeFeedbackShare('fb-cap');
    for (let i = 0; i < 64; i++) {
      const res = await request(app)
        .post(`/api/feedback/public/${token}`)
        .send({ authorName: `G${i}`, comment: 'gg', suggestions: [] });
      expect(res.status).toBe(201);
    }
    const overflow = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'G65', comment: 'gg', suggestions: [] });
    expect(overflow.status).toBe(400);
    expect(overflow.body.error).toMatch(/full/i);
  });
});

describe('concurrent verdicts', () => {
  it('does not lose one of two simultaneous verdicts on sibling suggestions', async () => {
    const { cookie, token } = await makeFeedbackShare('fb-race');
    await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({
        authorName: 'G',
        suggestions: [
          { type: 'cut', cardName: 'Sol Ring' },
          { type: 'cut', cardName: 'Arcane Signet' },
        ],
      });
    const list = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    const feedbackId = list.body.responses[0].id as string;
    const [sugA, sugB] = list.body.responses[0].suggestions as Array<{ id: string }>;

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/feedback/${feedbackId}/suggestions/${sugA.id}`)
        .set('Cookie', cookie)
        .send({ status: 'accepted' }),
      request(app)
        .post(`/api/feedback/${feedbackId}/suggestions/${sugB.id}`)
        .set('Cookie', cookie)
        .send({ status: 'rejected' }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const after = await request(app).get('/api/feedback/deck/d-1').set('Cookie', cookie);
    const byId = new Map(
      (after.body.responses[0].suggestions as Array<{ id: string; status: string }>).map((s) => [
        s.id,
        s.status,
      ])
    );
    expect(byId.get(sugA.id)).toBe('accepted');
    expect(byId.get(sugB.id)).toBe('rejected');
  });
});
