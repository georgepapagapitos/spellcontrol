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
import { loadCubeSignal } from './signal';
import { ensureCardTags, getCardTags } from '@/lib/card-tags';
import { formatExclusion } from './play-format';
import {
  generateCube,
  pairOf,
  pairsFixedBy,
  COLOR_PAIRS,
  type ColorPair,
  type CubeCard,
  type GeneratedCube,
  type Pick,
} from './generate';
import { namesToCubePool } from './pool';
import {
  filterPool,
  DEFAULT_POOL_FILTERS,
  type PoolFilters,
  type PoolHidden,
} from './pool-filters';
import type { OracleFacts } from './oracle';
import { CUBE_SIZES, targetsForSize, type CubeSize } from './targets';
import { draftablePoolAxes, scoreCube, type CubeScore } from './objective';
import { simulateDraft } from './draft-sim';

const here = dirname(fileURLToPath(import.meta.url));
const POOL_PATH = process.env.LIVE_CUBE_POOL;
const OUT_DIR = process.env.LIVE_CUBE_OUTDIR ?? join(tmpdir(), 'spellcontrol-live-cube');
const LEVELS = [0.3, 0.5, 0.7, 1] as const;
const TERMS = [
  'archetype',
  'pairConcentration',
  'glue',
  'color',
  'curve',
  'interaction',
  'power',
  'type',
  'total',
] as const;

/**
 * The PRE-pair-aware-program weighted total (T150 W4 item 3 added an 8th term,
 * `pairConcentration`, so `score.total` is no longer comparable to a `main`
 * baseline run before that term existed). Recomputes the OLD `weightsFor` —
 * archetype weight = 0.4 * synergyLevel, the rest scaled up to fill the
 * remainder, exactly as `objective.ts` did before this change — from the same
 * seven terms this change didn't touch, so a size×level row's `oldTotal` here
 * is the apples-to-apples number against a `main` baseline JSON's `total` AT
 * THE SAME LEVEL (the weights are level-dependent, not flat — using the flat
 * level-1 weights at every level overstates the "regression" at low levels,
 * where the old code leaned harder on the environment terms).
 */
const OLD_W = {
  archetype: 0.4,
  glue: 0.12,
  color: 0.13,
  curve: 0.13,
  interaction: 0.09,
  power: 0.05,
  type: 0.08,
} as const;
function oldTotal(s: CubeScore, synergyLevel: number): number {
  const archetype = OLD_W.archetype * synergyLevel;
  const k = (1 - archetype) / (1 - OLD_W.archetype);
  const weighted =
    archetype * s.archetype +
    OLD_W.glue * k * s.glue +
    OLD_W.color * k * s.color +
    OLD_W.curve * k * s.curve +
    OLD_W.interaction * k * s.interaction +
    OLD_W.power * k * s.power +
    OLD_W.type * k * s.type;
  return s.fixingMultiplier * weighted;
}

interface Row {
  size: CubeSize;
  level: number;
  /** Pool filter preset for the filtered-pool panel; absent = the whole collection. */
  pool?: string;
  ms: number;
  total: number;
  /** See `oldTotal` — the number comparable to a pre-pairConcentration baseline. */
  oldTotal: number;
  archetype: number;
  interaction: number;
  removalCount: number;
  creatureShare: number;
  /** Ramp picks as a share of NONLAND picks — the corpus basis for role targets. */
  rampShare: number;
  swaps: number;
}

const names = (cube: GeneratedCube) => cube.picks.map((p) => p.card.name);
const removalCount = (picks: Pick[]) =>
  picks.filter((p) => p.card.role === 'removal' || p.card.role === 'boardwipe').length;
const creatureShare = (picks: Pick[]) =>
  picks.filter((p) => /\bcreature\b/i.test(p.card.typeLine)).length / picks.length;
