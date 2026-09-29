import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import type { DeckSections } from '../deck-import';
import type { ProductSummary } from '../products';
import type { ScryfallCard } from '../types';
import { loadTrendingDecks } from '../aggregates/trending-decks';
import { OFFICIAL_USER_ID, OFFICIAL_USERNAME } from './official-account';
import { syncPrecons, type PreconSource } from './seed';
import { preconDeckId, releaseDateMs } from './precon-deck';

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

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-28T12:00:00Z');

function card(name: string, identity: string[] = ['G']): ScryfallCard {
  return {
    id: `${name}-id`,
    oracle_id: `${name}-oracle`,
    name,
    color_identity: identity,
    type_line: 'Legendary Creature',
    prices: { usd: '1.00' },
    image_uris: { normal: `https://cards.scryfall.io/normal/${name}.jpg` },
  } as unknown as ScryfallCard;
}

function sections(
  commander: string,
  partner?: string,
  fetchErrorNames: string[] = []
): DeckSections {
  const cards = Array.from({ length: 98 }, (_, i) => card(`${commander} filler ${i}`));
  // The resolver lists a partner among the cards as well (deck-import.ts).
  if (partner) cards.unshift(card(partner));
  return {
    commander: card(commander),
    partner: partner ? card(partner) : null,
    companion: null,
    cards,
    sideboard: [],
    considering: [],
    unresolvedNames: [],
    fetchErrorNames,
  };
}

const PRODUCTS: ProductSummary[] = [
  {
    fileName: 'Heavenly_CMD',
    code: 'CMD',
    name: 'Heavenly Inferno',
    type: 'Commander Deck',
    releaseDate: '2011-06-17',
  },
  {
    fileName: 'Partners_C16',
    code: 'C16',
    name: 'Breed Lethality',
    type: 'Commander Deck',
    releaseDate: '2016-11-11',
  },
];

function fakeSource(
  products: ProductSummary[],
  resolved: Record<string, DeckSections | null>
): PreconSource & { resolves: string[] } {
  const resolves: string[] = [];
  return {
    resolves,
    list: async () => products,
    resolve: async (fileName) => {
      resolves.push(fileName);
      return resolved[fileName] ?? null;
    },
  };
}

const RESOLVED = {
  Heavenly_CMD: sections('Kaalia of the Vast'),
  Partners_C16: sections('Ishai, Ojutai Dragonspeaker', 'Reyhan, Last of the Abzan'),
};

async function publicationFor(fileName: string) {
  const { rows } = await pool.query<{ slug: string; published_at: string; card_count: number }>(
    `SELECT slug, published_at, card_count FROM deck_publications WHERE user_id = $1 AND deck_id = $2`,
    [OFFICIAL_USER_ID, preconDeckId(fileName)]
  );
  return rows[0];
}

async function register(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(res.status).toBe(201);
  return extractSessionCookie(res.headers['set-cookie'])!;
}

describe('syncPrecons', () => {
  it('publishes every precon under the house account, dated by release', async () => {
    const source = fakeSource(PRODUCTS, RESOLVED);
    const result = await syncPrecons(source, { now: NOW });
    expect(result).toEqual({ published: 2, refreshed: 0, skipped: 0 });

    const user = await pool.query<{
      username: string;
      is_official: boolean;
      password_hash: string | null;
    }>(`SELECT username, is_official, password_hash FROM users WHERE id = $1`, [OFFICIAL_USER_ID]);
    expect(user.rows[0]).toEqual({
      username: OFFICIAL_USERNAME,
      is_official: true,
      password_hash: null,
    });

    const kaalia = await publicationFor('Heavenly_CMD');
    expect(Number(kaalia.published_at)).toBe(releaseDateMs('2011-06-17'));
    expect(kaalia.card_count).toBe(99);

    // The partner sits in the command zone and comes out of the 99.
    const partners = await pool.query<{
      data: { partnerCommander: { name: string }; cards: unknown[] };
    }>(`SELECT data FROM user_decks WHERE user_id = $1 AND id = $2`, [
      OFFICIAL_USER_ID,
      preconDeckId('Partners_C16'),
    ]);
    expect(partners.rows[0].data.partnerCommander.name).toBe('Reyhan, Last of the Abzan');
    expect(partners.rows[0].data.cards).toHaveLength(98);
    expect((await publicationFor('Partners_C16')).card_count).toBe(100);
  });

  it('does nothing on a rerun while the stored copies are fresh', async () => {
    const source = fakeSource(PRODUCTS, RESOLVED);
    const result = await syncPrecons(source, { now: NOW + DAY });
    expect(result).toEqual({ published: 0, refreshed: 0, skipped: 0 });
    expect(source.resolves).toEqual([]);
  });

  it('refreshes stale copies, oldest first and bounded, keeping slug and date', async () => {
    const before = await publicationFor('Heavenly_CMD');
    const source = fakeSource(PRODUCTS, RESOLVED);
    const result = await syncPrecons(source, { now: NOW + 8 * DAY, refreshLimit: 1 });
    expect(result).toEqual({ published: 0, refreshed: 1, skipped: 0 });
    expect(source.resolves).toHaveLength(1);

    const after = await publicationFor('Heavenly_CMD');
    expect(after.slug).toBe(before.slug);
    expect(after.published_at).toBe(before.published_at);
  });

  it('skips a precon whose resolve could not reach Scryfall, and one with no commander', async () => {
    const products: ProductSummary[] = [
      ...PRODUCTS,
      {
        fileName: 'Outage_X',
        code: 'X',
        name: 'Outage',
        type: 'Commander Deck',
        releaseDate: '2024-01-01',
      },
      {
        fileName: 'NoCmdr_Y',
        code: 'Y',
        name: 'No Commander',
        type: 'Commander Deck',
        releaseDate: '2024-01-01',
      },
    ];
    const noCommander = { ...sections('Nobody'), commander: null };
    const source = fakeSource(products, {
      ...RESOLVED,
      Outage_X: sections('Somebody', undefined, ['Somebody filler 3']),
      NoCmdr_Y: noCommander,
    });
    const result = await syncPrecons(source, { now: NOW + 8 * DAY, refreshLimit: 0 });
    expect(result).toEqual({ published: 0, refreshed: 0, skipped: 2 });
    expect(await publicationFor('Outage_X')).toBeUndefined();
    expect(await publicationFor('NoCmdr_Y')).toBeUndefined();
  });
});

