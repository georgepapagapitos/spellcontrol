import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import {
  codeFromFooter,
  lfgMessage,
  nudgeLfgPosts,
  resetLfgPostsForTests,
  syncLfgPosts,
} from './discord-lfg';
import { onGameChange } from './live-registry';
import type { GameListing } from './sessions';

const CHANNEL = 'lfg-1';
const API = 'https://discord.com/api/v10';

interface FakeMessage {
  id: string;
  author: { id: string };
  embeds: Array<{ title?: string; description?: string; footer?: { text?: string } }>;
  components?: Array<{ components: Array<{ label: string; url: string }> }>;
}

let app: Server;
let cleanup: () => Promise<void>;
let messages: FakeMessage[];
let nextId: number;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

// A stand-in for the channel-message calls discord.ts makes; anything that
// isn't discord.com goes to the real fetch.
beforeEach(() => {
  messages = [];
  nextId = 1;
  resetLfgPostsForTests();
  process.env.DISCORD_BOT_TOKEN = 'bot-token';
  process.env.DISCORD_GUILD_ID = 'guild-1';
  process.env.DISCORD_TABLES_CATEGORY_ID = 'cat-1';
  process.env.DISCORD_LFG_CHANNEL_ID = CHANNEL;
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(API)) return realFetch(input, init);
    const path = url.slice(API.length);
    const method = init?.method ?? 'GET';
    if (path === '/users/@me') return Response.json({ id: 'bot' });
    if (method === 'GET' && path.startsWith(`/channels/${CHANNEL}/messages`)) {
      return Response.json([...messages].reverse());
    }
    if (method === 'POST' && path === `/channels/${CHANNEL}/messages`) {
      const m = { id: `m${nextId++}`, author: { id: 'bot' }, ...JSON.parse(String(init!.body)) };
      messages.push(m);
      return Response.json(m);
    }
    const one = path.match(new RegExp(`^/channels/${CHANNEL}/messages/(.+)$`));
    if (one && method === 'PATCH') {
      const i = messages.findIndex((m) => m.id === one[1]);
      messages[i] = { ...messages[i], ...JSON.parse(String(init!.body)) };
      return Response.json(messages[i]);
    }
    if (one && method === 'DELETE') {
      messages = messages.filter((m) => m.id !== one[1]);
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of [
    'DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID',
    'DISCORD_TABLES_CATEGORY_ID',
    'DISCORD_LFG_CHANNEL_ID',
  ]) {
    delete process.env[k];
  }
});

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  return extractSessionCookie(res.headers['set-cookie'])!;
}

async function hostGame(tag: string, body: Record<string, unknown>) {
  const hostCookie = await registerAndGetCookie(tag);
  const created = await request(app).post('/api/games').set('Cookie', hostCookie).send(body);
  return {
    hostCookie,
    code: created.body.game.code as string,
    version: created.body.game.version as number,
  };
}

const postFor = (code: string) =>
  messages.find((m) => m.embeds[0]?.footer?.text === `Table ${code}`);

function listing(overrides: Partial<GameListing> = {}): GameListing {
  return {
    code: 'TK7T',
    name: 'Friday pod',
    format: 'commander',
    status: 'lobby',
    seated: 2,
    max: 4,
    joinable: true,
    visibility: 'public',
    bracket: null,
    ...overrides,
  };
}

describe('lfgMessage', () => {
  it('says what the table is and links straight to its join form', () => {
    const body = lfgMessage(listing({ bracket: { min: 2, max: 3 } }), null);
    expect(body.embeds[0].title).toBe('Friday pod');
    expect(body.embeds[0].description).toBe('Commander · 2 of 4 seated, 2 open · Brackets 2–3');
    // Past a pod of four, the table still takes players.
    expect(lfgMessage(listing({ seated: 5, max: 10 }), null).embeds[0].description).toBe(
      'Commander · 5 seated, room for more'
    );
    // A one-player table promises the pod, not the ten-seat cap.
    expect(lfgMessage(listing({ seated: 1, max: 10 }), null).embeds[0].description).toBe(
      'Commander · 1 of 4 seated, 3 open'
    );
    expect(body.embeds[0].footer.text).toBe('Table TK7T');
    expect(body.components[0].components).toEqual([
      expect.objectContaining({
        label: 'Join on SpellControl',
        url: 'https://spellcontrol.com/play/online?mode=join&code=TK7T',
      }),
    ]);
  });

  it('adds the voice table when there is one, and a single bracket reads as one', () => {
    const body = lfgMessage(listing({ bracket: { min: 3, max: 3 } }), 'https://discord.gg/inv');
    expect(body.embeds[0].description).toContain('· Bracket 3');
    expect(body.components[0].components[1]).toMatchObject({
      label: 'Join the voice table',
      url: 'https://discord.gg/inv',
    });
  });

  // The table name is typed by a player; it must never ping the server.
  it('pings nobody', () => {
    expect(lfgMessage(listing({ name: '@everyone come play' }), null).allowed_mentions).toEqual({
      parse: [],
    });
  });
});

