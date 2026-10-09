import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { brewerRailsCache } from '../publications/cache';
import { spotlightIndex } from '../brewers/rails';

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

// Every test starts from an empty world: the rails are global, so leftovers
// from a sibling test would leak into floors and ordering.
beforeEach(async () => {
  await pool.query(`DELETE FROM users`);
  brewerRailsCache.clear();
});

let seq = 0;
interface Fixture {
  id: string;
  username: string;
}

/** A user inserted directly (no password hash): cheap, for the many accounts
 *  a floor of three likers needs. */
async function person(
  prefix: string,
  opts: { displayName?: string; createdAt?: number; official?: boolean } = {}
): Promise<Fixture> {
  seq += 1;
  const username = `${prefix}-${seq}`;
  const id = `id-${username}`;
  await pool.query(
    `INSERT INTO users (id, username, display_name, created_at, is_official)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, username, opts.displayName ?? null, opts.createdAt ?? Date.now(), opts.official ?? false]
  );
  return { id, username };
}

async function viewer(prefix: string): Promise<Fixture & { cookie: string }> {
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

interface DeckOpts {
  commander?: string | null;
  colors?: string[];
  art?: string | null;
  likeCount?: number;
  publishedAt?: number;
  live?: boolean;
}

let deckSeq = 0;
async function deck(owner: Fixture, opts: DeckOpts = {}): Promise<string> {
  deckSeq += 1;
  const slug = `slug-${deckSeq}`;
  const at = opts.publishedAt ?? Date.now();
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, commander_name, og_art_crop, color_identity,
        like_count, published_at, updated_at, unpublished_at)
     VALUES ($1, $2, $2, $2, 'commander', $3, $4, $5::jsonb, $6, $7, $7, $8)`,
    [
      owner.id,
      slug,
      opts.commander === undefined ? null : opts.commander,
      opts.art === undefined ? null : opts.art,
      JSON.stringify(opts.colors ?? ['U']),
      opts.likeCount ?? 0,
      at,
      opts.live === false ? at : null,
    ]
  );
  return slug;
}

async function like(liker: Fixture, slug: string, owner: Fixture): Promise<void> {
  await pool.query(
    `INSERT INTO deck_likes (user_id, slug, deck_owner_id, created_at) VALUES ($1, $2, $3, $4)`,
    [liker.id, slug, owner.id, Date.now()]
  );
}

async function follow(follower: Fixture, followee: Fixture): Promise<void> {
  await pool.query(`INSERT INTO user_follows VALUES ($1, $2, $3)`, [
    follower.id,
    followee.id,
    Date.now(),
  ]);
}

async function fans(prefix: string, n: number): Promise<Fixture[]> {
  const out: Fixture[] = [];
  for (let i = 0; i < n; i++) out.push(await person(prefix));
  return out;
}

const names = (cards: Array<{ username: string }>) => cards.map((c) => c.username);

