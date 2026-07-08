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
