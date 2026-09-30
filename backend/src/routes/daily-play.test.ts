import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { resetArtCache } from '../daily/art';
import { setDailyDataDir } from '../daily/data';
import { FIXTURE_ART, POOL_NAMES, poolCard, writeDailyFixture } from '../daily/fixture';
import { getPuzzle, puzzleNumber, todayUtc } from '../daily/puzzle';

let app: Server;
let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  setDailyDataDir(writeDailyFixture());
  const env = await createTestEnv();
  app = env.app;
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  setDailyDataDir(null);
  if (cleanup) await cleanup();
});

let seq = 0;
async function makeUser(prefix: string): Promise<{ cookie: string; id: string }> {
  seq += 1;
  const username = `${prefix}-${seq}`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, id: me.body.user.id as string };
}

const TODAY = todayUtc();

/** Make `name` (a fixture pool card) today's answer. */
async function setAnswer(name: string): Promise<void> {
  await pool.query(
    `INSERT INTO daily_puzzles (puzzle_date, number, name, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, 1)
     ON CONFLICT (puzzle_date) DO UPDATE SET name = EXCLUDED.name, payload = EXCLUDED.payload`,
    [TODAY, puzzleNumber(TODAY), name, JSON.stringify(poolCard(name))]
  );
}

async function seedUsed(dates: string[], names: string[]): Promise<void> {
  for (const [i, date] of dates.entries()) {
    await pool.query(
      `INSERT INTO daily_puzzles (puzzle_date, number, name, payload, created_at)
       VALUES ($1, 1, $2, '{}'::jsonb, 1)`,
      [date, names[i]]
    );
  }
}

describe('getPuzzle', () => {
  it('picks once per date, stably, even for concurrent first requests', async () => {
    const date = '2031-03-03';
    const all = await Promise.all([1, 2, 3, 4].map(() => getPuzzle(date)));
    expect(new Set(all.map((p) => p.name)).size).toBe(1);
    expect(POOL_NAMES).toContain(all[0]!.name);
    expect((await getPuzzle(date)).name).toBe(all[0]!.name);
    const { rows } = await pool.query(`SELECT 1 FROM daily_puzzles WHERE puzzle_date = $1`, [date]);
    expect(rows).toHaveLength(1);
  });

  it('numbers days from puzzle #1 on 2026-09-30', () => {
    expect(puzzleNumber('2026-09-30')).toBe(1);
    expect(puzzleNumber('2026-10-04')).toBe(5);
  });

  it('skips answers used in the previous year', async () => {
    await seedUsed(['2040-01-01', '2040-01-02', '2040-01-03'], POOL_NAMES.slice(0, 3));
    expect((await getPuzzle('2040-01-10')).name).toBe(POOL_NAMES[3]);
  });

  it('falls back to the whole pool when every card was used recently', async () => {
    await seedUsed(['2050-01-01', '2050-01-02', '2050-01-03', '2050-01-04'], POOL_NAMES);
    expect(POOL_NAMES).toContain((await getPuzzle('2050-01-10')).name);
  });

  it('freezes the whole pool entry it picked', async () => {
    const p = await getPuzzle('2031-03-04');
    expect(p.payload).toEqual(poolCard(p.name));
    expect(p.payload.art).toBe(FIXTURE_ART);
  });
});

const play = (body: unknown, cookie?: string) => {
  const r = request(app).post('/api/daily/play');
  if (cookie) r.set('Cookie', cookie);
  return r.send(body as object);
};