describe('GET /api/public/brewers (search)', () => {
  it('answers an empty list under two characters, without a query error', async () => {
    const a = await person('ana');
    await deck(a);
    for (const url of [
      '/api/public/brewers',
      '/api/public/brewers?q=a',
      '/api/public/brewers?q=%20a%20',
    ]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ brewers: [] });
    }
  });

  it('matches a case-insensitive substring of username or display name', async () => {
    const a = await person('zed-foo');
    const b = await person('plain', { displayName: 'The Foo Brewer' });
    const c = await person('other');
    for (const p of [a, b, c]) await deck(p);
    const res = await request(app).get('/api/public/brewers?q=FOO');
    expect(new Set(names(res.body.brewers))).toEqual(new Set([a.username, b.username]));
  });

  it('is open to guests and puts prefix matches first', async () => {
    const infix = await person('xxfoo');
    const prefix = await person('foox');
    await deck(infix);
    await deck(prefix);
    const res = await request(app).get('/api/public/brewers?q=foo');
    expect(names(res.body.brewers)).toEqual([prefix.username, infix.username]);
  });

  it('leaves out hidden accounts and accounts with no live deck', async () => {
    const live = await person('srch-live');
    const hidden = await person('srch-hidden');
    const bare = await person('srch-bare');
    const gone = await person('srch-gone');
    await deck(live);
    await deck(hidden);
    await deck(gone, { live: false });
    await pool.query(`UPDATE users SET profile_hidden_at = 1 WHERE id = $1`, [hidden.id]);
    void bare;
    const res = await request(app).get('/api/public/brewers?q=srch');
    expect(names(res.body.brewers)).toEqual([live.username]);
  });

  it('lists the house account last', async () => {
    const house = await person('aaa-house', { official: true });
    const human = await person('zzz-human');
    await deck(house);
    await deck(human);
    const res = await request(app).get('/api/public/brewers?q=-h');
    expect(names(res.body.brewers)).toEqual([human.username, house.username]);
  });

  it('treats % and _ literally and honors limit', async () => {
    const a = await person('lim');
    const b = await person('lim');
    const c = await person('lim');
    for (const p of [a, b, c]) await deck(p);
    expect((await request(app).get('/api/public/brewers?q=%25%25')).body.brewers).toEqual([]);
    expect((await request(app).get('/api/public/brewers?q=lim&limit=2')).body.brewers).toHaveLength(
      2
    );
    expect(
      (await request(app).get('/api/public/brewers?q=lim&limit=zzz')).body.brewers
    ).toHaveLength(3);
  });
});

describe('BrewerCard fields', () => {
  it('reports the deck count, follower count, colors, commander and join date', async () => {
    const owner = await person('card', { createdAt: 1234 });
    await deck(owner, { commander: 'Atraxa', colors: ['W', 'U', 'B', 'G'] });
    await deck(owner, { commander: 'Atraxa', colors: ['U'] });
    await deck(owner, { commander: 'Krenko', colors: [] });
    const [f1, f2] = await fans('cardfan', 2);
    await follow(f1, owner);
    await follow(f2, owner);
    const res = await request(app).get(`/api/public/brewers?q=${owner.username}`);
    expect(res.body.brewers[0]).toEqual({
      username: owner.username,
      displayName: null,
      avatarImageUrl: null,
      bannerImage: null,
      deckCount: 3,
      followerCount: 2,
      // U in two decks, then W B G once each in WUBRG order, then colorless.
      topColors: ['U', 'W', 'B', 'G', 'C'],
      topCommander: 'Atraxa',
      joinedAt: 1234,
    });
  });

  it('banner: the pinned deck, else the most liked, else the newest', async () => {
    const owner = await person('banner');
    await deck(owner, { art: 'old.jpg', publishedAt: 1000 });
    const liked = await deck(owner, { art: 'liked.jpg', likeCount: 5, publishedAt: 2000 });
    const pinned = await deck(owner, { art: 'pinned.jpg', publishedAt: 3000 });
    await deck(owner, { art: null, likeCount: 99, publishedAt: 4000 });
    const banner = async () =>
      (await request(app).get(`/api/public/brewers?q=${owner.username}`)).body.brewers[0]
        .bannerImage;
    expect(await banner()).toBe('liked.jpg');
    await pool.query(`UPDATE users SET pinned_deck_slug = $2 WHERE id = $1`, [owner.id, pinned]);
    expect(await banner()).toBe('pinned.jpg');
    // A pin that stopped being live falls back rather than showing dead art.
    await pool.query(`UPDATE deck_publications SET unpublished_at = 1 WHERE slug = $1`, [pinned]);
    expect(await banner()).toBe('liked.jpg');
    await pool.query(`UPDATE deck_publications SET like_count = 0 WHERE slug = $1`, [liked]);
    await pool.query(`UPDATE deck_publications SET published_at = 9000 WHERE deck_name <> $1`, [
      liked,
    ]);
    expect(await banner()).toBe('old.jpg');
  });
});