describe('the house account stays out of community surfaces', () => {
  it('Discover lists precons only on their own shelf', async () => {
    const community = await request(app).get('/api/discover/decks');
    expect(community.status).toBe(200);
    expect(
      community.body.decks.some(
        (d: { ownerUsername: string }) => d.ownerUsername === OFFICIAL_USERNAME
      )
    ).toBe(false);

    const precons = await request(app).get('/api/discover/decks?source=precons');
    expect(precons.status).toBe(200);
    const names = precons.body.decks.map((d: { name: string }) => d.name);
    // Newest release first.
    expect(names).toEqual(['Breed Lethality', 'Heavenly Inferno']);
  });

  it('the commander typeahead follows the shelf', async () => {
    const community = await request(app).get('/api/discover/decks/commanders?q=Kaa');
    expect(community.body.commanders).toEqual([]);
    const precons = await request(app).get('/api/discover/decks/commanders?q=Kaa&source=precons');
    expect(precons.body.commanders).toEqual(['Kaalia of the Vast']);
  });

  it('a precon never trends, however many players like it', async () => {
    const { slug } = await publicationFor('Heavenly_CMD');
    for (const name of ['liker-a', 'liker-b', 'liker-c']) {
      const cookie = await register(name);
      const like = await request(app)
        .post(`/api/discover/decks/${slug}/like`)
        .set('Cookie', cookie);
      expect(like.status).toBe(201);
    }
    const trending = await loadTrendingDecks(Date.now());
    expect(trending.map((d) => d.slug)).not.toContain(slug);
  });

  it('user search and friend requests skip it', async () => {
    const cookie = await register('seeker');
    const search = await request(app).get('/api/users/search?q=spellc').set('Cookie', cookie);
    expect(search.status).toBe(200);
    expect(search.body.users).toEqual([]);

    const friend = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', cookie)
      .send({ username: OFFICIAL_USERNAME });
    expect(friend.status).toBe(404);
  });

  it('its profile and deck pages say it is official', async () => {
    const profile = await request(app).get(`/api/public/users/${OFFICIAL_USERNAME}`);
    expect(profile.status).toBe(200);
    expect(profile.body.isOfficial).toBe(true);
    expect(profile.body.displayName).toBe('SpellControl');
    expect(profile.body.decks.map((d: { name: string }) => d.name)).toEqual([
      'Breed Lethality',
      'Heavenly Inferno',
    ]);
    expect(profile.body.collection.canView).toBe(false);

    const { slug } = await publicationFor('Heavenly_CMD');
    const page = await request(app).get(`/api/public/decks/${slug}`);
    expect(page.status).toBe(200);
    expect(page.body.official).toBe(true);
  });
});

describe('an upcoming precon', () => {
  it('is dated today, never in the future', async () => {
    const upcoming: ProductSummary = {
      fileName: 'Upcoming_ZZZ',
      code: 'ZZZ',
      name: 'Not Out Yet',
      type: 'Commander Deck',
      releaseDate: '2027-03-01',
    };
    const source = fakeSource([...PRODUCTS, upcoming], {
      ...RESOLVED,
      Upcoming_ZZZ: sections('Future Commander'),
    });
    await syncPrecons(source, { now: NOW + 2 * DAY, refreshLimit: 0 });
    expect(Number((await publicationFor('Upcoming_ZZZ')).published_at)).toBe(NOW + 2 * DAY);
  });
});