const rampShare = (picks: Pick[]) => {
  const nonland = picks.filter((p) => !/\bland\b/i.test(p.card.typeLine));
  return nonland.filter((p) => p.card.role === 'ramp').length / Math.max(1, nonland.length);
};

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
  /** The same collection with nothing excluded — the `commander` format's pool. */
  let commanderPool: CubeCard[];
  let limitedHidden: PoolHidden;
  const rows: Row[] = [];
  const goodstuffBySize = new Map<CubeSize, GeneratedCube>();

  beforeAll(async () => {
    const taggerData = JSON.parse(
      readFileSync(resolve(here, '..', '..', '..', 'public', 'tagger-tags.json'), 'utf8')
    ) as unknown;
    const signalData = JSON.parse(
      readFileSync(resolve(here, '..', '..', '..', 'public', 'cube-signal.json'), 'utf8')
    ) as unknown;
    const otagData = JSON.parse(
      readFileSync(resolve(here, '..', '..', '..', 'public', 'otag-index.json'), 'utf8')
    ) as unknown;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/tagger-tags.json')) {
        return { ok: true, status: 200, json: async () => taggerData } as Response;
      }
      if (url.endsWith('/cube-signal.json')) {
        return { ok: true, status: 200, json: async () => signalData } as Response;
      }
      if (url.endsWith('/otag-index.json')) {
        return { ok: true, status: 200, json: async () => otagData } as Response;
      }
      throw new Error(`[live-cube] unexpected fetch ${url}`);
    });
    await Promise.all([loadTaggerData(), loadCubeSignal(), ensureCardTags()]);
    const file = JSON.parse(readFileSync(resolve(POOL_PATH!), 'utf8')) as {
      cards: EnrichedCard[];
      facts: OracleFacts[];
    };
    facts = new Map(file.facts.map((f) => [f.name, f]));
    collection = file.cards.flatMap((c) => {
      const copies = Math.max(1, (c as unknown as { copies?: number }).copies ?? 1);
      return Array.from({ length: copies }, (_, i) => ({ ...c, copyId: `${c.name}#${i}` }));
    });
    // The pool the Build page feeds the generator: every owned name through
    // the DEFAULT filters (available, any price/rarity, LIMITED format — so the
    // Commander-only and politics cards are already out).
    const allNames = new Set(file.cards.map((c) => c.name));
    limitedHidden = filterPool(collection, allNames, DEFAULT_POOL_FILTERS).hidden;
    pool = namesToCubePool(
      filterPool(collection, allNames, DEFAULT_POOL_FILTERS).names,
      file.cards,
      facts
    );
    commanderPool = namesToCubePool(
      filterPool(collection, allNames, { ...DEFAULT_POOL_FILTERS, format: 'commander' }).names,
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
    const goodstuffPicks = Object.fromEntries(
      [...goodstuffBySize].map(([size, cube]) => [size, names(cube)])
    );
    writeFileSync(out, JSON.stringify({ ...summary, rows, goodstuffPicks }, null, 2));
    const fmt = (n: number) => n.toFixed(3);
    console.log(
      ['size  level  pool     ms     total  oldTot arch   inter  removal creature ramp   swaps']
        .concat(
          rows.map(
            (r) =>
              `${String(r.size).padEnd(5)} ${String(r.level).padEnd(6)} ${(r.pool ?? '').padEnd(8)} ${String(r.ms).padEnd(6)} ` +
              `${fmt(r.total)}  ${fmt(r.oldTotal)}  ${fmt(r.archetype)}  ${fmt(r.interaction)}  ${String(r.removalCount).padEnd(7)} ` +
              `${(r.creatureShare * 100).toFixed(1)}%    ${(r.rampShare * 100).toFixed(1)}%  ${r.swaps}`
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
    // The cube signal is the ranking's primary key — it must cover most of a
    // real collection, or the EDHREC fallback is silently doing the ranking.
    const signalled = pool.filter((c) => c.cubePop != null).length / pool.length;
    expect(signalled).toBeGreaterThan(0.75);
  });

  // E288 guard: the play format is a POOL rule. In a limited cube no pick may
  // need a commander or the command zone, at any size or slider level — and the
  // exclusion is visible (counted) rather than silent.
  describe('play format', () => {
    it('limited leaves the Commander-only and politics cards out, and counts them', () => {
      expect(limitedHidden.commanderOnly).toBeGreaterThanOrEqual(10);
      expect(limitedHidden.politics).toBeGreaterThanOrEqual(10);
      expect(commanderPool.length - pool.length).toBe(
        limitedHidden.commanderOnly + limitedHidden.politics
      );
    });

    for (const size of CUBE_SIZES) {
      for (const level of [0, 1] as const) {
        it(`${size} @ ${level}: no command-zone card in a limited cube`, () => {
          const cube = generateCube(pool, size, { synergyLevel: level });
          expect(cube.format).toBe('limited');
          const offenders = cube.picks
            .map((p) => p.card.name)
            .filter((n) => formatExclusion('limited', getCardTags(n)) !== null);
          expect(offenders).toEqual([]);
        });
      }
    }

    it('commander keeps them in and builds a full 360 at both slider ends', () => {
      const band = targetsForSize(360, 'commander');
      for (const level of [0, 1] as const) {
        const cube = generateCube(commanderPool, 360, { synergyLevel: level, format: 'commander' });
        expect(cube.format).toBe('commander');
        expect(cube.shortfall).toBe(0);
        expect(new Set(cube.picks.map((p) => p.card.oracleId)).size).toBe(360);
        const s = level === 0 ? scoreCube(cube.picks, commanderPool, band, 360) : cube.score!;
        expect(s.interaction).toBeGreaterThanOrEqual(0.9);
        expect(creatureShare(cube.picks)).toBeGreaterThanOrEqual(band.type.creature.p25 - 0.01);
        expect(rampShare(cube.picks)).toBeLessThanOrEqual(band.role.ramp.p75 + 0.01);
        rows.push({
          size: 360,
          level,
          pool: 'commander',
          ms: 0,
          total: s.total,
          oldTotal: oldTotal(s, level),
          archetype: s.archetype,
          interaction: s.interaction,
          removalCount: removalCount(cube.picks),
          creatureShare: creatureShare(cube.picks),
          rampShare: rampShare(cube.picks),
          swaps: 0,
        });
      }
      // Command-zone cards are ELIGIBLE here — the ranking decides from there.
      // (Ranked by all-cube popularity, Signet/Tower at ~4% still lose a 360 to
      // 15–25% staples; a Commander-band inclusion signal is the follow-up.)
      expect(
        commanderPool.some(
          (c) => formatExclusion('limited', getCardTags(c.name)) === 'commanderOnly'
        )
      ).toBe(true);
    });
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
            oldTotal: oldTotal(s, level),
            archetype: s.archetype,
            interaction: s.interaction,
            removalCount: removalCount(cube.picks),
            creatureShare: creatureShare(cube.picks),
            rampShare: rampShare(cube.picks),
            swaps: 0,
          });
        }
      });
    }
  });

  // Cube edit (locks/bans) on the real collection: guards still hold at 360
  // with a real slate of locked + banned cards — locks present, bans absent.
  describe('cube edit — locked and banned', () => {
    it('~20 locked and ~20 banned at 360: locks present, bans absent, guards hold', () => {
      const sorted = [...pool].sort((a, b) => a.oracleId.localeCompare(b.oracleId));
      const locked = sorted.slice(0, 20);
      const lockedIds = new Set(locked.map((c) => c.oracleId));
      const banned = sorted
        .slice(20)
        .filter((c) => !lockedIds.has(c.oracleId))
        .slice(0, 20)
        .map((c) => c.oracleId);
      const bannedSet = new Set(banned);

      for (const level of [0, 1]) {
        const cube = generateCube(pool, 360, { synergyLevel: level, locked, banned });
        // Singleton, owned-or-locked-bound (a locked card may not be in `pool`,
        // but here every locked card IS owned, so the whole cube is pool-bound).
        const ids = cube.picks.map((p) => p.card.oracleId);
        expect(new Set(ids).size).toBe(ids.length);
        // Every locked card made it in.
        for (const id of lockedIds) expect(ids).toContain(id);
        // No banned card made it in.
        for (const id of bannedSet) expect(ids).not.toContain(id);
        expect(cube.shortfall).toBe(0);
      }
    });
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
        // E288 guard: roles are capped at the corpus p75 — quality order alone
        // filled 15–18% of a cube with ramp against an 8% corpus median.
        expect(rampShare(cube.picks)).toBeLessThanOrEqual(band.role.ramp.p75 + 0.01);
        rows.push({
          size,
          level: 0,
          ms,
          total: s.total,
          oldTotal: oldTotal(s, 0),
          archetype: s.archetype,
          interaction: s.interaction,
          removalCount: removalCount(cube.picks),
          creatureShare: creatureShare(cube.picks),
          rampShare: rampShare(cube.picks),
          swaps: 0,
        });
      });

      // Pair-aware guards (T150 W4 items 1/2): the goodstuff seed's gold
      // section and fixing lands are spread across the ten color pairs by the
      // corpus's own per-pair shape, not by popularity alone. Skip a pair the
      // POOL itself can't reach — that's a collection gap, not a generator bug.
      it('pair-aware gold: each pair with enough supply lands within the corpus band', () => {
        const cube = goodstuffBySize.get(size)!;
        const rawSupply = {} as Record<ColorPair, number>;
        const achieved = {} as Record<ColorPair, number>;
        for (const p of COLOR_PAIRS) {
          rawSupply[p] = 0;
          achieved[p] = 0;
        }
        for (const c of pool) {
          const pr = pairOf(c);
          if (pr) rawSupply[pr]++;
        }
        for (const p of cube.picks) {
          if (p.bucket !== 'multicolor') continue;
          const pr = pairOf(p.card);
          if (pr) achieved[pr]++;
        }
        // ±3 tolerance: pair gold counts are small (often single digits), so
        // largest-remainder apportionment quantization alone can miss the
        // band by 1-2 with no real imbalance — this still catches the failure
        // mode a popularity-only fill produces (a whole pair at 0 while
        // another eats several times its corpus share; see the ratio check
        // below), which misses by far more than quantization noise.
        for (const p of COLOR_PAIRS) {
          const lo = Math.round(band.pairs[p].gold.p25 * size);
          const hi = Math.round(band.pairs[p].gold.p75 * size);
          if (rawSupply[p] < lo) continue; // the pool can't reach the band for this pair
          expect(achieved[p], `${size}/${p} gold`).toBeGreaterThanOrEqual(Math.max(0, lo - 4));
          expect(achieved[p], `${size}/${p} gold`).toBeLessThanOrEqual(hi + 4);
        }
        // Max/min ratio across well-supplied pairs — catches the OLD failure
        // mode (a popularity-only fill lets the deepest pair eat the whole
        // bucket while a thinner one gets zero) without pinning an exact ratio.
        //
        // "No pair at zero" only holds from a bucket big enough to reserve a
        // floor for all ten pairs without crowding the bulk phase's OWN
        // interaction quota out of room (measured: a full ten-pair floor at
        // 180's ~18-card bucket dropped the seed's interaction term below the
        // corpus target) — the generator caps the floor reservation below that
        // point on purpose, so a genuinely tiny cube can leave a thin pair at
        // zero. `multicolor.median * size` is this bucket's own target size.
        const bucketSize = band.color.multicolor.median * size;
        const supplied = COLOR_PAIRS.filter((p) => rawSupply[p] >= 5);
        if (supplied.length >= 2) {
          const counts = supplied.map((p) => achieved[p]);
          const min = Math.min(...counts);
          const max = Math.max(...counts);
          if (bucketSize >= 25) {
            expect(min, `pair balance at ${size}: ${JSON.stringify(achieved)}`).toBeGreaterThan(0);
          }
          if (min > 0) expect(max / min).toBeLessThanOrEqual(8);
        }
      });

      it('pair-aware fixing lands: every pair the pool can fix gets at least one land', () => {
        const cube = goodstuffBySize.get(size)!;
        const poolLandPairs = new Set<ColorPair>();
        for (const c of pool) {
          if (!/\bland\b/i.test(c.typeLine)) continue;
          for (const p of pairsFixedBy(c)) poolLandPairs.add(p);
        }
        const achieved = new Set<ColorPair>();
        for (const p of cube.picks) {
          if (p.bucket !== 'land') continue;
          for (const pr of pairsFixedBy(p.card)) achieved.add(pr);
        }
        for (const p of COLOR_PAIRS) {
          if (band.pairs[p].fixingLands.median <= 0 || !poolLandPairs.has(p)) continue;
          expect(achieved.has(p), `${size}/${p} fixing land`).toBe(true);
        }
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
          // E288 guard: refinement must not re-inflate a capped role either.
          expect(rampShare(cube.picks)).toBeLessThanOrEqual(band.role.ramp.p75 + 0.01);

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
            oldTotal: oldTotal(score, level),
            archetype: score.archetype,
            interaction: score.interaction,
            removalCount: removalCount(cube.picks),
            creatureShare: creatures,
            rampShare: rampShare(cube.picks),
            swaps: cube.picks.filter((p) => !seedNames.has(p.card.name)).length,
          });
        });
      }
    });
  }
});

