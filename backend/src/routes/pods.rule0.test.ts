import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';
import { projectRule0Deck } from '../pods/rule0';

let app: Server;
let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function makeUser(username: string): Promise<{ cookie: string; id: string }> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  return { cookie: extractSessionCookie(reg.headers['set-cookie'])!, id: reg.body.user.id };
}

async function befriend(
  a: { cookie: string },
  aName: string,
  b: { cookie: string },
  bName: string
) {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', a.cookie)
    .send({ username: bName });
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', b.cookie)
    .send({ username: aName });
}

function makeDeck(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Deck ${id}`,
    format: 'commander',
    source: 'manual',
    commander: {
      id: 'atraxa',
      name: "Atraxa, Praetors' Voice",
      color_identity: ['W', 'U', 'B', 'G'],
      image_uris: { normal: 'https://cards.scryfall.io/normal/atraxa.jpg' },
    },
    partnerCommander: null,
    cards: [{ slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null }],
    sideboard: [],
    color: '#4B0082',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bracketEstimation: {
      bracket: 3,
      label: 'Upgraded',
      hardFloors: [],
      softScore: 40,
      breakdown: {
        gameChangerCount: 2,
        gameChangerNames: ['Rhystic Study', 'Cyclonic Rift'],
        massLandDenialCount: 0,
        extraTurnCount: 1,
        twoCardComboCount: 1,
        multiCardComboCount: 0,
      },
    },
    ...overrides,
  };
}

async function createPod(cookie: string, name = 'Rule 0 crew'): Promise<string> {
  const res = await request(app).post('/api/pods').set('Cookie', cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.pod.id as string;
}

async function addMember(podId: string, userId: string, status = 'member') {
  await pool.query(
    `INSERT INTO pod_members (pod_id, user_id, status, invited_at, joined_at) VALUES ($1,$2,$3,1,1)`,
    [podId, userId, status]
  );
}

const put = (cookie: string, podId: string, deckId: string) =>
  request(app).put(`/api/pods/${podId}/decks/${deckId}`).set('Cookie', cookie);
const notes = (cookie: string, podId: string) =>
  request(app).get(`/api/pods/${podId}/rule0`).set('Cookie', cookie);

interface Row {
  deckId: string;
  username: string;
  reach: string;
  mine: boolean;
  bracket: number | null;
}

describe('pod Rule 0 notes', () => {
  // owner = the deck owner and pod owner; friend = member who is A's friend;
  // stranger = member who is NOT A's friend; outsider = not in the pod.
  let owner: { cookie: string; id: string };
  let friend: { cookie: string; id: string };
  let stranger: { cookie: string; id: string };
  let outsider: { cookie: string; id: string };
  let invited: { cookie: string; id: string };
  let podId: string;

  beforeAll(async () => {
    owner = await makeUser('r0-owner');
    friend = await makeUser('r0-friend');
    stranger = await makeUser('r0-stranger');
    outsider = await makeUser('r0-outsider');
    invited = await makeUser('r0-invited');
    await befriend(owner, 'r0-owner', friend, 'r0-friend');
    await setSnapshotViaSyncApi(request(app), owner.cookie, {
      decks: [
        makeDeck('d-public'),
        makeDeck('d-friends', { bracketOverride: 2 }),
        makeDeck('d-private'),
        makeDeck('d-unchosen'),
      ],
    });
    // Publishing needs a display name.
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ displayName: 'Owner' });
    const pub = await request(app)
      .post('/api/publications/decks/d-public')
      .set('Cookie', owner.cookie);
    expect(pub.status).toBe(201);
    for (const id of ['d-friends']) {
      const s = await request(app)
        .post('/api/shares')
        .set('Cookie', owner.cookie)
        .send({ kind: 'deck', resourceId: id, audience: 'friends' });
      expect(s.status).toBeLessThan(300);
    }
    podId = await createPod(owner.cookie);
    await addMember(podId, friend.id);
    await addMember(podId, stranger.id);
    await addMember(podId, invited.id, 'invited');
  });

  it('refuses a non-member on every route, with the missing-pod 404', async () => {
    expect((await notes(outsider.cookie, podId)).status).toBe(404);
    expect((await put(outsider.cookie, podId, 'd-public')).status).toBe(404);
    const del = await request(app)
      .delete(`/api/pods/${podId}/decks/d-public`)
      .set('Cookie', outsider.cookie);
    expect(del.status).toBe(404);
    // An invite that was never accepted is not membership.
    expect((await notes(invited.cookie, podId)).status).toBe(404);
    expect((await put(invited.cookie, podId, 'd-public')).status).toBe(404);
  });

  it('rejects a deck the caller does not own, and a private one', async () => {
    expect((await put(friend.cookie, podId, 'd-public')).status).toBe(404);
    const priv = await put(owner.cookie, podId, 'd-private');
    expect(priv.status).toBe(409);
    expect(priv.body.code).toBe('deck_private');
  });

  it('shows each viewer only the opted-in decks already visible to them', async () => {
    expect((await put(owner.cookie, podId, 'd-public')).status).toBe(204);
    expect((await put(owner.cookie, podId, 'd-friends')).status).toBe(204);
    // Idempotent.
    expect((await put(owner.cookie, podId, 'd-friends')).status).toBe(204);

    const asFriend = (await notes(friend.cookie, podId)).body.decks as Row[];
    expect(asFriend.map((d) => d.deckId).sort()).toEqual(['d-friends', 'd-public']);

    // A pod member who is not the owner's friend gets the public deck only.
    const asStranger = (await notes(stranger.cookie, podId)).body.decks as Row[];
    expect(asStranger.map((d) => d.deckId)).toEqual(['d-public']);

    // The owner sees their own, and the unchosen / private ones never appear.
    const asOwner = (await notes(owner.cookie, podId)).body.decks as Row[];
    expect(asOwner.map((d) => d.deckId).sort()).toEqual(['d-friends', 'd-public']);
    expect(asOwner.every((d) => d.mine)).toBe(true);
    const everyone = JSON.stringify([asFriend, asStranger, asOwner]);
    expect(everyone).not.toContain('d-unchosen');
    expect(everyone).not.toContain('d-private');
  });

  it('reads the stated bracket over the estimate and carries the signals', async () => {
    const rows = (await notes(friend.cookie, podId)).body.decks as Array<
      Row & { bracketStated: boolean; estimatedBracket: number; signals: Record<string, unknown> }
    >;
    const fr = rows.find((d) => d.deckId === 'd-friends')!;
    expect(fr.bracket).toBe(2);
    expect(fr.bracketStated).toBe(true);
    expect(fr.estimatedBracket).toBe(3);
    const pub = rows.find((d) => d.deckId === 'd-public')!;
    expect(pub.bracket).toBe(3);
    expect(pub.signals).toMatchObject({
      gameChangers: 2,
      gameChangerNames: ['Rhystic Study', 'Cyclonic Rift'],
      extraTurns: 1,
      twoCardCombos: 1,
    });
    expect(rows[0]).not.toHaveProperty('cards');
  });

  it('drops a deck from other viewers the moment its visibility is withdrawn', async () => {
    await pool.query(
      `UPDATE shares SET revoked_at = 1 WHERE user_id = $1 AND resource_id = 'd-friends'`,
      [owner.id]
    );
    const asFriend = (await notes(friend.cookie, podId)).body.decks as Row[];
    expect(asFriend.map((d) => d.deckId)).toEqual(['d-public']);
    // The owner still sees the row, flagged so the picker can say why.
    const asOwner = (await notes(owner.cookie, podId)).body.decks as Row[];
    expect(asOwner.find((d) => d.deckId === 'd-friends')?.reach).toBe('private');

    await pool.query(
      `UPDATE deck_publications SET unpublished_at = 1 WHERE user_id = $1 AND deck_id = 'd-public'`,
      [owner.id]
    );
    expect((await notes(stranger.cookie, podId)).body.decks).toEqual([]);
  });

  it("removes a member's decks when they leave, and on DELETE", async () => {
    await pool.query(`UPDATE deck_publications SET unpublished_at = NULL WHERE user_id = $1`, [
      owner.id,
    ]);
    const del = await request(app)
      .delete(`/api/pods/${podId}/decks/d-public`)
      .set('Cookie', owner.cookie);
    expect(del.status).toBe(204);
    expect((await notes(stranger.cookie, podId)).body.decks).toEqual([]);

    // A member who leaves takes their choices with them.
    await setSnapshotViaSyncApi(request(app), friend.cookie, { decks: [makeDeck('f-deck')] });
    await request(app).patch('/api/auth/profile').set('Cookie', friend.cookie).send({
      displayName: 'Friend',
    });
    await request(app).post('/api/publications/decks/f-deck').set('Cookie', friend.cookie);
    expect((await put(friend.cookie, podId, 'f-deck')).status).toBe(204);
    expect(((await notes(owner.cookie, podId)).body.decks as Row[]).length).toBe(2);
    const leave = await request(app)
      .delete(`/api/pods/${podId}/members/me`)
      .set('Cookie', friend.cookie);
    expect(leave.status).toBe(204);
    const left = await pool.query(`SELECT 1 FROM pod_decks WHERE pod_id = $1 AND user_id = $2`, [
      podId,
      friend.id,
    ]);
    expect(left.rowCount).toBe(0);
  });

  it('caps the decks one member can put in a pod', async () => {
    const decks = Array.from({ length: 7 }, (_, i) => makeDeck(`cap-${i}`));
    await setSnapshotViaSyncApi(request(app), stranger.cookie, { decks });
    await request(app).patch('/api/auth/profile').set('Cookie', stranger.cookie).send({
      displayName: 'Stranger',
    });
    for (let i = 0; i < 7; i++) {
      const p = await request(app)
        .post(`/api/publications/decks/cap-${i}`)
        .set('Cookie', stranger.cookie);
      expect(p.status).toBe(201);
    }
    for (let i = 0; i < 6; i++)
      expect((await put(stranger.cookie, podId, `cap-${i}`)).status).toBe(204);
    expect((await put(stranger.cookie, podId, 'cap-6')).status).toBe(400);
  });
});

describe('projectRule0Deck', () => {
  it('reads a deck that was never analyzed as no bracket and no signals', () => {
    const p = projectRule0Deck({ name: 'Fresh', format: 'commander' });
    expect(p).toMatchObject({ name: 'Fresh', bracket: null, signals: null, commanderName: null });
  });
  it('returns null for a deck with no name', () => {
    expect(projectRule0Deck({})).toBeNull();
    expect(projectRule0Deck(null)).toBeNull();
  });
  it('ignores junk in the estimate', () => {
    const p = projectRule0Deck({
      name: 'X',
      bracketEstimation: {
        bracket: 'high',
        breakdown: { gameChangerCount: -3, gameChangerNames: [1, 'A'] },
      },
    });
    expect(p?.bracket).toBeNull();
    expect(p?.signals).toMatchObject({ gameChangers: 0, gameChangerNames: ['A'] });
  });
});