describe('POST /api/daily/play as a guest', () => {
  beforeEach(() => setAnswer('Sol Ring'));

  it('returns the empty state for an empty body', async () => {
    const res = await play({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: TODAY,
      number: puzzleNumber(TODAY),
      maxGuesses: 6,
      status: 'playing',
      guesses: [],
      artLevel: 0,
      answer: null,
    });
    expect(res.body.clues).toEqual([{ label: 'Mana value', value: '1' }]);
  });

  it('scores a miss and unlocks a second clue', async () => {
    const res = await play({ guess: 'lightning bolt' });
    expect(res.body.status).toBe('playing');
    expect(res.body.guesses).toEqual([
      {
        name: 'Lightning Bolt',
        cells: {
          colors: { value: 'R', mark: 'miss' },
          mv: { value: 1, mark: 'hit' },
          type: { value: 'Instant', mark: 'miss' },
          rarity: { value: 'common', mark: 'near' },
          year: { value: 1993, mark: 'hit' },
        },
      },
    ]);
    expect(res.body.clues.map((c: { label: string }) => c.label)).toEqual(['Mana value', 'Colors']);
    expect(res.body.artLevel).toBe(1);
  });

  it('never leaks the answer name or art while playing', async () => {
    const res = await play({ guesses: ['Counterspell', 'Lightning Bolt'], guess: 'Black Lotus' });
    expect(res.body.status).toBe('playing');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Sol Ring');
    expect(text).not.toContain(FIXTURE_ART);
    expect(res.body.answer).toBeNull();
  });

  it('solves: status, answer and all six clues', async () => {
    const res = await play({ guesses: ['Counterspell'], guess: 'SOL RING' });
    expect(res.body.status).toBe('solved');
    expect(res.body.artLevel).toBeNull();
    expect(res.body.clues).toHaveLength(6);
    expect(res.body.clues[5]).toEqual({ label: 'First letter', value: 'S' });
    expect(res.body.answer).toEqual({
      name: 'Sol Ring',
      typeLine: 'Artifact',
      setName: 'Test Set',
      year: 1993,
      colors: '',
      art: FIXTURE_ART,
    });
  });

  it('fails on give-up and after six misses', async () => {
    const gave = await play({ guesses: ['Counterspell'], giveUp: true });
    expect(gave.body.status).toBe('failed');
    expect(gave.body.answer.name).toBe('Sol Ring');
    const six = await play({
      guesses: [
        'Counterspell',
        'Lightning Bolt',
        'Black Lotus',
        'Wear',
        'Llanowar Elves',
        'Swords to Plowshares',
      ],
    });
    expect(six.body.status).toBe('failed');
    expect(six.body.guesses).toHaveLength(6);
  });

  it('matches split-card faces and returns the full name', async () => {
    const res = await play({ guess: 'tear' });
    expect(res.body.guesses[0].name).toBe('Wear // Tear');
  });

  it('rejects bad input with the documented messages', async () => {
    const unknown = 'No card by that name. Pick one from the list.';
    const finished = "Today's card is already finished.";
    const cases: [unknown, string][] = [
      [{ guess: 'Not A Card' }, unknown],
      [{ guess: 7 }, unknown],
      [{ guesses: [7] }, unknown],
      [
        { guesses: ['Counterspell'], guess: 'counterspell' },
        "You've already guessed Counterspell.",
      ],
      [{ guesses: ['Sol Ring'], guess: 'Counterspell' }, finished],
      [{ guesses: ['Sol Ring', 'Counterspell'] }, finished],
      [{ guesses: Array(7).fill('Counterspell') }, "That's more than six guesses."],
      [{ guesses: 'Counterspell' }, 'Send guesses as a list of card names.'],
    ];
    for (const [body, error] of cases) {
      const res = await play(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe(error);
    }
  });
});

describe('POST /api/daily/play signed in', () => {
  beforeEach(() => setAnswer('Sol Ring'));

  it('persists guesses across calls and ignores body.guesses', async () => {
    const u = await makeUser('pp');
    await play({ guess: 'Counterspell' }, u.cookie);
    const res = await play({ guesses: ['Black Lotus', 'Wear'], guess: 'Lightning Bolt' }, u.cookie);
    expect(res.body.guesses.map((g: { name: string }) => g.name)).toEqual([
      'Counterspell',
      'Lightning Bolt',
    ]);
    const again = await play({}, u.cookie);
    expect(again.body.guesses).toHaveLength(2);
    expect(again.body.clues).toHaveLength(3);
    const { rows } = await pool.query(`SELECT 1 FROM daily_results WHERE user_id = $1`, [u.id]);
    expect(rows).toHaveLength(0);
  });

  it('records a solve with the guess count and blocks further guesses', async () => {
    const u = await makeUser('ps');
    await play({ guess: 'Counterspell' }, u.cookie);
    const res = await play({ guess: 'Sol Ring' }, u.cookie);
    expect(res.body.status).toBe('solved');
    const { rows } = await pool.query(
      `SELECT solved, guesses FROM daily_results WHERE user_id = $1 AND puzzle_date = $2`,
      [u.id, TODAY]
    );
    expect(rows).toEqual([{ solved: true, guesses: 2 }]);
    const late = await play({ guess: 'Black Lotus' }, u.cookie);
    expect(late.status).toBe(400);
    expect(late.body.error).toBe("Today's card is already finished.");
    const state = await play({}, u.cookie);
    expect(state.body.status).toBe('solved');
    expect(state.body.answer.name).toBe('Sol Ring');
  });

  it('give-up fails the day and records six guesses', async () => {
    const u = await makeUser('pg');
    await play({ guess: 'Counterspell' }, u.cookie);
    const res = await play({ giveUp: true }, u.cookie);
    expect(res.body.status).toBe('failed');
    const { rows } = await pool.query(
      `SELECT solved, guesses FROM daily_results WHERE user_id = $1 AND puzzle_date = $2`,
      [u.id, TODAY]
    );
    expect(rows).toEqual([{ solved: false, guesses: 6 }]);
  });

  it('a rejected guess stores nothing', async () => {
    const u = await makeUser('pr');
    expect((await play({ guess: 'Not A Card' }, u.cookie)).status).toBe(400);
    expect((await play({}, u.cookie)).body.guesses).toEqual([]);
  });
});

describe('GET /api/daily/art', () => {
  let jpeg: Buffer;
  const fetchMock = vi.fn();
  const art = (query: string, cookie?: string) => {
    const r = request(app).get(`/api/daily/art?${query}`);
    if (cookie) r.set('Cookie', cookie);
    return r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  };
  const same = (a: { body: unknown }, b: { body: unknown }) =>
    (a.body as Buffer).equals(b.body as Buffer);

  beforeEach(async () => {
    resetArtCache();
    await setAnswer('Sol Ring');
    jpeg = await sharp(randomBytes(240 * 160 * 3), {
      raw: { width: 240, height: 160, channels: 3 },
    })
      .jpeg()
      .toBuffer();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(new Uint8Array(jpeg)));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('404s for any date but today and 400s for a bad level', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect((await art(`date=${yesterday}&level=0`)).status).toBe(404);
    expect((await art('level=0')).status).toBe(404);
    for (const level of ['6', '-1', 'x', '1.5', '']) {
      expect((await art(`date=${TODAY}&level=${level}`)).status, level).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a blurred 480px JPEG, private-cached, and fetches the source once', async () => {
    const a = await art(`date=${TODAY}&level=5`);
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toBe('image/jpeg');
    expect(a.headers['cache-control']).toBe('private, max-age=86400');
    expect((await sharp(a.body as Buffer).metadata()).width).toBe(480);
    await art(`date=${TODAY}&level=0`);
    await art(`date=${TODAY}&level=5`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(FIXTURE_ART);
  });

  it('clamps a signed-in level to the misses while the puzzle is open', async () => {
    const u = await makeUser('art');
    const guest0 = await art(`date=${TODAY}&level=0`);
    const guest5 = await art(`date=${TODAY}&level=5`);
    expect(same(guest0, guest5)).toBe(false);
    expect(same(await art(`date=${TODAY}&level=5`, u.cookie), guest0)).toBe(true);
    await play({ guess: 'Counterspell' }, u.cookie);
    const guest1 = await art(`date=${TODAY}&level=1`);
    expect(same(await art(`date=${TODAY}&level=5`, u.cookie), guest1)).toBe(true);
    // Finished: the level asked for is served.
    await play({ giveUp: true }, u.cookie);
    expect(same(await art(`date=${TODAY}&level=5`, u.cookie), guest5)).toBe(true);
  });

  it('502s when the source cannot be fetched, without exposing the URL', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));
    const res = await request(app).get(`/api/daily/art?date=${TODAY}&level=2`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Couldn't load today's art." });
    expect(JSON.stringify(res.body)).not.toContain(FIXTURE_ART);
    fetchMock.mockImplementation(async () => {
      throw new Error('timeout');
    });
    resetArtCache();
    expect((await request(app).get(`/api/daily/art?date=${TODAY}&level=2`)).status).toBe(502);
  });
});