// Draft simulation stress report (T150 W4, item #6) — REPORTED, not gating.
// Unlike the guards above, this block only measures and prints the three
// draftability metrics for a real collection so a human can judge them; it
// asserts no quality threshold a future generator change could regress
// against. Self-contained on purpose (its own pool load, own JSON report) so
// it merges cleanly no matter what the guard blocks above look like by then.
describe.skipIf(!POOL_PATH)('draft simulation (real collection, reported only)', () => {
  let pool: CubeCard[];
  const draftRows: {
    size: CubeSize;
    ms: number;
    runs: number;
    playersPerRun: number;
    totalDecks: number;
    shortCube: boolean;
    reachedBarSharePct: number;
    topPairs: { label: string; sharePct: number }[];
    undraftedArchetypes: string[];
  }[] = [];

  beforeAll(async () => {
    const taggerData = JSON.parse(
      readFileSync(resolve(here, '..', '..', '..', 'public', 'tagger-tags.json'), 'utf8')
    ) as unknown;
    const signalData = JSON.parse(
      readFileSync(resolve(here, '..', '..', '..', 'public', 'cube-signal.json'), 'utf8')
    ) as unknown;
    const otagData = JSON.parse(
      readFileSync(resolve(here, '..', '..', '..', 'public', 'otag-index.json'), 'utf8')
    ) as unknown;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/tagger-tags.json')) {
        return { ok: true, status: 200, json: async () => taggerData } as Response;
      }
      if (url.endsWith('/cube-signal.json')) {
        return { ok: true, status: 200, json: async () => signalData } as Response;
      }
      if (url.endsWith('/otag-index.json')) {
        return { ok: true, status: 200, json: async () => otagData } as Response;
      }
      throw new Error(`[live-cube] unexpected fetch ${url}`);
    });
    await Promise.all([loadTaggerData(), loadCubeSignal(), ensureCardTags()]);
    const file = JSON.parse(readFileSync(resolve(POOL_PATH!), 'utf8')) as {
      cards: EnrichedCard[];
      facts: OracleFacts[];
    };
    const facts = new Map(file.facts.map((f) => [f.name, f]));
    const allNames = new Set(file.cards.map((c) => c.name));
    const filteredNames = filterPool(file.cards, allNames, DEFAULT_POOL_FILTERS).names;
    pool = namesToCubePool(filteredNames, file.cards, facts);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, 'draft-sim-stress.json');
    writeFileSync(out, JSON.stringify(draftRows, null, 2));
  });

  for (const size of CUBE_SIZES) {
    it(`${size}: draftability over 50 seeded pods`, () => {
      const cube = generateCube(pool, size, { synergyLevel: 1 });
      const t = Date.now();
      const result = simulateDraft(
        cube.picks.map((p) => p.card),
        size,
        { runs: 50 }
      );
      const ms = Date.now() - t;

      // Sanity only — this block reports, it doesn't gate a generator change.
      expect(result.totalDecks).toBe(result.runs * result.playersPerRun);
      expect(result.reachedBarShare).toBeGreaterThanOrEqual(0);
      expect(result.reachedBarShare).toBeLessThanOrEqual(1);
      const shareSum = result.pairShares.reduce((s, p) => s + p.share, 0);
      if (result.totalDecks > 0) expect(shareSum).toBeCloseTo(1, 5);

      draftRows.push({
        size,
        ms,
        runs: result.runs,
        playersPerRun: result.playersPerRun,
        totalDecks: result.totalDecks,
        shortCube: result.shortCube,
        reachedBarSharePct: Math.round(result.reachedBarShare * 1000) / 10,
        topPairs: result.pairShares
          .filter((p) => p.share > 0)
          .slice(0, 6)
          .map((p) => ({ label: p.label, sharePct: Math.round(p.share * 1000) / 10 })),
        undraftedArchetypes: result.undraftedArchetypes.map((a) => a.label),
      });
    });
  }
});
