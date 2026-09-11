// LIVE-DATA stress harness for the cube generator: a REAL collection × every
// cube size × every slider step, asserting the invariants the ad hoc A/Bs in
// #1408 (refinement must not gut interaction) and #1521 (must not erode
// creature share) measured by hand and never kept. Gated behind
// LIVE_CUBE_POOL (a file path) so a normal `npm test` never runs it.
//
//   cd frontend && LIVE_CUBE_POOL=/path/to/pool.json \
//     ./node_modules/.bin/vitest run src/lib/cube/generate.live.test.ts
//
// pool.json is `{ cards, facts }`:
//   cards — the owned collection, ONE row per unique name (EnrichedCard-shaped:
//           name, scryfallId, oracleId, colors, cmc, typeLine, edhrecRank), e.g.
//           `select distinct on (data->>'name') data from user_cards …` on the
//           dev Postgres;
//   facts — the `/api/cards/oracle-facts` answer for those names (POST 2000 at
//           a time to a running backend), i.e. exactly what the Build page
//           feeds `namesToCubePool`.
// LIVE_CUBE_OUTDIR overrides where the JSON report lands.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { EnrichedCard } from '@/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { generateCube, type CubeCard, type GeneratedCube, type Pick } from './generate';
import { namesToCubePool } from './pool';
import { filterPool, DEFAULT_POOL_FILTERS, type PoolFilters } from './pool-filters';
import type { OracleFacts } from './oracle';
import { CUBE_SIZES, targetsForSize, type CubeSize } from './targets';
import { draftablePoolAxes, scoreCube, type CubeScore } from './objective';

const here = dirname(fileURLToPath(import.meta.url));
const POOL_PATH = process.env.LIVE_CUBE_POOL;
const OUT_DIR = process.env.LIVE_CUBE_OUTDIR ?? join(tmpdir(), 'spellcontrol-live-cube');
const LEVELS = [0.3, 0.5, 0.7, 1] as const;
const TERMS = [
  'archetype',
  'glue',
  'color',
  'curve',
  'interaction',
  'power',
  'type',
  'total',
] as const;

interface Row {
  size: CubeSize;
  level: number;
  /** Pool filter preset for the filtered-pool panel; absent = the whole collection. */
  pool?: string;
  ms: number;
  total: number;
  archetype: number;
  interaction: number;
  removalCount: number;
  creatureShare: number;
  swaps: number;
}

const names = (cube: GeneratedCube) => cube.picks.map((p) => p.card.name);
const removalCount = (picks: Pick[]) =>
  picks.filter((p) => p.card.role === 'removal' || p.card.role === 'boardwipe').length;
const creatureShare = (picks: Pick[]) =>
  picks.filter((p) => /\bcreature\b/i.test(p.card.typeLine)).length / picks.length;

