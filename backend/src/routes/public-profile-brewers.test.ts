import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

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

let seq = 0;
interface Acct {
  cookie: string;
  username: string;
  id: string;
}
async function makeUser(prefix: string): Promise<Acct> {
  seq += 1;
  const username = `${prefix}-${seq}`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, username, id: me.body.user.id as string };
}

/** A bare user row, for likers and followers that never sign in. */
async function ghost(prefix: string): Promise<string> {
  seq += 1;
  const id = `ghost-${prefix}-${seq}`;
  await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $2, $3)`, [
    id,
    id,
    Date.now(),
  ]);
  return id;
}

async function deck(
  owner: string,
  opts: {
    commander?: string | null;
    colors?: string[];
    art?: string | null;
    copies?: number;
    live?: boolean;
  } = {}
): Promise<string> {
  seq += 1;
  const slug = `pdeck-${seq}`;
  const at = Date.now() + seq;
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, commander_name, og_art_crop, color_identity,
        copy_count, published_at, updated_at, unpublished_at)
     VALUES ($1, $2, $2, $2, 'commander', $3, $4, $5::jsonb, $6, $7, $7, $8)`,
    [
      owner,
      slug,
      opts.commander ?? null,
      opts.art ?? null,
      JSON.stringify(opts.colors ?? ['U']),
      opts.copies ?? 0,
      at,
      opts.live === false ? at : null,
    ]
  );
  return slug;
}

async function profile(username: string, cookie?: string) {
  const req = request(app).get(`/api/public/users/${username}`);
  return cookie ? req.set('Cookie', cookie) : req;
}

async function play(opts: {
  me: string;
  won: boolean;
  format?: string;
  deckId?: string | null;
  deckName?: string | null;
  endedAt?: number;
}): Promise<void> {
  seq += 1;
  await pool.query(
    `INSERT INTO game_results
       (session_id, code, format, starting_life, winner_user_id, ended_at, duration_ms,
        participants, created_at)
     VALUES ($1, 'CODE', $2, 40, $3, $4, 1000, $5::jsonb, $4)`,
    [
      `game-${seq}`,
      opts.format ?? 'commander',
      opts.won ? opts.me : 'someone-else',
      opts.endedAt ?? Date.now() + seq,
      JSON.stringify([
        {
          seat: 0,
          userId: opts.me,
          username: null,
          name: 'Me',
          deckId: opts.deckId ?? null,
          deckName: opts.deckName ?? null,
          commander: null,
          partner: null,
          colorIdentity: [],
          finalLife: 10,
          eliminated: false,
        },
        {
          seat: 1,
          userId: null,
          username: null,
          name: 'Them',
          deckId: null,
          deckName: 'Their Deck',
          commander: null,
          partner: null,
          colorIdentity: [],
          finalLife: 0,
          eliminated: true,
        },
      ]),
    ]
  );
}