describe('codeFromFooter', () => {
  it('reads back only a table code', () => {
    expect(codeFromFooter('Table TK7T')).toBe('TK7T');
    for (const text of [undefined, '', 'Table', 'Table tk7t', 'Table TK7T2', 'Rules']) {
      expect(codeFromFooter(text), String(text)).toBe(null);
    }
  });
});

describe('syncLfgPosts', () => {
  it('posts a public lobby, and never a private or friends one', async () => {
    const pub = await hostGame('lfg_pub', { visibility: 'public', name: 'Open pod' });
    const priv = await hostGame('lfg_priv', { visibility: 'private' });
    const friends = await hostGame('lfg_friends', { visibility: 'friends' });
    await syncLfgPosts(true);
    expect(postFor(pub.code)?.embeds[0].title).toBe('Open pod');
    expect(postFor(priv.code)).toBeUndefined();
    expect(postFor(friends.code)).toBeUndefined();
  });

  it('edits the post as a seat fills, and does nothing when nothing changed', async () => {
    const { code } = await hostGame('lfg_seat', { visibility: 'public' });
    await syncLfgPosts(true);
    const id = postFor(code)!.id;
    expect(postFor(code)!.embeds[0].description).toContain('1 of 4 seated');

    const joiner = await registerAndGetCookie('lfg_seat_joiner');
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner).send({});
    await syncLfgPosts();
    expect(postFor(code)!.id).toBe(id);
    expect(postFor(code)!.embeds[0].description).toContain('2 of 4 seated');

    const before = messages.length;
    await syncLfgPosts();
    expect(messages).toHaveLength(before);
  });

  it('removes the post when the table goes private or closes', async () => {
    const a = await hostGame('lfg_gone_a', { visibility: 'public' });
    const b = await hostGame('lfg_gone_b', { visibility: 'public' });
    await syncLfgPosts(true);
    expect(postFor(a.code)).toBeDefined();
    expect(postFor(b.code)).toBeDefined();

    await request(app)
      .patch(`/api/games/${a.code}`)
      .set('Cookie', a.hostCookie)
      .send({
        baseVersion: a.version,
        actions: [{ type: 'settings', patch: { visibility: 'private' } }],
      });
    await request(app).post(`/api/games/${b.code}/leave`).set('Cookie', b.hostCookie).send({});
    await syncLfgPosts();
    expect(postFor(a.code)).toBeUndefined();
    expect(postFor(b.code)).toBeUndefined();
  });

  it('after a restart, adopts its old post and clears duplicates and strays', async () => {
    const { code } = await hostGame('lfg_restart', { visibility: 'public' });
    await syncLfgPosts(true);
    const kept = postFor(code)!.id;
    // A second post for the same table and a stray bot message, as a crash
    // mid-pass or an old release could leave behind.
    messages.push({
      id: 'dup',
      author: { id: 'bot' },
      embeds: [{ footer: { text: `Table ${code}` } }],
    });
    messages.push({ id: 'stray', author: { id: 'bot' }, embeds: [{ title: 'old' }] });
    messages.push({ id: 'human', author: { id: 'someone' }, embeds: [] });

    resetLfgPostsForTests();
    await syncLfgPosts(true);
    expect(
      messages.filter((m) => m.embeds[0]?.footer?.text === `Table ${code}`).map((m) => m.id)
    ).toEqual([kept]);
    expect(messages.some((m) => m.id === 'stray')).toBe(false);
    // A person's message is never the bot's to touch.
    expect(messages.some((m) => m.id === 'human')).toBe(true);
  });

  it('does nothing when the channel is not set', async () => {
    delete process.env.DISCORD_LFG_CHANNEL_ID;
    await hostGame('lfg_off', { visibility: 'public' });
    await syncLfgPosts(true);
    expect(messages).toHaveLength(0);
  });

  it('a change to a public table posts it within seconds, without a pass being asked for', async () => {
    // server.ts registers this at boot; the test env doesn't boot it.
    const off = onGameChange(nudgeLfgPosts);
    try {
      const { code } = await hostGame('lfg_nudge', { visibility: 'public' });
      await vi.waitFor(() => expect(postFor(code)).toBeDefined(), { timeout: 5000 });
    } finally {
      off();
    }
  });

  it('a private table never schedules a pass', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setTimeout');
    nudgeLfgPosts('PRIV', { visibility: 'private' } as never);
    expect(spy).not.toHaveBeenCalled();
  });
});