/** Deterministic shuffle (LCG) — same-pool → same-cube must hold in ANY input order. */
function shuffled<T>(xs: T[], seed = 42): T[] {
  const out = xs.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe.skipIf(!POOL_PATH)('cube generator LIVE stress (real collection)', () => {
  let pool: CubeCard[];
  /** The owned collection expanded to one row per copy (the dump carries a
   *  per-name `copies` count), so `filterPool`'s spares rule sees real counts. */
  let collection: EnrichedCard[];
  let facts: Map<string, OracleFacts>;
  const rows: Row[] = [];
  const goodstuffBySize = new Map<CubeSize, GeneratedCube>();

  beforeAll(async () => {
    const taggerData = JSON.parse(
      readFileSync(resolve(here, '..', '..', '..', 'public', 'tagger-tags.json'), 'utf8')
    ) as unknown;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/tagger-tags.json')) {
        return { ok: true, status: 200, json: async () => taggerData } as Response;
      }
      throw new Error(`[live-cube] unexpected fetch ${url}`);
    });
    await loadTaggerData();
    const file = JSON.parse(readFileSync(resolve(POOL_PATH!), 'utf8')) as {
      cards: EnrichedCard[];
      facts: OracleFacts[];
    };
    facts = new Map(file.facts.map((f) => [f.name, f]));
    collection = file.cards.flatMap((c) => {
      const copies = Math.max(1, (c as unknown as { copies?: number }).copies ?? 1);
      return Array.from({ length: copies }, (_, i) => ({ ...c, copyId: `${c.name}#${i}` }));
    });
    pool = namesToCubePool(
      file.cards.map((c) => c.name),
      file.cards,
      facts
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, 'cube-stress.json');
    const nonland = pool.filter((c) => !/\bland\b/i.test(c.typeLine));
    const summary = {
      poolSize: pool.length,
      nonland: nonland.length,
      creatures: nonland.filter((c) => /\bcreature\b/i.test(c.typeLine)).length,
      removal: pool.filter((c) => c.role === 'removal' || c.role === 'boardwipe').length,
      draftableAxes: draftablePoolAxes(pool),
    };
    writeFileSync(out, JSON.stringify({ ...summary, rows }, null, 2));
    const fmt = (n: number) => n.toFixed(3);
    console.log(
      ['size  level  ms     total  arch   inter  removal creature swaps']
        .concat(
          rows.map(
            (r) =>
              `${String(r.size).padEnd(5)} ${String(r.level).padEnd(6)} ${(r.pool ?? '').padEnd(8)} ${String(r.ms).padEnd(6)} ` +
              `${fmt(r.total)}  ${fmt(r.archetype)}  ${fmt(r.interaction)}  ${String(r.removalCount).padEnd(7)} ` +
              `${(r.creatureShare * 100).toFixed(1)}%    ${r.swaps}`
          )
        )
        .join('\n') + `\n→ ${out}`
    );
  });

  it('pool is the real thing: tagged, ranked, with draftable archetypes', () => {
    expect(pool.length).toBeGreaterThan(1000);
    const ranked = pool.filter((c) => c.rank != null).length / pool.length;
    const roled = pool.filter((c) => c.role).length;
    const tagged = pool.filter(
      (c) => (c.synergyProducers?.length ?? 0) + (c.synergyPayoffs?.length ?? 0) > 0
    ).length;
    expect(ranked).toBeGreaterThan(0.9);
    expect(roled).toBeGreaterThan(100);
    expect(tagged).toBeGreaterThan(100);
    expect(draftablePoolAxes(pool).length).toBeGreaterThanOrEqual(5);
  });

  // Pool filters (lib/cube/pool-filters): a peasant / pauper / spares cube is
  // built from a thinner, weaker pool — the generator must still fill it and
  // hold the corpus shape wherever the pool can, and every filter must leave
  // enough to build from on a real collection.
  describe('filtered pools', () => {
    const PRESETS: Record<string, Partial<PoolFilters>> = {
      peasant: { source: 'all', rarity: 'peasant' },
      pauper: { source: 'all', rarity: 'pauper' },
      spares: { source: 'all' },
    };
    for (const [preset, partial] of Object.entries(PRESETS)) {
      it(`${preset} pool builds a full 360 at both ends of the slider`, () => {
        const all = new Set(collection.map((c) => c.name));
        const filtered = filterPool(collection, all, {
          ...DEFAULT_POOL_FILTERS,
          ...partial,
          ...(preset === 'spares' ? { source: 'spares' as const } : {}),
        });
        // Each preset must leave a real pool on this collection.
        expect(filtered.names.length).toBeGreaterThan(360);
        const sub = namesToCubePool(filtered.names, collection, facts);
        const band = targetsForSize(360);
        for (const level of [0, 1]) {
          const t = Date.now();
          const cube = generateCube(sub, 360, { synergyLevel: level });
          const ms = Date.now() - t;
          expect(cube.shortfall).toBe(0);
          expect(new Set(cube.picks.map((p) => p.card.oracleId)).size).toBe(360);
          const s = cube.score ?? scoreCube(cube.picks, sub, band, 360);
          for (const k of TERMS) {
            expect(s[k]).toBeGreaterThanOrEqual(0);
            expect(s[k]).toBeLessThanOrEqual(1);
          }
          rows.push({
            size: 360,
            level,
            pool: preset,
            ms,
            total: s.total,
            archetype: s.archetype,
            interaction: s.interaction,
            removalCount: removalCount(cube.picks),
            creatureShare: creatureShare(cube.picks),
            swaps: 0,
          });
        }
      });
    }
  });

  for (const size of CUBE_SIZES) {
    describe(`${size} cards`, () => {
      const band = targetsForSize(size);

      it('goodstuff (slider 0): full, singleton, unscored, order-independent', () => {
        const t = Date.now();
        const cube = generateCube(pool, size, { synergyLevel: 0 });
        const ms = Date.now() - t;
        goodstuffBySize.set(size, cube);
        expect(cube.shortfall).toBe(0);
        expect(cube.picks).toHaveLength(size);
        expect(new Set(cube.picks.map((p) => p.card.oracleId)).size).toBe(size);
        expect(cube.score).toBeUndefined();
        // Byte-for-byte the no-options path, and independent of pool order.
        expect(names(generateCube(pool, size))).toEqual(names(cube));
        expect(names(generateCube(shuffled(pool), size, { synergyLevel: 0 }))).toEqual(names(cube));
        const s = scoreCube(cube.picks, pool, band, size);
        // E285/E286 guards on the SEED: the greedy reserves role + creature
        // quotas, so the goodstuff cube already carries the corpus shape —
        // interaction on target (term ≥ 0.9) and creature share at or above
        // the corpus p25 — before any refinement.
        expect(s.interaction).toBeGreaterThanOrEqual(0.9);
        expect(creatureShare(cube.picks)).toBeGreaterThanOrEqual(band.type.creature.p25 - 0.01);
        rows.push({
          size,
          level: 0,
          ms,
          total: s.total,
          archetype: s.archetype,
          interaction: s.interaction,
          removalCount: removalCount(cube.picks),
          creatureShare: creatureShare(cube.picks),
          swaps: 0,
        });
      });

      for (const level of LEVELS) {
        it(`synergy ${level}: refined beats its seed without gutting shape`, () => {
          const goodstuff = goodstuffBySize.get(size)!;
          const t = Date.now();
          const cube = generateCube(pool, size, { synergyLevel: level });
          const ms = Date.now() - t;

          // Still a legal cube.
          expect(cube.shortfall).toBe(0);
          expect(cube.picks).toHaveLength(size);
          expect(new Set(cube.picks.map((p) => p.card.oracleId)).size).toBe(size);
          const owned = new Set(pool.map((c) => c.oracleId));
          for (const p of cube.picks) expect(owned.has(p.card.oracleId)).toBe(true);
          // Swaps are in-bucket: the color split is the greedy's, untouched.
          expect(cube.byBucket).toEqual(goodstuff.byBucket);

          // Objective is well-formed and the refiner never lost to its seed
          // under the SAME weights.
          const score = cube.score as CubeScore;
          expect(score).toBeDefined();
          for (const k of TERMS) {
            expect(score[k]).toBeGreaterThanOrEqual(0);
            expect(score[k]).toBeLessThanOrEqual(1);
          }
          // The seed is scored against the RAW pool here (duplicates + basics
          // still in), while generateCube scores against its deduped pool, so
          // rankP80 — and with it the power term — differs in the 4th decimal.
          // A 1e-3 tolerance absorbs that basis gap, not a real regression.
          const seed = scoreCube(goodstuff.picks, pool, band, size, undefined, level);
          expect(score.total).toBeGreaterThanOrEqual(seed.total - 1e-3);
          // Engaging synergy deepens archetypes — that is the slider's promise.
          expect(score.archetype).toBeGreaterThanOrEqual(seed.archetype - 1e-9);

          // #1408 guard: refinement must not pay for archetypes with the cube's
          // removal (the shipped design once cut it 23.5% → 12.6%).
          expect(removalCount(cube.picks)).toBeGreaterThanOrEqual(
            Math.floor(0.9 * removalCount(goodstuff.picks))
          );
          // #1521 / E285 guard: refinement must not erode creature share below
          // the corpus p25 floor (the seed lands at the median now).
          const creatures = creatureShare(cube.picks);
          expect(creatures).toBeGreaterThanOrEqual(band.type.creature.p25 - 0.01);

          // Same pool in any order → same cube (only checked at max synergy, the
          // slowest path; the seed is already checked above).
          if (level === 1) {
            expect(names(generateCube(shuffled(pool), size, { synergyLevel: level }))).toEqual(
              names(cube)
            );
          }

          const seedNames = new Set(names(goodstuff));
          rows.push({
            size,
            level,
            ms,
            total: score.total,
            archetype: score.archetype,
            interaction: score.interaction,
            removalCount: removalCount(cube.picks),
            creatureShare: creatures,
            swaps: cube.picks.filter((p) => !seedNames.has(p.card.name)).length,
          });
        });
      }
    });
  }
});
