import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import type { GameSummary, SeatSummary } from '@spellcontrol/game-core';

let app: Express;
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
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return { cookie: extractSessionCookie(reg.headers['set-cookie'])!, id: reg.body.user.id };
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

async function createPod(cookie: string, name = 'Stats pod'): Promise<{ id: string }> {
  const res = await request(app).post('/api/pods').set('Cookie', cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.pod as { id: string };
}

/** Invite + accept a friend into a pod in one step. */
async function addMember(
  ownerCookie: string,
  podId: string,
  memberId: string,
  memberCookie: string
): Promise<void> {
  await request(app)
    .post(`/api/pods/${podId}/invites`)
    .set('Cookie', ownerCookie)
    .send({ userIds: [memberId] });
  await request(app).post(`/api/pods/${podId}/accept`).set('Cookie', memberCookie);
}

let resultSeq = 0;
/** Insert a canonical game_results row directly, mirroring
 *  game-results.test.ts's own insertResult helper. */
/** A seat with no derived activity — spread over it to set just what a test
 *  cares about. */
function blankSeat(seat: number): SeatSummary {
  return {
    seat,
    damageTaken: 0,
    lifeGained: 0,
    biggestHit: 0,
    lowestLife: 40,
    commanderDamageDealt: 0,
    placement: null,
    eliminatedOnTurn: null,
    killedBySeat: null,
  };
}

async function insertResult(opts: {
  winnerUserId: string | null;
  participants: Array<{ userId: string | null; username?: string | null }>;
  /** Omitted → a pre-summary row, which the rollups must skip entirely. */
  summary?: GameSummary;
}): Promise<string> {
  const sessionId = `pod-res-${++resultSeq}`;
  const participants = opts.participants.map((p, i) => ({
    seat: i,
    userId: p.userId,
    username: p.username ?? null,
    name: `P${i}`,
    deckId: null,
    deckName: null,
    commander: null,
    colorIdentity: [],
    finalLife: 40,
    eliminated: false,
  }));
  await pool.query(
    `INSERT INTO game_results
       (session_id, code, format, starting_life, winner_seat, winner_user_id,
        started_at, ended_at, duration_ms, participants, notable_events, summary, created_at)
     VALUES ($1, 'CODE', 'commander', 40, 0, $2, 1, 100, 99, $3, NULL, $4, 100)`,
    [
      sessionId,
      opts.winnerUserId,
      JSON.stringify(participants),
      opts.summary ? JSON.stringify(opts.summary) : null,
    ]
  );
  return sessionId;
}

// ─── GET /api/pods/:id/games ────────────────────────────────────────────────

describe('GET /api/pods/:id/games', () => {
  it('excludes a game with only 1 pod member present; includes one with 2+', async () => {
    const owner = await makeUser('ps-games-owner');
    const member = await makeUser('ps-games-member');
    const stranger = await makeUser('ps-games-stranger');
    await befriend(owner.cookie, 'ps-games-member', member.cookie, 'ps-games-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, member.id, member.cookie);

    // Only the owner (1 pod member) plays a stranger — excluded.
    await insertResult({
      winnerUserId: owner.id,
      participants: [{ userId: owner.id }, { userId: stranger.id }],
    });
    // Owner + member (2 pod members) — included.
    const includedId = await insertResult({
      winnerUserId: member.id,
      participants: [{ userId: owner.id }, { userId: member.id }],
    });

    const res = await request(app).get(`/api/pods/${pod.id}/games`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.games).toHaveLength(1);
    expect(res.body.games[0].sessionId).toBe(includedId);
  });

  it("nulls every participant's userId/username, including pod members' own", async () => {
    const owner = await makeUser('ps-null-owner');
    const member = await makeUser('ps-null-member');
    const stranger = await makeUser('ps-null-stranger');
    await befriend(owner.cookie, 'ps-null-member', member.cookie, 'ps-null-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, member.id, member.cookie);

    await insertResult({
      winnerUserId: owner.id,
      participants: [
        { userId: owner.id, username: 'ps-null-owner' },
        { userId: member.id, username: 'ps-null-member' },
        { userId: stranger.id, username: 'ps-null-stranger' },
      ],
    });

    const res = await request(app).get(`/api/pods/${pod.id}/games`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.games).toHaveLength(1);
    const participants = res.body.games[0].participants as Array<Record<string, unknown>>;
    expect(participants).toHaveLength(3);
    for (const p of participants) {
      // Key-presence-with-null-value, not key-absence — PublicGameResult's
      // type still declares these fields, so the shape contract holds.
      expect(p).toHaveProperty('userId', null);
      expect(p).toHaveProperty('username', null);
    }
  });

  it('omits the top-level winnerUserId and join code entirely', async () => {
    const owner = await makeUser('ps-allow-owner');
    const member = await makeUser('ps-allow-member');
    const stranger = await makeUser('ps-allow-stranger');
    await befriend(owner.cookie, 'ps-allow-member', member.cookie, 'ps-allow-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, member.id, member.cookie);

    // The stranger never joined this pod, yet wins a game two pod members are
    // in — so the pod gate includes it, and under the old spread-based
    // denylist their account UUID rode through on winnerUserId, bound to a
    // named seat by winnerSeat in the same payload.
    await insertResult({
      winnerUserId: stranger.id,
      participants: [{ userId: owner.id }, { userId: member.id }, { userId: stranger.id }],
    });

    const res = await request(app).get(`/api/pods/${pod.id}/games`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    const game = res.body.games[0] as Record<string, unknown>;
    // Key ABSENCE, not null: toPublicForPod is an allowlist, so a field it
    // doesn't name never appears at all.
    expect(game).not.toHaveProperty('winnerUserId');
    expect(game).not.toHaveProperty('code');
    expect(JSON.stringify(game)).not.toContain(stranger.id);
    // The fields the pod hub actually renders still arrive.
    expect(game.sessionId).toBeTruthy();
    expect(game.winnerSeat).toBe(0);
  });

  it('an invited-not-accepted caller gets 403', async () => {
    const owner = await makeUser('ps-invited-owner');
    const invitee = await makeUser('ps-invited-invitee');
    await befriend(owner.cookie, 'ps-invited-invitee', invitee.cookie, 'ps-invited-owner');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [invitee.id] });
    // No accept — invitee stays 'invited'.

    const res = await request(app).get(`/api/pods/${pod.id}/games`).set('Cookie', invitee.cookie);
    expect(res.status).toBe(403);
  });

  it('a stranger and an unknown pod id get the identical 403 an invited caller gets', async () => {
    const owner = await makeUser('ps-parity-owner');
    const invitee = await makeUser('ps-parity-invitee');
    const stranger = await makeUser('ps-parity-stranger');
    await befriend(owner.cookie, 'ps-parity-invitee', invitee.cookie, 'ps-parity-owner');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [invitee.id] });

    const invitedRes = await request(app)
      .get(`/api/pods/${pod.id}/games`)
      .set('Cookie', invitee.cookie);
    const strangerRes = await request(app)
      .get(`/api/pods/${pod.id}/games`)
      .set('Cookie', stranger.cookie);
    const unknownRes = await request(app)
      .get(`/api/pods/not-a-real-pod-id/games`)
      .set('Cookie', stranger.cookie);

    expect(invitedRes.status).toBe(403);
    expect(strangerRes.status).toBe(403);
    expect(unknownRes.status).toBe(403);
    expect(strangerRes.body.error).toBe(invitedRes.body.error);
    expect(unknownRes.body.error).toBe(invitedRes.body.error);
  });

  it('401s unauthenticated', async () => {
    const res = await request(app).get('/api/pods/whatever/games');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/pods/:id/leaderboard ──────────────────────────────────────────

describe('GET /api/pods/:id/leaderboard', () => {
  it('excludes a <2-pod-member game and tallies wins/played over a fixture set', async () => {
    const owner = await makeUser('ps-lb-owner');
    const bob = await makeUser('ps-lb-bob');
    const carol = await makeUser('ps-lb-carol');
    const stranger = await makeUser('ps-lb-stranger');
    await befriend(owner.cookie, 'ps-lb-bob', bob.cookie, 'ps-lb-owner');
    await befriend(owner.cookie, 'ps-lb-carol', carol.cookie, 'ps-lb-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, bob.id, bob.cookie);
    await addMember(owner.cookie, pod.id, carol.id, carol.cookie);

    // 1-pod-member game (owner + a stranger) — excluded from the tally.
    await insertResult({
      winnerUserId: owner.id,
      participants: [{ userId: owner.id }, { userId: stranger.id }],
    });
    // owner + bob, owner wins
    await insertResult({
      winnerUserId: owner.id,
      participants: [{ userId: owner.id }, { userId: bob.id }],
    });
    // owner + bob, bob wins
    await insertResult({
      winnerUserId: bob.id,
      participants: [{ userId: owner.id }, { userId: bob.id }],
    });
    // owner + bob + carol, carol wins
    await insertResult({
      winnerUserId: carol.id,
      participants: [{ userId: owner.id }, { userId: bob.id }, { userId: carol.id }],
    });

    const res = await request(app)
      .get(`/api/pods/${pod.id}/leaderboard`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    interface Standing {
      userId: string;
      username: string;
      played: number;
      wins: number;
      winRate: number;
    }
    const byId = Object.fromEntries((res.body.standings as Standing[]).map((s) => [s.userId, s]));
    // owner: 3 qualifying games (the stranger game is excluded), 1 win.
    expect(byId[owner.id]).toMatchObject({ played: 3, wins: 1 });
    // bob: same 3 games, 1 win.
    expect(byId[bob.id]).toMatchObject({ played: 3, wins: 1 });
    // carol: only the 3-way game, 1 win.
    expect(byId[carol.id]).toMatchObject({ played: 1, wins: 1, winRate: 1 });
  });

  it('never threads the raw participants array into the response', async () => {
    const owner = await makeUser('ps-lb-shape-owner');
    const bob = await makeUser('ps-lb-shape-bob');
    await befriend(owner.cookie, 'ps-lb-shape-bob', bob.cookie, 'ps-lb-shape-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, bob.id, bob.cookie);
    await insertResult({
      winnerUserId: owner.id,
      participants: [{ userId: owner.id }, { userId: bob.id }],
    });

    const res = await request(app)
      .get(`/api/pods/${pod.id}/leaderboard`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ standings: expect.any(Array), records: expect.any(Object) });
    // The records block is aggregated too — never a raw seat list.
    expect(JSON.stringify(res.body.records)).not.toContain('participants');
    for (const s of res.body.standings) {
      expect(s).not.toHaveProperty('participants');
    }
  });

  it('surfaces the pod records once games carry a summary', async () => {
    const owner = await makeUser('ps-lb-rec-owner');
    const bob = await makeUser('ps-lb-rec-bob');
    await befriend(owner.cookie, 'ps-lb-rec-bob', bob.cookie, 'ps-lb-rec-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, bob.id, bob.cookie);
    await insertResult({
      winnerUserId: owner.id,
      participants: [{ userId: owner.id }, { userId: bob.id }],
      summary: {
        turns: 8,
        durationMs: 1000,
        firstBlood: { seat: 1, bySeat: 0, turn: 2, ts: 1, amount: 5 },
        startingSeat: null,
        winnerSeat: 0,
        commanderDamage: [],
        seats: [
          { ...blankSeat(0), placement: 1 },
          { ...blankSeat(1), placement: 2, killedBySeat: 0 },
        ],
      },
    });

    const res = await request(app)
      .get(`/api/pods/${pod.id}/leaderboard`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.records.firstBlood).toMatchObject({ userId: owner.id, games: 1, rate: 1 });
    expect(res.body.records.mostKos).toMatchObject({ userId: owner.id, kos: 1 });
    expect(res.body.records.archenemy).toMatchObject({
      killerId: owner.id,
      victimId: bob.id,
      kos: 1,
    });
    const byId = Object.fromEntries(
      (res.body.standings as { userId: string }[]).map((s) => [s.userId, s])
    );
    expect(byId[owner.id]).toMatchObject({ ratedGames: 1, avgPlacement: 1, firstBlood: 1, kos: 1 });
    // That game recorded no first player, so the on-the-play superlative is
    // unearned even though every other record landed.
    expect(res.body.records.onThePlay).toBeNull();
    expect(byId[owner.id]).toMatchObject({ onThePlayGames: 0, wentFirst: 0 });
  });

  it('names the on-the-play converter only past the small-sample floor', async () => {
    const owner = await makeUser('ps-lb-otp-owner');
    const bob = await makeUser('ps-lb-otp-bob');
    await befriend(owner.cookie, 'ps-lb-otp-bob', bob.cookie, 'ps-lb-otp-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, bob.id, bob.cookie);

    const withStart = async (winnerSeat: 0 | 1) =>
      insertResult({
        winnerUserId: winnerSeat === 0 ? owner.id : bob.id,
        participants: [{ userId: owner.id }, { userId: bob.id }],
        summary: {
          turns: 4,
          durationMs: 1000,
          firstBlood: null,
          startingSeat: 0, // owner always on the play
          winnerSeat,
          commanderDamage: [],
          seats: [blankSeat(0), blankSeat(1)],
        },
      });

    // Two starts is under the floor: a 2-for-2 is noise, not a title.
    await withStart(0);
    await withStart(0);
    let res = await request(app).get(`/api/pods/${pod.id}/leaderboard`).set('Cookie', owner.cookie);
    expect(res.body.records.onThePlay).toBeNull();

    // Third start clears it.
    await withStart(1);
    res = await request(app).get(`/api/pods/${pod.id}/leaderboard`).set('Cookie', owner.cookie);
    expect(res.body.records.onThePlay).toMatchObject({
      userId: owner.id,
      wins: 2,
      starts: 3,
    });
    const byId2 = Object.fromEntries(
      (res.body.standings as { userId: string }[]).map((s) => [s.userId, s])
    );
    // Bob sat in all three but started none — they count toward his
    // onThePlayGames denominator without ever crediting him a start.
    expect(byId2[bob.id]).toMatchObject({ onThePlayGames: 3, wentFirst: 0, wonGoingFirst: 0 });
  });

  it('leaves every record null when no game carries a summary', async () => {
    const owner = await makeUser('ps-lb-nosum-owner');
    const bob = await makeUser('ps-lb-nosum-bob');
    await befriend(owner.cookie, 'ps-lb-nosum-bob', bob.cookie, 'ps-lb-nosum-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, bob.id, bob.cookie);
    await insertResult({
      winnerUserId: owner.id,
      participants: [{ userId: owner.id }, { userId: bob.id }],
    });

    const res = await request(app)
      .get(`/api/pods/${pod.id}/leaderboard`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.records).toEqual({
      firstBlood: null,
      mostKos: null,
      onThePlay: null,
      archenemy: null,
    });
    // The game still counts as played — only the derived denominators are 0.
    const owned = (res.body.standings as { userId: string }[]).find((s) => s.userId === owner.id);
    expect(owned).toMatchObject({
      played: 1,
      ratedGames: 0,
      avgPlacement: null,
      onThePlayGames: 0,
      wentFirst: 0,
    });
  });

  it('never names a non-member as the archenemy, even when one shared the table', async () => {
    // fetchPodGames only requires 2+ pod members, so a qualifying game can
    // include a stranger. Their account id must never reach the pod.
    const owner = await makeUser('ps-lb-strange-owner');
    const bob = await makeUser('ps-lb-strange-bob');
    const stranger = await makeUser('ps-lb-strange-outsider');
    await befriend(owner.cookie, 'ps-lb-strange-bob', bob.cookie, 'ps-lb-strange-owner');
    const pod = await createPod(owner.cookie);
    await addMember(owner.cookie, pod.id, bob.id, bob.cookie);
    await insertResult({
      winnerUserId: stranger.id,
      participants: [{ userId: owner.id }, { userId: bob.id }, { userId: stranger.id }],
      // The stranger (seat 2) knocks out both members — the top *raw* edge.
      summary: {
        turns: 6,
        durationMs: 1000,
        firstBlood: null,
        startingSeat: null,
        winnerSeat: 2,
        commanderDamage: [],
        seats: [
          { ...blankSeat(0), killedBySeat: 2, placement: 3 },
          { ...blankSeat(1), killedBySeat: 2, placement: 2 },
          { ...blankSeat(2), placement: 1 },
        ],
      },
    });

    const res = await request(app)
      .get(`/api/pods/${pod.id}/leaderboard`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.records.archenemy).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(stranger.id);
  });

  it('an invited-not-accepted caller gets 403', async () => {
    const owner = await makeUser('ps-lb-invited-owner');
    const invitee = await makeUser('ps-lb-invited-invitee');
    await befriend(owner.cookie, 'ps-lb-invited-invitee', invitee.cookie, 'ps-lb-invited-owner');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [invitee.id] });

    const res = await request(app)
      .get(`/api/pods/${pod.id}/leaderboard`)
      .set('Cookie', invitee.cookie);
    expect(res.status).toBe(403);
  });

  it('401s unauthenticated', async () => {
    const res = await request(app).get('/api/pods/whatever/leaderboard');
    expect(res.status).toBe(401);
  });
});
