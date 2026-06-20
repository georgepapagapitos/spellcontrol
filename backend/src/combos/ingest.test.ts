import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import crypto from 'crypto';
import * as schema from '../db/schema';
import { setDbForTesting, closeDb } from '../db';
import { ingestCombos, parseVariant, streamSpellbookVariants, bracketTagToNumber } from './ingest';
import { testDatabaseUrl } from '../test-helpers';

/** Builds a minimal Response-shaped object whose `body` is a WHATWG
 * ReadableStream emitting `bodyText`. Lets us drive `streamSpellbookVariants`
 * end-to-end without hitting the network. */
function jsonStreamResponse(
  bodyText: string,
  init: { ok?: boolean; status?: number } = {}
): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bodyText));
      controller.close();
    },
  });
  return new Response(stream, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamSpellbookVariants', () => {
  it('streams variants out of a `{variants: [...]}` payload', async () => {
    const body = JSON.stringify({
      variants: [
        { id: 'a', uses: [{ card: { name: 'A', oracleId: 'oa' } }] },
        { id: 'b', uses: [{ card: { name: 'B', oracleId: 'ob' } }] },
        { id: 'c', uses: [{ card: { name: 'C', oracleId: 'oc' } }] },
      ],
      schemaVersion: 'v3',
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonStreamResponse(body));

    const seen: unknown[] = [];
    for await (const v of streamSpellbookVariants()) seen.push(v);

    expect(seen).toHaveLength(3);
    expect((seen[0] as { id: string }).id).toBe('a');
    expect((seen[2] as { id: string }).id).toBe('c');
  });

  it('streams variants out of a top-level `[...]` payload', async () => {
    const body = JSON.stringify([
      { id: 'x', uses: [{ card: { name: 'X', oracleId: 'ox' } }] },
      { id: 'y', uses: [{ card: { name: 'Y', oracleId: 'oy' } }] },
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonStreamResponse(body));

    const seen: unknown[] = [];
    for await (const v of streamSpellbookVariants()) seen.push(v);

    expect(seen.map((v) => (v as { id: string }).id)).toEqual(['x', 'y']);
  });

  it('tolerates leading whitespace before the JSON content', async () => {
    const body = '   \n\t  ' + JSON.stringify({ variants: [{ id: 'p' }] });
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonStreamResponse(body));

    const seen: unknown[] = [];
    for await (const v of streamSpellbookVariants()) seen.push(v);

    expect(seen).toHaveLength(1);
  });

  it('throws when the upstream response is not OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('upstream error', { status: 502 }));
    await expect(async () => {
      for await (const _ of streamSpellbookVariants()) break;
    }).rejects.toThrow(/HTTP 502/);
  });

  it('throws when the payload is neither an array nor an object', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonStreamResponse('"a string"'));
    await expect(async () => {
      for await (const _ of streamSpellbookVariants()) break;
    }).rejects.toThrow(/shape unrecognized/);
  });

  it('yields nothing when the variants key holds a scalar value', async () => {
    // Spec is `{variants: [...]}`; if Spellbook ever returned a scalar at
    // that key the under-key streamer should bail without yielding instead
    // of crashing.
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonStreamResponse(JSON.stringify({ variants: 'oops' }))
    );

    const seen: unknown[] = [];
    for await (const v of streamSpellbookVariants()) seen.push(v);

    expect(seen).toHaveLength(0);
  });
});