describe('GET /api/public/users/:username, brewer fields', () => {
  it('counts followers and following per request, so a follow shows at once', async () => {
    const owner = await makeUser('pf-owner');
    const fan = await makeUser('pf-fan');
    const before = await profile(owner.username, fan.cookie);
    expect(before.body).toMatchObject({
      followerCount: 0,
      followingCount: 0,
      viewerFollows: false,
      viewerIsFriend: false,
    });
    await request(app).post(`/api/follows/${owner.username}`).set('Cookie', fan.cookie);
    const after = await profile(owner.username, fan.cookie);
    expect(after.body).toMatchObject({ followerCount: 1, viewerFollows: true });
    const asFan = await profile(fan.username);
    expect(asFan.body.followingCount).toBe(1);
    // A guest sees the count but never a follow state.
    const guest = await profile(owner.username);
    expect(guest.body).toMatchObject({ followerCount: 1, viewerFollows: false });
    await request(app).delete(`/api/follows/${owner.username}`).set('Cookie', fan.cookie);
    expect((await profile(owner.username, fan.cookie)).body).toMatchObject({
      followerCount: 0,
      viewerFollows: false,
    });
  });

  it('viewerIsFriend is true only for an accepted friendship, either direction', async () => {
    const a = await makeUser('pf-fra');
    const b = await makeUser('pf-frb');
    expect((await profile(b.username, a.cookie)).body.viewerIsFriend).toBe(false);
    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES ($1, $2, 'pending', $3)`,
      [b.id, a.id, Date.now()]
    );
    expect((await profile(b.username, a.cookie)).body.viewerIsFriend).toBe(false);
    await pool.query(`UPDATE friendships SET status = 'accepted' WHERE requester_id = $1`, [b.id]);
    expect((await profile(b.username, a.cookie)).body.viewerIsFriend).toBe(true);
    expect((await profile(a.username, b.cookie)).body.viewerIsFriend).toBe(true);
    // Your own profile is never "a friend".
    expect((await profile(a.username, a.cookie)).body.viewerIsFriend).toBe(false);
  });

  it('a hidden profile still 404s to a stranger and the counts never leak', async () => {
    const owner = await makeUser('pf-hidden');
    await pool.query(`UPDATE users SET profile_hidden_at = 1 WHERE id = $1`, [owner.id]);
    expect((await profile(owner.username)).status).toBe(404);
  });

  it('stats: likes are DISTINCT non-owner people across live decks; copies sum live decks', async () => {
    const owner = await makeUser('pf-stats');
    const a = await deck(owner.id, { copies: 2 });
    const b = await deck(owner.id, { copies: 3 });
    const dead = await deck(owner.id, { copies: 50, live: false });
    const [x, y] = [await ghost('x'), await ghost('y')];
    const likes: Array<[string, string]> = [
      [x, a],
      [x, b], // same person, second deck: still one
      [y, a],
      [owner.id, a], // the owner never counts
      [y, dead], // an unpublished deck never counts
    ];
    for (const [who, slug] of likes) {
      await pool.query(
        `INSERT INTO deck_likes (user_id, slug, deck_owner_id, created_at) VALUES ($1, $2, $3, 1)`,
        [who, slug, owner.id]
      );
    }
    const res = await profile(owner.username);
    expect(res.body.stats).toEqual({ likesReceived: 2, copiesReceived: 5 });
  });

  it('topCommanders (top 3 by live deck count) and colorSpread (colourless is C)', async () => {
    const owner = await makeUser('pf-cmd');
    await deck(owner.id, { commander: 'Atraxa', colors: ['W', 'U', 'B', 'G'], art: 'a1.jpg' });
    await deck(owner.id, { commander: 'Atraxa', colors: ['U'], art: 'a2.jpg' });
    await deck(owner.id, { commander: 'Krenko', colors: ['R'] });
    await deck(owner.id, { commander: 'Kozilek', colors: [] });
    await deck(owner.id, { commander: 'Zada', colors: ['R', 'G'] });
    await deck(owner.id, { commander: 'Gone', colors: ['W'], live: false });
    const res = await profile(owner.username);
    expect(res.body.topCommanders).toHaveLength(3);
    // The newest Atraxa deck supplies the art (the ids ascend, so a2 is newer).
    expect(res.body.topCommanders[0]).toEqual({ name: 'Atraxa', image: 'a2.jpg', deckCount: 2 });
    expect(res.body.topCommanders[1].deckCount).toBe(1);
    expect(res.body.colorSpread).toEqual({ W: 1, U: 2, B: 1, R: 2, G: 2, C: 1 });
  });

  it('an account with no decks gets zeros and empty lists', async () => {
    const owner = await makeUser('pf-empty');
    const res = await profile(owner.username);
    expect(res.body).toMatchObject({
      stats: { likesReceived: 0, copiesReceived: 0 },
      topCommanders: [],
      colorSpread: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      pinnedDeckSlug: null,
      gameRecord: null,
    });
  });
});

describe('PATCH /api/auth/profile, pinnedDeckSlug and showGameRecord', () => {
  it('pins one of your own live decks, and shows it on the profile', async () => {
    const owner = await makeUser('pin-own');
    const slug = await deck(owner.id);
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ pinnedDeckSlug: slug });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ pinnedDeckSlug: slug, showGameRecord: false });
    expect((await profile(owner.username)).body.pinnedDeckSlug).toBe(slug);
    const me = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(me.body.profile).toMatchObject({ pinnedDeckSlug: slug, showGameRecord: false });
  });

  it('refuses another brewer’s deck, an unknown slug and an unpublished deck', async () => {
    const owner = await makeUser('pin-bad');
    const other = await makeUser('pin-other');
    const theirs = await deck(other.id);
    const dead = await deck(owner.id, { live: false });
    for (const pinnedDeckSlug of [theirs, 'no-such-slug', dead, 42]) {
      const res = await request(app)
        .patch('/api/auth/profile')
        .set('Cookie', owner.cookie)
        .send({ pinnedDeckSlug });
      expect(res.status).toBe(400);
    }
    const me = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(me.body.profile.pinnedDeckSlug).toBeNull();
  });

  it('unpins with null, and a pin that stopped being live reads as null', async () => {
    const owner = await makeUser('pin-null');
    const slug = await deck(owner.id);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ pinnedDeckSlug: slug });
    await pool.query(`UPDATE deck_publications SET unpublished_at = 1 WHERE slug = $1`, [slug]);
    // The profile cache purges on the write below; the pin is checked live anyway.
    const stale = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(stale.body.profile.pinnedDeckSlug).toBeNull();
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ pinnedDeckSlug: null });
    expect(res.status).toBe(200);
    expect(res.body.profile.pinnedDeckSlug).toBeNull();
  });

  it('a pin change shows on the profile at once (public caches purged)', async () => {
    const owner = await makeUser('pin-purge');
    const first = await deck(owner.id);
    const second = await deck(owner.id);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ pinnedDeckSlug: first });
    expect((await profile(owner.username)).body.pinnedDeckSlug).toBe(first);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ pinnedDeckSlug: second });
    expect((await profile(owner.username)).body.pinnedDeckSlug).toBe(second);
  });

  it('showGameRecord takes a boolean only', async () => {
    const owner = await makeUser('rec-bool');
    for (const showGameRecord of ['yes', 1, null]) {
      const res = await request(app)
        .patch('/api/auth/profile')
        .set('Cookie', owner.cookie)
        .send({ showGameRecord });
      expect(res.status).toBe(400);
    }
    const on = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ showGameRecord: true });
    expect(on.body.profile.showGameRecord).toBe(true);
    const off = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ showGameRecord: false });
    expect(off.body.profile.showGameRecord).toBe(false);
  });

  it('leaves both fields alone when the body omits them', async () => {
    const owner = await makeUser('rec-omit');
    const slug = await deck(owner.id);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ pinnedDeckSlug: slug, showGameRecord: true });
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ bio: 'hello' });
    expect(res.body.profile).toMatchObject({ pinnedDeckSlug: slug, showGameRecord: true });
  });
});

describe('game record', () => {
  it('is null while the owner has not opted in, even with games played', async () => {
    const owner = await makeUser('gr-off');
    await play({ me: owner.id, won: true });
    const res = await profile(owner.username);
    expect(res.body.gameRecord).toBeNull();
    // Not for the owner's own view either: the setting decides, not the viewer.
    expect((await profile(owner.username, owner.cookie)).body.gameRecord).toBeNull();
  });

  it('counts finished PvP games and wins, and names the most played deck', async () => {
    const owner = await makeUser('gr-on');
    const slug = await deck(owner.id);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ showGameRecord: true });
    await play({ me: owner.id, won: true, deckId: slug, deckName: 'Main' });
    await play({ me: owner.id, won: true, deckId: slug, deckName: 'Main' });
    await play({ me: owner.id, won: false, deckId: slug, deckName: 'Main' });
    await play({ me: owner.id, won: false, deckId: 'other-deck', deckName: 'Side' });
    // Co-op games have no winning seat and are left out.
    await play({ me: owner.id, won: false, format: 'horde', deckName: 'Side' });
    const res = await profile(owner.username);
    expect(res.body.gameRecord).toEqual({
      games: 4,
      wins: 2,
      mostPlayed: { name: 'Main', slug },
    });
  });

  it('gives a null slug once the most played deck is no longer public', async () => {
    const owner = await makeUser('gr-slug');
    const slug = await deck(owner.id, { live: false });
    await pool.query(`UPDATE users SET show_game_record = true WHERE id = $1`, [owner.id]);
    await play({ me: owner.id, won: false, deckId: slug, deckName: 'Retired' });
    const res = await profile(owner.username);
    expect(res.body.gameRecord).toEqual({
      games: 1,
      wins: 0,
      mostPlayed: { name: 'Retired', slug: null },
    });
  });

  it('is zeros with no most played when opted in and never played', async () => {
    const owner = await makeUser('gr-none');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ showGameRecord: true });
    const res = await profile(owner.username);
    expect(res.body.gameRecord).toEqual({ games: 0, wins: 0, mostPlayed: null });
  });

  it('turning it off hides it at once', async () => {
    const owner = await makeUser('gr-toggle');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ showGameRecord: true });
    expect((await profile(owner.username)).body.gameRecord).not.toBeNull();
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ showGameRecord: false });
    expect((await profile(owner.username)).body.gameRecord).toBeNull();
  });
});

describe('GET /api/activity, followed decks', () => {
  it('lists recent live decks of followed brewers in `following`, not in `recent`', async () => {
    const me = await makeUser('act-me');
    const brewer = await makeUser('act-brewer');
    const hidden = await makeUser('act-hidden');
    const stranger = await makeUser('act-stranger');
    const fresh = await deck(brewer.id);
    await deck(brewer.id, { live: false });
    await deck(hidden.id);
    await deck(stranger.id);
    const old = await deck(brewer.id);
    await pool.query(`UPDATE deck_publications SET published_at = 1 WHERE slug = $1`, [old]);
    for (const t of [brewer, hidden]) {
      await request(app).post(`/api/follows/${t.username}`).set('Cookie', me.cookie);
    }
    await pool.query(`UPDATE users SET profile_hidden_at = 1 WHERE id = $1`, [hidden.id]);
    const res = await request(app).get('/api/activity').set('Cookie', me.cookie);
    expect(res.status).toBe(200);
    expect(res.body.recent).toEqual([]);
    expect(res.body.following).toEqual([
      expect.objectContaining({
        type: 'followed_deck_published',
        id: `followed_deck_published:${fresh}`,
        slug: fresh,
        brewerUsername: brewer.username,
        brewerDisplayName: null,
      }),
    ]);
  });
});
