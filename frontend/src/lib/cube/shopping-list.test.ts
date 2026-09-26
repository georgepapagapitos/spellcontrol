import { describe, it, expect } from 'vitest';
import { bucketOf, type CubeCard } from './core';
import type { GeneratedCube, Pick } from './generate';
import { buildShoppingList } from './shopping-list';

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['R'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Goblin',
    role: p.role ?? null,
    rank: p.rank,
    cubePop: p.cubePop,
    cubeElo: p.cubeElo,
    synergyProducers: p.synergyProducers,
    synergyPayoffs: p.synergyPayoffs,
  };
}

function cubeOf(picks: CubeCard[]): GeneratedCube {
  const pickList: Pick[] = picks.map((c) => ({ card: c, bucket: bucketOf(c), reason: '' }));
  const byBucket = { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 };
  for (const p of pickList) byBucket[p.bucket]++;
  return {
    size: 360,
    format: 'limited',
    picks: pickList,
    byBucket,
    targetByBucket: byBucket,
    gaps: [],
    shortfall: 0,
    poolSize: picks.length,
  };
}

// A same-slot/same-type trio in the red bucket, spread across a wide power
// range purely via cubePop — cmc/typeLine/colors held constant so only the
// power term moves, making every delta in these tests attributable to one
// thing.
const weakPick = card({ name: 'Weak pick', colors: ['R'], cmc: 6, cubePop: 1, oracleId: 'weak' });
const midPick = card({ name: 'Mid pick', colors: ['R'], cmc: 3, cubePop: 50, oracleId: 'mid' });
const strongPick = card({
  name: 'Strong pick',
  colors: ['R'],
  cmc: 1,
  cubePop: 99,
  oracleId: 'strong',
});

describe('buildShoppingList', () => {
  it('ranks a clear improvement above baseline and orders by improvement', () => {
    // A single-pick cube so the power term's percentile reads the candidate's
    // OWN raw power directly (with more picks, a third untouched card can sit
    // at the percentile floor on both sides and mask the difference).
    const cube = cubeOf([weakPick]);
    const pool = [weakPick, midPick, strongPick];
    const good = card({ name: 'Good candidate', colors: ['R'], cmc: 6, cubePop: 25 });
    const best = card({ name: 'Best candidate', colors: ['R'], cmc: 6, cubePop: 55 });

    const rows = buildShoppingList([good, best], cube, pool);

    expect(rows.map((r) => r.card.name)).toEqual(['Best candidate', 'Good candidate']);
    expect(rows[0].improvement).toBeGreaterThan(rows[1].improvement);
    for (const r of rows) expect(r.improvement).toBeGreaterThan(0);
  });

  it('always names the weakest unlocked pick in the bucket as the replacement', () => {
    const cube = cubeOf([weakPick, midPick, strongPick]);
    const pool = cube.picks.map((p) => p.card);
    const good = card({ name: 'Good candidate', colors: ['R'], cmc: 6, cubePop: 95 });

    const [row] = buildShoppingList([good], cube, pool);

    expect(row.replaces.card.oracleId).toBe(weakPick.oracleId);
  });

  it('never names a locked pick as the replacement, even when it is the weakest', () => {
    // cubePop 10 keeps this card weaker than strongPick but stronger than
    // weakPick, so weakPick is still the global floor pre-swap and the
    // percentile shift after the swap is real (not masked by this card).
    const lockedWeakest = card({
      name: 'Locked weakest',
      colors: ['R'],
      cmc: 6,
      cubePop: 10,
      oracleId: 'locked-weakest',
    });
    const cube = cubeOf([lockedWeakest, weakPick, strongPick]);
    const pool = cube.picks.map((p) => p.card);
    const good = card({ name: 'Good candidate', colors: ['R'], cmc: 6, cubePop: 95 });

    const rows = buildShoppingList([good], cube, pool, {
      lockedOracleIds: new Set([lockedWeakest.oracleId]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].replaces.card.oracleId).toBe(weakPick.oracleId);
    expect(rows[0].improvement).toBeGreaterThan(0);
  });

  it('drops a bucket entirely when every pick in it is locked', () => {
    const cube = cubeOf([weakPick]); // sole red pick, locked
    const pool = cube.picks.map((p) => p.card);
    const good = card({ name: 'Good candidate', colors: ['R'], cmc: 6, cubePop: 95 });

    const rows = buildShoppingList([good], cube, pool, {
      lockedOracleIds: new Set([weakPick.oracleId]),
    });

    expect(rows).toEqual([]);
  });

  it('excludes candidates that are owned, banned, or already in the cube', () => {
    const cube = cubeOf([weakPick, midPick]);
    const pool = cube.picks.map((p) => p.card);
    const owned = card({ name: 'Owned', colors: ['R'], cmc: 6, cubePop: 95, oracleId: 'owned' });
    const banned = card({
      name: 'Banned',
      colors: ['R'],
      cmc: 6,
      cubePop: 95,
      oracleId: 'banned',
    });
    const inCube = card({ ...midPick, name: 'Already in cube', oracleId: midPick.oracleId });
    const good = card({ name: 'Good candidate', colors: ['R'], cmc: 6, cubePop: 95 });

    const rows = buildShoppingList([owned, banned, inCube, good], cube, pool, {
      ownedOracleIds: new Set([owned.oracleId]),
      bannedOracleIds: new Set([banned.oracleId]),
    });

    expect(rows.map((r) => r.card.name)).toEqual(['Good candidate']);
  });

  it('returns an empty list when nothing would improve the cube', () => {
    const cube = cubeOf([weakPick, midPick, strongPick]);
    const pool = cube.picks.map((p) => p.card);
    // Same slot/type as weakPick, strictly lower cube popularity.
    const worse = card({ name: 'Worse candidate', colors: ['R'], cmc: 6, cubePop: 0.5 });

    expect(buildShoppingList([worse], cube, pool)).toEqual([]);
    expect(buildShoppingList([], cube, pool)).toEqual([]);
  });

  it('does not mutate the input cube or pool', () => {
    const cube = cubeOf([weakPick, midPick, strongPick]);
    const pool = cube.picks.map((p) => p.card);
    const cubeBefore = structuredClone(cube);
    const poolBefore = structuredClone(pool);
    const good = card({ name: 'Good candidate', colors: ['R'], cmc: 6, cubePop: 95 });

    buildShoppingList([good], cube, pool, { lockedOracleIds: new Set([weakPick.oracleId]) });

    expect(cube).toEqual(cubeBefore);
    expect(pool).toEqual(poolBefore);
  });
});
