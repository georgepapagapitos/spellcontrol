import { describe, it, expect } from 'vitest';
import { generateCubeAsync } from './generate-async';
import { generateCube, type CubeCard } from './generate';
import type { CubeSize } from './targets';

// import.meta.env.MODE is 'test' under vitest, so generateCubeAsync always
// takes the inline fallback here — the same convention as
// lib/offline/ensure-combos.ts's importInWorker, whose real Worker wiring is
// integration-verified rather than unit-tested. What IS unit-testable and
// load-bearing here: the fallback produces the same cube generateCube would,
// the refiner's progress callback is a pure side channel, and a superseded
// call never resolves over a newer one.

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['W'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Human',
    role: p.role ?? null,
    rank: p.rank,
    cubePop: p.cubePop,
    cubeElo: p.cubeElo,
    synergyProducers: p.synergyProducers,
    synergyPayoffs: p.synergyPayoffs,
  };
}

/** A color-balanced pool with a tokens archetype axis (so the refiner has a
 *  real climb to run) — enough to fill a 180-card cube comfortably. */
function testPool(): CubeCard[] {
  const pool: CubeCard[] = [];
  const colors: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G']];
  for (const c of colors) {
    for (let i = 0; i < 40; i++) {
      pool.push(
        card({
          colors: c,
          cmc: i % 8,
          role: i % 7 === 0 ? 'removal' : i % 11 === 0 ? 'ramp' : null,
          rank: i * 10 + c[0].charCodeAt(0),
        })
      );
    }
  }
  for (let i = 0; i < 20; i++) pool.push(card({ colors: ['W', 'U'], cmc: 3, rank: 500 + i }));
  for (let i = 0; i < 20; i++)
    pool.push(card({ colors: [], typeLine: 'Artifact', cmc: 2, rank: 600 + i }));
  for (let i = 0; i < 40; i++)
    pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 700 + i }));
  // A draftable tokens axis: enablers + payoffs among the white cards, plus
  // spares outside the seed so the refiner has cards to swap in.
  for (let i = 0; i < 6; i++)
    pool.push(card({ colors: ['W'], cmc: 3, rank: 50 + i, synergyProducers: ['tokens'] }));
  for (let i = 0; i < 6; i++)
    pool.push(card({ colors: ['W'], cmc: 3, rank: 60 + i, synergyPayoffs: ['tokens'] }));
  return pool;
}

const SIZE: CubeSize = 180;

async function rejection(p: Promise<unknown>): Promise<DOMException> {
  try {
    await p;
  } catch (e) {
    return e as DOMException;
  }
  throw new Error('expected the promise to reject');
}

describe('generateCubeAsync — fallback path', () => {
  it('matches generateCube byte-for-byte (synergyLevel 0, no refiner)', async () => {
    const pool = testPool();
    const cube = await generateCubeAsync(pool, SIZE, { synergyLevel: 0 });
    expect(cube).toEqual(generateCube(pool, SIZE, { synergyLevel: 0 }));
  });

  it('matches generateCube when the refiner runs (synergyLevel > 0)', async () => {
    const pool = testPool();
    const cube = await generateCubeAsync(pool, SIZE, { synergyLevel: 1 });
    expect(cube).toEqual(generateCube(pool, SIZE, { synergyLevel: 1 }));
  });
});

describe('generateCubeAsync — refiner progress', () => {
  it('relays per-pass progress without changing the result', async () => {
    const pool = testPool();
    const progress: { pass: number; maxIter: number }[] = [];
    const cube = await generateCubeAsync(
      pool,
      SIZE,
      { synergyLevel: 1 },
      { onProgress: (p) => progress.push(p) }
    );
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p) => p.maxIter > 0 && p.pass >= 0 && p.pass < p.maxIter)).toBe(true);
    // Purely a side channel — the cube is identical to a run with no callback.
    expect(cube).toEqual(generateCube(pool, SIZE, { synergyLevel: 1 }));
  });

  it('never fires when the refiner never runs (synergyLevel 0)', async () => {
    const progress: unknown[] = [];
    await generateCubeAsync(
      testPool(),
      SIZE,
      { synergyLevel: 0 },
      { onProgress: (p) => progress.push(p) }
    );
    expect(progress).toHaveLength(0);
  });
});

describe('generateCubeAsync — staleness', () => {
  it('drops a superseded call: only the newest of two overlapping builds resolves', async () => {
    const pool = testPool();
    const first = generateCubeAsync(pool, SIZE, { synergyLevel: 0 });
    const second = generateCubeAsync(pool, SIZE, { synergyLevel: 0 });

    const [a, b] = await Promise.allSettled([first, second]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('fulfilled');
    if (a.status === 'rejected') expect(a.reason).toBeInstanceOf(DOMException);
  });

  it('rejects with AbortError when the caller aborts before the run lands', async () => {
    const pool = testPool();
    const controller = new AbortController();
    const p = generateCubeAsync(pool, SIZE, { synergyLevel: 0 }, { signal: controller.signal });
    controller.abort();
    const err = await rejection(p);
    expect(err.name).toBe('AbortError');
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const err = await rejection(
      generateCubeAsync(testPool(), SIZE, {}, { signal: controller.signal })
    );
    expect(err.name).toBe('AbortError');
  });
});