describe('GET /api/public/brewers/rails', () => {
  it('returns every rail empty when nobody qualifies', async () => {
    const res = await request(app).get('/api/public/brewers/rails');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      newest: [],
      mostLiked: [],
      mostFollowed: [],
      sharedCommanders: [],
      spotlight: null,
    });
  });

  it('newest: most recently joined accounts with a live deck, max 8, no house account', async () => {
    const made: Fixture[] = [];
    for (let i = 0; i < 10; i++) {
      const p = await person('new', { createdAt: 1000 + i });
      await deck(p);
      made.push(p);
    }
    const empty = await person('new-nodeck', { createdAt: 9999 });
    const house = await person('new-house', { createdAt: 9998, official: true });
    await deck(house);
    const hidden = await person('new-hidden', { createdAt: 9997 });
    await deck(hidden);
    await pool.query(`UPDATE users SET profile_hidden_at = 1 WHERE id = $1`, [hidden.id]);
    void empty;
    const res = await request(app).get('/api/public/brewers/rails');
    expect(names(res.body.newest)).toEqual(
      made
        .slice(2)
        .reverse()
        .map((p) => p.username)
    );
  });

  it('mostLiked needs three DISTINCT non-owner likers per brewer', async () => {
    const two = await person('liked-two');
    const three = await person('liked-three');
    const ownerLiked = await person('liked-owner');
    const twoDeck = await deck(two);
    const threeDeckA = await deck(three);
    const threeDeckB = await deck(three);
    const ownDeck = await deck(ownerLiked);
    const [a, b, c] = await fans('liker', 3);
    // two: only two people, one of them liking both decks' worth of nothing extra.
    await like(a, twoDeck, two);
    await like(b, twoDeck, two);
    // three: three people, one of whom liked two decks (still one person).
    await like(a, threeDeckA, three);
    await like(a, threeDeckB, three);
    await like(b, threeDeckB, three);
    await like(c, threeDeckA, three);
    // owner liking their own deck adds a person to no one.
    await like(ownerLiked, ownDeck, ownerLiked);
    await like(a, ownDeck, ownerLiked);
    await like(b, ownDeck, ownerLiked);
    const res = await request(app).get('/api/public/brewers/rails');
    expect(names(res.body.mostLiked)).toEqual([three.username]);
  });

  it('mostLiked ignores likes on decks that are no longer live', async () => {
    const owner = await person('liked-dead');
    const dead = await deck(owner, { live: false });
    for (const p of await fans('deadliker', 3)) await like(p, dead, owner);
    await deck(owner);
    const res = await request(app).get('/api/public/brewers/rails');
    expect(res.body.mostLiked).toEqual([]);
  });

  it('mostFollowed needs three followers and ranks by people', async () => {
    const big = await person('fol-big');
    const mid = await person('fol-mid');
    const small = await person('fol-small');
    for (const p of [big, mid, small]) await deck(p);
    const crowd = await fans('crowd', 5);
    for (const f of crowd) await follow(f, big);
    for (const f of crowd.slice(0, 3)) await follow(f, mid);
    for (const f of crowd.slice(0, 2)) await follow(f, small);
    const res = await request(app).get('/api/public/brewers/rails');
    expect(names(res.body.mostFollowed)).toEqual([big.username, mid.username]);
    expect(res.body.mostFollowed[0].followerCount).toBe(5);
  });

  it('people rails leave out hidden and house accounts', async () => {
    const hidden = await person('rail-hidden');
    const house = await person('rail-house', { official: true });
    for (const p of [hidden, house]) {
      await deck(p);
      for (const f of await fans('railfan', 3)) await follow(f, p);
    }
    await pool.query(`UPDATE users SET profile_hidden_at = 1 WHERE id = $1`, [hidden.id]);
    const res = await request(app).get('/api/public/brewers/rails');
    expect(res.body.mostFollowed).toEqual([]);
    expect(res.body.newest).toEqual([]);
  });

  it('leaves the viewer out of the people rails', async () => {
    const me = await viewer('railme');
    const other = await person('railother', { createdAt: 1 });
    await deck(me);
    await deck(other);
    for (const f of await fans('viewfan', 3)) {
      await follow(f, me);
      await follow(f, other);
    }
    const guest = await request(app).get('/api/public/brewers/rails');
    expect(names(guest.body.newest)).toContain(me.username);
    expect(names(guest.body.mostFollowed)).toContain(me.username);
    const signedIn = await request(app).get('/api/public/brewers/rails').set('Cookie', me.cookie);
    expect(names(signedIn.body.newest)).toEqual([other.username]);
    expect(names(signedIn.body.mostFollowed)).toEqual([other.username]);
  });

  it('sharedCommanders: signed in only, other brewers with the same commander', async () => {
    const me = await viewer('sharedme');
    const match = await person('shared-match');
    const twice = await person('shared-twice');
    const nope = await person('shared-nope');
    const hidden = await person('shared-hidden');
    await deck(me, { commander: 'Atraxa, Praetors Voice' });
    await deck(me, { commander: 'Krenko' });
    await deck(match, { commander: 'atraxa, praetors voice' });
    await deck(twice, { commander: 'Atraxa, Praetors Voice' });
    await deck(twice, { commander: 'Krenko' });
    await deck(nope, { commander: 'Someone Else' });
    await deck(hidden, { commander: 'Krenko' });
    await pool.query(`UPDATE users SET profile_hidden_at = 1 WHERE id = $1`, [hidden.id]);
    const guest = await request(app).get('/api/public/brewers/rails');
    expect(guest.body.sharedCommanders).toEqual([]);
    const res = await request(app).get('/api/public/brewers/rails').set('Cookie', me.cookie);
    // Two shared commanders outrank one; the viewer, a stranger's commander and a hidden account are out.
    expect(names(res.body.sharedCommanders)).toEqual([twice.username, match.username]);
  });

  it('spotlight: a brewer with two live decks, stable within a day, null when none qualify', async () => {
    const one = await person('spot-one');
    await deck(one);
    expect((await request(app).get('/api/public/brewers/rails')).body.spotlight).toBeNull();
    const two = await person('spot-two');
    await deck(two);
    await deck(two);
    brewerRailsCache.clear();
    const first = (await request(app).get('/api/public/brewers/rails')).body.spotlight;
    expect(first.username).toBe(two.username);
    brewerRailsCache.clear();
    const again = (await request(app).get('/api/public/brewers/rails')).body.spotlight;
    expect(again.username).toBe(two.username);
  });

  it('serves the viewer-agnostic rails from a 60 s cache, and a purge clears it', async () => {
    const a = await person('cache-a');
    await deck(a);
    const before = await request(app).get('/api/public/brewers/rails');
    expect(names(before.body.newest)).toEqual([a.username]);
    const b = await person('cache-b');
    await deck(b);
    const cached = await request(app).get('/api/public/brewers/rails');
    expect(names(cached.body.newest)).toEqual([a.username]);
    brewerRailsCache.clear();
    const fresh = await request(app).get('/api/public/brewers/rails');
    expect(new Set(names(fresh.body.newest))).toEqual(new Set([a.username, b.username]));
  });
});

describe('spotlightIndex', () => {
  it('is stable within a UTC day, in range, and moves across days', () => {
    const noon = Date.UTC(2026, 8, 29, 12);
    expect(spotlightIndex(noon, 7)).toBe(spotlightIndex(Date.UTC(2026, 8, 29, 23, 59), 7));
    const seen = new Set<number>();
    for (let d = 0; d < 40; d++) seen.add(spotlightIndex(noon + d * 86_400_000, 7));
    expect(seen.size).toBeGreaterThan(1);
    for (const i of seen) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(7);
    }
  });
});
