import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { ensureSchema, setDbForTesting } from './index';
import { createTestEnv, testDatabaseUrl, type TestEnv } from '../test-helpers';

/**
 * Schema parity: `ensureSchema()` vs the test harness's own DDL.
 *
 * The backend has TWO independent definitions of the same schema:
 *
 *   1. `db/index.ts` `ensureSchema()` — what production actually runs at boot.
 *   2. `test-helpers.ts` `createTestEnv()` — what every backend test runs against.
 *
 * Nothing compared them, so a column added to one and forgotten in the other
 * drifted silently: every test stayed green (they use the harness copy) while
 * production ran the other one. That is the failure mode behind the standing
 * "ensureSchema DDL is untested" warning.
 *
 * This test closes it by building both schemas for real and diffing them at
 * the column level. Add a table or column to one and this fails until you add
 * it to the other, naming exactly what is missing and where.
 *
 * It deliberately does NOT assert any particular table exists — it only asserts
 * the two definitions agree, so it needs no maintenance as the schema grows.
 */

/** table name → (column name → data type) */
type ColumnMap = Map<string, Map<string, string>>;

async function introspect(pool: Pool, schemaName: string): Promise<ColumnMap> {
  const res = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, column_name`,
    [schemaName]
  );
  const out: ColumnMap = new Map();
  for (const row of res.rows) {
    let cols = out.get(row.table_name);
    if (!cols) {
      cols = new Map();
      out.set(row.table_name, cols);
    }
    cols.set(row.column_name, row.data_type);
  }
  return out;
}

/** `table.column` for every entry, sorted — a diffable flat shape. */
function flatten(map: ColumnMap): string[] {
  const out: string[] = [];
  for (const [table, cols] of map) {
    for (const col of cols.keys()) out.push(`${table}.${col}`);
  }
  return out.sort();
}

describe('schema parity — ensureSchema() vs the test harness DDL', () => {
  let prodSchema: string;
  let prodPool: Pool;
  let env: TestEnv;
  let harnessSchema: string;

  let prod: ColumnMap;
  let harness: ColumnMap;

  beforeAll(async () => {
    const url = testDatabaseUrl();

    // ── Side A: run the real ensureSchema() into a throwaway schema ─────────
    prodSchema = `t_parity_${crypto.randomBytes(4).toString('hex')}`;
    const bootstrap = new Pool({ connectionString: url, max: 1 });
    await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${prodSchema}`);
    await bootstrap.end();

    // search_path must be a connection startup parameter, not a later SET —
    // see the long note in test-helpers.ts createTestEnv() for why.
    prodPool = new Pool({
      connectionString: url,
      max: 2,
      options: `-c search_path=${prodSchema}`,
    });
    setDbForTesting(prodPool, drizzle(prodPool, { schema }));
    await ensureSchema();
    prod = await introspect(prodPool, prodSchema);

    // ── Side B: the harness's own DDL (this re-points the module-level pool) ─
    env = await createTestEnv();
    const cur = await env.pool.query<{ s: string }>('SELECT current_schema() AS s');
    harnessSchema = cur.rows[0].s;
    harness = await introspect(env.pool, harnessSchema);
  }, 60_000);

  afterAll(async () => {
    await env?.cleanup();
    if (prodPool) {
      await prodPool.query(`DROP SCHEMA IF EXISTS ${prodSchema} CASCADE`).catch(() => {});
      await prodPool.end().catch(() => {});
    }
  });

  it('both definitions actually produced a schema', () => {
    // Guards against a silently empty run making the diffs below trivially pass.
    expect(prod.size).toBeGreaterThan(0);
    expect(harness.size).toBeGreaterThan(0);
  });

  it('defines the same set of tables', () => {
    const inProd = [...prod.keys()].sort();
    const inHarness = [...harness.keys()].sort();

    const missingFromHarness = inProd.filter((t) => !harness.has(t));
    const missingFromProd = inHarness.filter((t) => !prod.has(t));

    // Names go in the message, not just the diff — vitest collapses nested
    // objects to `{ …(2) }`, which would hide the very thing you need to see.
    expect(
      missingFromHarness,
      `ensureSchema() creates these tables but test-helpers.ts createTestEnv() ` +
        `does not, so no test ever exercises them: ${missingFromHarness.join(', ')}`
    ).toEqual([]);

    expect(
      missingFromProd,
      `test-helpers.ts createTestEnv() creates these tables but ensureSchema() ` +
        `does not, so tests rely on something production never builds: ${missingFromProd.join(', ')}`
    ).toEqual([]);
  });

  it('defines the same columns on every shared table', () => {
    const flatProd = flatten(prod);
    const flatHarness = flatten(harness);

    const missingFromHarness = flatProd.filter((c) => !flatHarness.includes(c));
    const missingFromProd = flatHarness.filter((c) => !flatProd.includes(c));

    // Production-only drift is the dangerous direction: every test stays green
    // while production runs a column the suite has never seen.
    expect(
      missingFromHarness,
      `ensureSchema() creates these columns but test-helpers.ts createTestEnv() ` +
        `does not — production-only drift, invisible to the whole suite. ` +
        `Add them to createTestEnv(): ${missingFromHarness.join(', ')}`
    ).toEqual([]);

    expect(
      missingFromProd,
      `test-helpers.ts createTestEnv() creates these columns but ensureSchema() ` +
        `does not — tests depend on something production never creates. ` +
        `Add them to ensureSchema(): ${missingFromProd.join(', ')}`
    ).toEqual([]);
  });

  it('agrees on column data types', () => {
    const mismatches: { column: string; ensureSchema: string; harness: string }[] = [];
    for (const [table, cols] of prod) {
      const other = harness.get(table);
      if (!other) continue;
      for (const [col, type] of cols) {
        const otherType = other.get(col);
        if (otherType && otherType !== type) {
          mismatches.push({ column: `${table}.${col}`, ensureSchema: type, harness: otherType });
        }
      }
    }

    expect(
      mismatches,
      'A column has a different type in each definition. Tests would pass ' +
        'against one representation while production stores another.'
    ).toEqual([]);
  });
});
