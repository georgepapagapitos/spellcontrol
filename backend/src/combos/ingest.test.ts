import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import crypto from 'crypto';
import * as schema from '../db/schema';
import { setDbForTesting, closeDb } from '../db';
import { ingestCombos, parseVariant } from './ingest';
import { dbTestsEnabled, testDatabaseUrl } from '../test-helpers';

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
});

const d = dbTestsEnabled ? describe : describe.skip;

let pool: Pool;
let schemaName: string;

d('ingestCombos (db)', () => {
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
});