describe('parseVariant', () => {
  it('returns null when id is missing', () => {
    expect(parseVariant({ uses: [] })).toBeNull();
  });

  it('returns null when no cards have an oracle id', () => {
    expect(parseVariant({ id: 'x', uses: [{ card: { name: 'no oracle' } }] })).toBeNull();
  });

  it('parses a typical Spellbook variant shape', () => {
    const parsed = parseVariant({
      id: 'thoracle-consult',
      identity: 'UB',
      uses: [
        { card: { name: "Thassa's Oracle", oracleId: 'abc' } },
        { card: { name: 'Demonic Consultation', oracleId: 'def' } },
      ],
      produces: [
        { feature: { name: 'Win the game' } },
        { feature: { name: 'Exile your library' } },
      ],
      legalities: { commander: true, modern: false, vintage: 'restricted' },
      popularity: 12345,
      manaNeeded: '{U}{B}',
      easyPrerequisites: 'You have 2 mana.',
      notablePrerequisites: 'Library has at least 1 card.',
      description: 'Cast Demonic Consultation naming a card not in your library.',
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe('thoracle-consult');
    expect(parsed!.identity).toBe('ub');
    expect(parsed!.cards).toHaveLength(2);
    expect(parsed!.produces).toEqual(['Win the game', 'Exile your library']);
    expect(parsed!.legalities).toEqual({
      commander: 'legal',
      modern: 'not_legal',
      vintage: 'restricted',
    });
    expect(parsed!.popularity).toBe(12345);
    expect(parsed!.cardCount).toBe(2);
    expect(parsed!.prerequisites?.easy).toContain('You have 2 mana');
    expect(parsed!.prerequisites?.notable).toContain('Library has at least 1 card');
  });

  it('also accepts snake_case oracle_id', () => {
    const parsed = parseVariant({
      id: 'x',
      uses: [{ card: { name: 'Card', oracle_id: 'orc' } }],
    });
    expect(parsed!.cards[0].oracleId).toBe('orc');
  });

  it('dedupes duplicate oracle ids within one combo', () => {
    const parsed = parseVariant({
      id: 'dup',
      uses: [
        { card: { name: 'Same', oracleId: 'orc' } },
        { card: { name: 'Same again', oracleId: 'orc' } },
      ],
    });
    expect(parsed!.cards).toHaveLength(1);
  });

  it('reads bracketTag, not bracket — variant with bracketTag R yields bracket 4', () => {
    const result = parseVariant({
      id: 'x',
      uses: [{ card: { name: 'Card', oracleId: 'oa' } }],
      bracketTag: 'R',
      bracket: undefined,
    });
    expect(result?.bracket).toBe(4);
    expect(result?.bracketTag).toBe('R');
  });

  it('variant with bracketTag B is excluded (returns null)', () => {
    expect(
      parseVariant({
        id: 'x',
        uses: [{ card: { name: 'Card', oracleId: 'oa' } }],
        bracketTag: 'B',
      })
    ).toBeNull();
  });

  it('variant with no bracketTag yields bracket null', () => {
    const result = parseVariant({
      id: 'x',
      uses: [{ card: { name: 'Card', oracleId: 'oa' } }],
      bracketTag: undefined,
    });
    expect(result?.bracket).toBeNull();
    expect(result?.bracketTag).toBeNull();
  });

  it('old numeric v.bracket field is ignored in favour of bracketTag', () => {
    const result = parseVariant({
      id: 'x',
      uses: [{ card: { name: 'Card', oracleId: 'oa' } }],
      bracket: 3,
      bracketTag: undefined,
    });
    expect(result?.bracket).toBeNull(); // bracketTagToNumber(undefined) = null; v.bracket ignored
  });
});

describe('bracketTagToNumber', () => {
  it.each<[unknown, number | null]>([
    ['R', 4],
    ['S', 3],
    ['P', 3],
    ['O', 3],
    ['C', 2],
    ['E', null],
    ['B', null], // banned → null (excluded at parse, never stored)
    ['X', null], // unknown letter
    [undefined, null],
    [42, null], // wrong type
  ])('bracketTagToNumber(%s) → %s', (tag, expected) => {
    expect(bracketTagToNumber(tag)).toBe(expected);
  });
});

let pool: Pool;
let schemaName: string;

describe('ingestCombos (db)', () => {
  beforeAll(async () => {
    schemaName = `t_${crypto.randomBytes(6).toString('hex')}`;
    pool = new Pool({ connectionString: testDatabaseUrl(), max: 4 });
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schemaName}`).catch(() => {});
    });
    await pool.query(`SET search_path TO ${schemaName}`);
    await pool.query(`
      CREATE TABLE combos (
        id TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        produces JSONB NOT NULL,
        prerequisites JSONB,
        description TEXT,
        mana_needed TEXT,
        popularity INTEGER NOT NULL DEFAULT 0,
        legalities JSONB NOT NULL,
        card_count INTEGER NOT NULL,
        bracket INTEGER,
        bracket_tag TEXT,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE combo_cards (
        combo_id TEXT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
        oracle_id TEXT NOT NULL,
        card_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL,
        PRIMARY KEY (combo_id, oracle_id)
      );
      CREATE TABLE combo_ingest_runs (
        id TEXT PRIMARY KEY,
        started_at BIGINT NOT NULL,
        finished_at BIGINT,
        combos_written INTEGER,
        source TEXT NOT NULL,
        error TEXT
      );
    `);
    setDbForTesting(pool, drizzle(pool, { schema }));
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await closeDb();
    }
  });

  it('writes combos and combo_cards', async () => {
    const variants = [
      {
        id: 'c1',
        identity: 'U',
        uses: [
          { card: { name: 'Card A', oracleId: 'a' } },
          { card: { name: 'Card B', oracleId: 'b' } },
        ],
        produces: [{ feature: { name: 'Infinite mana' } }],
        legalities: { commander: true },
        popularity: 100,
      },
    ];
    const result = await ingestCombos(variants);
    expect(result.written).toBe(1);
    const combos = await pool.query('SELECT * FROM combos');
    expect(combos.rows).toHaveLength(1);
    const cards = await pool.query('SELECT * FROM combo_cards ORDER BY position');
    expect(cards.rows).toHaveLength(2);
    expect(cards.rows[0].oracle_id).toBe('a');
  });

  it('is idempotent — re-running yields the same final state', async () => {
    const variants = [
      {
        id: 'idem',
        identity: 'B',
        uses: [{ card: { name: 'X', oracleId: 'x' } }],
        produces: [{ feature: { name: 'Win' } }],
        legalities: { commander: true },
        popularity: 1,
      },
    ];
    await ingestCombos(variants);
    await ingestCombos(variants);
    const combos = await pool.query("SELECT * FROM combos WHERE id = 'idem'");
    expect(combos.rows).toHaveLength(1);
    const cards = await pool.query("SELECT * FROM combo_cards WHERE combo_id = 'idem'");
    expect(cards.rows).toHaveLength(1);
  });

  it('accepts an AsyncIterable source (streaming path) and inserts in batches', async () => {
    // Far more variants than FLUSH_AT (500) to exercise multiple flushes
    // within a single transaction.
    const TOTAL = 1200;
    async function* gen(): AsyncIterable<unknown> {
      for (let i = 0; i < TOTAL; i++) {
        yield {
          id: `streamed-${i}`,
          identity: '',
          uses: [{ card: { name: `Card ${i}`, oracleId: `oracle-${i}` } }],
          produces: [{ feature: { name: 'Infinite ETB' } }],
          legalities: { commander: true },
          popularity: i,
        };
      }
    }

    const result = await ingestCombos(gen());
    expect(result.written).toBe(TOTAL);

    const combos = await pool.query(
      "SELECT count(*)::int AS n FROM combos WHERE id LIKE 'streamed-%'"
    );
    expect(combos.rows[0].n).toBe(TOTAL);
    const cards = await pool.query(
      "SELECT count(*)::int AS n FROM combo_cards WHERE combo_id LIKE 'streamed-%'"
    );
    expect(cards.rows[0].n).toBe(TOTAL);
  });

  it('skips variants with no oracle ids and records the run', async () => {
    const variants = [
      {
        id: 'has',
        identity: '',
        uses: [{ card: { name: 'A', oracleId: 'oa' } }],
        produces: [],
        legalities: {},
        popularity: 0,
      },
      {
        id: 'noOracle',
        identity: '',
        uses: [{ card: { name: 'A' } }],
        produces: [],
        legalities: {},
        popularity: 0,
      },
    ];
    const result = await ingestCombos(variants);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
    const runs = await pool.query('SELECT * FROM combo_ingest_runs WHERE id = $1', [result.runId]);
    expect(runs.rows[0].finished_at).not.toBeNull();
    expect(runs.rows[0].error).toBeNull();
  });

  it('bracketTag S variant persisted with bracket 3 and bracket_tag S', async () => {
    await ingestCombos([
      {
        id: 'tag-s',
        identity: 'U',
        uses: [{ card: { name: 'Card A', oracleId: 'xa' } }],
        produces: [{ feature: { name: 'Win the game' } }],
        legalities: { commander: true },
        popularity: 1,
        bracketTag: 'S',
      },
    ]);
    const row = await pool.query("SELECT bracket, bracket_tag FROM combos WHERE id = 'tag-s'");
    expect(row.rows[0].bracket).toBe(3);
    expect(row.rows[0].bracket_tag).toBe('S');
  });

  it('bracketTag E variant persisted with bracket null', async () => {
    await ingestCombos([
      {
        id: 'tag-e',
        identity: 'G',
        uses: [{ card: { name: 'Card B', oracleId: 'xb' } }],
        produces: [{ feature: { name: 'Infinite mana' } }],
        legalities: { commander: true },
        popularity: 1,
        bracketTag: 'E',
      },
    ]);
    const row = await pool.query("SELECT bracket, bracket_tag FROM combos WHERE id = 'tag-e'");
    expect(row.rows[0].bracket).toBeNull();
    expect(row.rows[0].bracket_tag).toBe('E');
  });

  it('bracketTag B variant is excluded from ingest (skipped)', async () => {
    const result = await ingestCombos([
      {
        id: 'tag-b',
        identity: 'UB',
        uses: [{ card: { name: 'Card C', oracleId: 'xc' } }],
        produces: [{ feature: { name: 'Win the game' } }],
        legalities: { commander: false },
        popularity: 1,
        bracketTag: 'B',
      },
    ]);
    expect(result.skipped).toBe(1);
    const row = await pool.query("SELECT * FROM combos WHERE id = 'tag-b'");
    expect(row.rows).toHaveLength(0);
  });

  it('old numeric v.bracket field is ignored (proves dead path)', async () => {
    await ingestCombos([
      {
        id: 'old-bracket',
        identity: 'W',
        uses: [{ card: { name: 'Card D', oracleId: 'xd' } }],
        produces: [{ feature: { name: 'Win the game' } }],
        legalities: { commander: true },
        popularity: 1,
        bracket: 3,
        bracketTag: undefined,
      },
    ]);
    const row = await pool.query(
      "SELECT bracket, bracket_tag FROM combos WHERE id = 'old-bracket'"
    );
    expect(row.rows[0].bracket).toBeNull(); // bracketTagToNumber(undefined) = null
    expect(row.rows[0].bracket_tag).toBeNull();
  });
});
