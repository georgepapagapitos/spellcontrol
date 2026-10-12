import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';
import { resourceLandingLookup } from '../publications/resource-pages';
import { loadDynamicEntries } from '../sitemap';

// Who can see a binder or a list (E401): Public / Friends / Private, for every
// kind of viewer. Public is a /b/:slug or /l/:slug page; Friends is a
// friends-audience share; Private is neither. Existing link shares keep working
// until the owner picks a rung.

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

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

async function befriend(a: string, aName: string, b: string, bName: string) {
  await request(app).post('/api/friends/requests').set('Cookie', a).send({ username: bName });
  const r = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', b)
    .send({ username: aName });
  expect(r.body.friendStatus).toBe('friends');
}

const card = (name: string, typeLine: string) => ({
  copyId: `copy-${name}`,
  name,
  scryfallId: `${name}-id`,
  setCode: 'cmr',
  setName: 'Commander Legends',
  collectorNumber: '1',
  rarity: 'uncommon',
  finish: 'nonfoil',
  foil: false,
  purchasePrice: 1,
  cmc: 1,
  typeLine,
  importId: 'import-1',
  sourceFormat: 'manabox',
  sourceCategory: 'x',
});

async function seed(cookie: string) {
  await setSnapshotViaSyncApi(request(app), cookie, {
    collection: {
      fileName: 'export.csv',
      cards: [card('Sol Ring', 'Artifact'), card('Llanowar Elves', 'Creature — Elf')],
      scryfallHits: 2,
      scryfallMisses: 0,
      uploadedAt: 1700000000000,
      lists: [
        {
          id: 'l-1',
          name: 'Wantlist',
          entries: [
            {
              id: 'e1',
              name: 'Mana Crypt',
              scryfallId: 'mc',
              setCode: 'eld',
              collectorNumber: '1',
              finish: 'nonfoil',
              quantity: 2,
            },
          ],
          order: 0,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
      ],
    },
    binders: [
      {
        id: 'b-1',
        name: 'Artifacts <b>',
        position: 0,
        filterGroups: [
          { filter: { typeChips: { chips: [{ value: 'artifact', negate: false }], joiners: [] } } },
        ],
        sorts: [{ field: 'color', dir: 'asc' }],
        pocketSize: 9,
        doubleSided: false,
        fixedCapacity: null,
        color: '#c2a14a',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ],
  });
}

const KINDS = [
  { kind: 'binder', segment: 'binders', id: 'b-1', name: 'Artifacts <b>', card: 'Sol Ring' },
  { kind: 'list', segment: 'lists', id: 'l-1', name: 'Wantlist', card: 'Mana Crypt' },
] as const;

for (const k of KINDS) {
  describe(`${k.kind} visibility`, () => {
    const names = {
      owner: `rv-own-${k.kind}`,
      friend: `rv-fri-${k.kind}`,
      stranger: `rv-str-${k.kind}`,
    };
    let owner: string;
    let friend: string;
    let stranger: string;

    beforeAll(async () => {
      owner = await makeUser(names.owner);
      friend = await makeUser(names.friend);
      stranger = await makeUser(names.stranger);
      await befriend(owner, names.owner, friend, names.friend);
      await seed(owner);
    });

    const publish = () =>
      request(app).post(`/api/publications/${k.segment}/${k.id}`).set('Cookie', owner);
    const unpublish = () =>
      request(app).delete(`/api/publications/${k.segment}/${k.id}`).set('Cookie', owner);
    const mint = (audience: 'link' | 'friends') =>
      request(app)
        .post('/api/shares')
        .set('Cookie', owner)
        .send({ kind: k.kind, resourceId: k.id, audience });
    const read = (path: string, cookie?: string) => {
      const r = request(app).get(path);
      return cookie ? r.set('Cookie', cookie) : r;
    };
    const slugOf = async () =>
      (await read(`/api/publications/${k.segment}/${k.id}`, owner)).body.publication.slug as string;

    it('private (never shared): any slug answers 404 for every viewer', async () => {
      for (const cookie of [undefined, owner, friend, stranger]) {
        expect((await read(`/api/public/${k.segment}/anything-12345678`, cookie)).status).toBe(404);
      }
      const status = await read(`/api/publications/${k.segment}/${k.id}`, owner);
      expect(status.body.publication).toBeNull();
    });

    it('a signed-out caller cannot publish; a foreign or missing id is 404', async () => {
      expect((await request(app).post(`/api/publications/${k.segment}/${k.id}`)).status).toBe(401);
      const foreign = await request(app)
        .post(`/api/publications/${k.segment}/${k.id}`)
        .set('Cookie', stranger);
      expect(foreign.status).toBe(404);
      const missing = await request(app)
        .post(`/api/publications/${k.segment}/nope`)
        .set('Cookie', owner);
      expect(missing.status).toBe(404);
    });

    it('a legacy link share keeps working until a rung is picked', async () => {
      const token = (await mint('link')).body.share.token as string;
      for (const cookie of [undefined, owner, friend, stranger]) {
        expect((await read(`/api/shares/public/${token}`, cookie)).status).toBe(200);
      }
    });

    it('public: every viewer reads the slug page; publishing retires the link share', async () => {
      const token = (await mint('link')).body.share.token as string;
      const pub = await publish();
      expect(pub.status).toBe(201);
      const slug = pub.body.publication.slug as string;
      expect(slug).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/);
      for (const cookie of [undefined, owner, friend, stranger]) {
        const res = await read(`/api/public/${k.segment}/${slug}`, cookie);
        expect(res.status).toBe(200);
        expect(res.body.kind).toBe(k.kind);
        expect(res.body.data.name).toBe(k.name);
      }
      expect((await read(`/api/shares/public/${token}`)).status).toBe(404);
      const other = k.kind === 'binder' ? 'lists' : 'binders';
      expect((await read(`/api/public/${other}/${slug}`)).status).toBe(404);
      expect((await publish()).body.publication.slug).toBe(slug);
    });

    it('public: listed on the profile and in the sitemap, with an indexable escaped landing', async () => {
      const profile = await read(`/api/public/users/${names.owner}`);
      const rows = profile.body[k.segment] as Array<{ slug: string; name: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe(k.name);
      const prefix = k.kind === 'binder' ? '/b/' : '/l/';
      expect((await loadDynamicEntries()).map((e) => e.path)).toContain(`${prefix}${rows[0].slug}`);

      const meta = await resourceLandingLookup(k.kind)(rows[0].slug);
      expect(meta?.indexable).toBe(true);
      expect(meta?.url).toBe(`https://spellcontrol.com${prefix}${rows[0].slug}`);
      expect(meta?.body).toContain(k.card);
      expect(meta?.body).not.toContain('<b>');
      expect(await resourceLandingLookup(k.kind)('nope-00000000')).toBeNull();
    });

    it('friends: friend and owner read it, a stranger gets 403, signed-out 401; the page is gone', async () => {
      const slug = await slugOf();
      const res = await mint('friends');
      expect(res.status).toBe(201);
      const token = res.body.share.token as string;
      expect((await read(`/api/shares/public/${token}`, owner)).status).toBe(200);
      expect((await read(`/api/shares/public/${token}`, friend)).status).toBe(200);
      expect((await read(`/api/shares/public/${token}`, stranger)).status).toBe(403);
      expect((await read(`/api/shares/public/${token}`)).status).toBe(401);
      for (const cookie of [undefined, owner, friend, stranger]) {
        expect((await read(`/api/public/${k.segment}/${slug}`, cookie)).status).toBe(404);
      }
      const profile = await read(`/api/public/users/${names.owner}`);
      expect(profile.body[k.segment]).toEqual([]);
      expect(await resourceLandingLookup(k.kind)(slug)).toBeNull();
    });

    it('private again: unpublish is retry-safe and the page 404s', async () => {
      const slug = (await publish()).body.publication.slug as string;
      expect((await unpublish()).status).toBe(204);
      expect((await unpublish()).status).toBe(404);
      expect((await read(`/api/public/${k.segment}/${slug}`)).status).toBe(404);
      const status = await read(`/api/publications/${k.segment}/${k.id}`, owner);
      expect(status.body.publication.unpublishedAt).not.toBeNull();
    });

    it('a deleted resource cannot be published', async () => {
      await setSnapshotViaSyncApi(request(app), owner, {
        collection: {
          fileName: 'x.csv',
          cards: [],
          scryfallHits: 0,
          scryfallMisses: 0,
          uploadedAt: 1,
          lists: [],
        },
        binders: [],
      });
      expect((await publish()).status).toBe(404);
    });
  });
}
