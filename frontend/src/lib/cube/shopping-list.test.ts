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

// A second trio, all Enchantments, for the one-to-one assignment tests: the
// type term (creature share is far below its corpus target, enchantment share
// far above) rewards an Enchantment→Creature swap independently of WHICH
// enchantment index is replaced, so every assigned row in those tests gets a
// real, non-zero delta — unlike the power term, which is a percentile over the
// whole cube and only moves when the GLOBAL minimum is the one swapped out.
const enchantA = card({
  name: 'Enchant A',
  colors: ['R'],
  cmc: 6,
  cubePop: 1,
  typeLine: 'Enchantment',
  oracleId: 'enchant-a',
});
const enchantB = card({
  name: 'Enchant B',
  colors: ['R'],
  cmc: 6,
  cubePop: 5,
  typeLine: 'Enchantment',
  oracleId: 'enchant-b',
});
const enchantC = card({
  name: 'Enchant C',
  colors: ['R'],
  cmc: 6,
  cubePop: 9,
  typeLine: 'Enchantment',
  oracleId: 'enchant-c',
});
const creatureBest = card({
  name: 'Creature Best',
  colors: ['R'],
  cmc: 6,
  cubePop: 99,
  typeLine: 'Creature — Beast',
});
const creatureMid = card({
  name: 'Creature Mid',
  colors: ['R'],
  cmc: 6,
  cubePop: 60,
  typeLine: 'Creature — Beast',
});
const creatureWorst = card({
  name: 'Creature Worst',
  colors: ['R'],
  cmc: 6,
  cubePop: 30,
  typeLine: 'Creature — Beast',
});
// Includes `creatureBest` so the pool's popularity ceiling (popP80) sits at 99,
// not 9 — otherwise every candidate's cube-pop would clip to the same ceiling
// and tie, masking the best/mid/worst ordering the assignment test relies on.
const enchantBasisPool = [enchantA, enchantB, enchantC, creatureBest];

describe('buildShoppingList', () => {
  it('ranks a clear improvement above baseline; a stronger replacement scores higher', () => {
    // A single-pick cube: only one candidate can ever be assigned (one pick to
    // replace), so ordering is compared across two separate calls rather than
    // within one call's rows.
    const cube = cubeOf([weakPick]);
    const pool = [weakPick, midPick, strongPick];
    const good = card({ name: 'Good candidate', colors: ['R'], cmc: 6, cubePop: 25 });
    const best = card({ name: 'Best candidate', colors: ['R'], cmc: 6, cubePop: 55 });

    const [goodRow] = buildShoppingList([good], cube, pool);
    const [bestRow] = buildShoppingList([best], cube, pool);

    expect(goodRow.improvement).toBeGreaterThan(0);
    expect(bestRow.improvement).toBeGreaterThan(goodRow.improvement);
  });

  it('matches candidates to picks one-to-one within a bucket, best to weakest', () => {
    const cube = cubeOf([enchantA, enchantB, enchantC]);

    const rows = buildShoppingList(
      [creatureWorst, creatureBest, creatureMid],
      cube,
      enchantBasisPool
    );

    expect(rows).toHaveLength(3);
    const targetOf = (name: string) =>
      rows.find((r) => r.card.name === name)?.replaces.card.oracleId;
    expect(targetOf('Creature Best')).toBe(enchantA.oracleId); // weakest pick
    expect(targetOf('Creature Mid')).toBe(enchantB.oracleId); // next-weakest
    expect(targetOf('Creature Worst')).toBe(enchantC.oracleId); // strongest pick left
    for (const r of rows) expect(r.improvement).toBeGreaterThan(0);
  });

  it('never lets two rows target the same pick', () => {
    const cube = cubeOf([enchantA, enchantB, enchantC]);

    const rows = buildShoppingList(
      [creatureWorst, creatureBest, creatureMid],
      cube,
      enchantBasisPool
    );

    const targets = rows.map((r) => r.replaces.card.oracleId);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('leaves a candidate unranked when its bucket has more candidates than unlocked picks', () => {
    const cube = cubeOf([enchantA, enchantB]); // only 2 unlocked picks for 3 candidates

    const rows = buildShoppingList(
      [creatureWorst, creatureBest, creatureMid],
      cube,
      enchantBasisPool
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.card.name).sort()).toEqual(['Creature Best', 'Creature Mid']);
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
