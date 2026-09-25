// Property test: the incremental scorer must produce EXACTLY what a full
// `scoreCube` rescore would, after any sequence of same-bucket swaps. This is
// the correctness guard for refine.ts's hot loop — everything else there is
// just search strategy built on top of this contract.

import { describe, it, expect } from 'vitest';
import { generateCube, bucketOf, type CubeCard } from './generate';
import { targetsForSize } from './targets';
import { computePowerBasis, scoreCube } from './objective';
import { createScorerState, evalSwap, applySwap, currentTerms } from './scorer-state';
import { mulberry32 } from '../playtest/rng';

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

const AXES = ['tokens', 'counters', 'sacrifice', 'lifegain'] as const;
const TYPE_LINES = [
  'Creature — Human',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker — Jace',
];

/** A real-shaped pool: every color bucket, a curve spread, roles, types, and
 *  several two-sided (producer+payoff) archetype axes so archetype/curve/
 *  type/interaction all have real gradient for swaps to move. */
function realShapedPool(): CubeCard[] {
  const pool: CubeCard[] = [];
  const colorSets: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G'], ['W', 'U'], []];
  let n = 0;
  for (const colors of colorSets) {
    for (let i = 0; i < 60; i++) {
      const role =
        i % 9 === 0 ? 'removal' : i % 11 === 0 ? 'ramp' : i % 13 === 0 ? 'cardDraw' : null;
      const axis = AXES[n % AXES.length];
      const side = n % 2 === 0 ? 'producer' : 'payoff';
      const hasAxis = i % 4 === 0; // ~15 cards per bucket carry an axis tag
      pool.push(
        card({
          name: `card-${n}`,
          colors,
          cmc: i % 8,
          typeLine: TYPE_LINES[i % TYPE_LINES.length],
          role,
          rank: 10 + n,
          synergyProducers: hasAxis && side === 'producer' ? [axis] : undefined,
          synergyPayoffs: hasAxis && side === 'payoff' ? [axis] : undefined,
        })
      );
      n++;
    }
  }
  for (let i = 0; i < 60; i++) {
    pool.push(card({ name: `land-${i}`, colors: [], typeLine: 'Land', cmc: 0, rank: 900 + i }));
  }
  return pool;
}

describe('scorer-state — incremental vs full scoreCube', () => {
  it('matches scoreCube exactly after every swap in a long random sequence', () => {
    const pool = realShapedPool();
    const size = 180;
    const band = targetsForSize(size);
    const basis = computePowerBasis(pool);
    const synergyLevel = 0.6;

    const seed = generateCube(pool, size, { synergyLevel: 0 });
    expect(seed.picks).toHaveLength(size);

    const state = createScorerState(seed.picks, pool, band, size, basis, synergyLevel);
    const initialFull = scoreCube(seed.picks, pool, band, size, basis, synergyLevel);
    expectTermsClose(currentTerms(state), initialFull);

    const pickedIds = new Set(state.picks.map((p) => p.card.oracleId));
    const rand = mulberry32(12345);

    let applied = 0;
    for (let iter = 0; iter < 400 && applied < 200; iter++) {
      const outIdx = Math.floor(rand() * state.picks.length);
      const outCard = state.picks[outIdx].card;
      if (bucketOf(outCard) === 'land') continue; // refiner never swaps lands
      const bucket = bucketOf(outCard);
      const candidates = pool.filter((c) => bucketOf(c) === bucket && !pickedIds.has(c.oracleId));
      if (candidates.length === 0) continue;
      const inCard = candidates[Math.floor(rand() * candidates.length)];

      const ev = evalSwap(state, outIdx, inCard);
      applySwap(state, outIdx, inCard, bucket, 'test swap', ev);
      pickedIds.delete(outCard.oracleId);
      pickedIds.add(inCard.oracleId);
      applied++;

      const full = scoreCube(state.picks, pool, band, size, basis, synergyLevel);
      expectTermsClose(currentTerms(state), full);
    }
    expect(applied).toBeGreaterThan(50); // sanity — the loop actually exercised swaps
  });

  it('evalSwap is pure — does not mutate state until applySwap is called', () => {
    const pool = realShapedPool();
    const size = 180;
    const band = targetsForSize(size);
    const basis = computePowerBasis(pool);
    const seed = generateCube(pool, size, { synergyLevel: 0 });
    const state = createScorerState(seed.picks, pool, band, size, basis, 1);
    const before = JSON.parse(JSON.stringify(currentTerms(state)));

    const outIdx = state.picks.findIndex((p) => bucketOf(p.card) !== 'land');
    const bucket = bucketOf(state.picks[outIdx].card);
    const pickedIds = new Set(state.picks.map((p) => p.card.oracleId));
    const inCard = pool.find((c) => bucketOf(c) === bucket && !pickedIds.has(c.oracleId))!;

    evalSwap(state, outIdx, inCard);
    expect(currentTerms(state)).toEqual(before);
  });
});

function expectTermsClose(
  a: ReturnType<typeof currentTerms>,
  b: ReturnType<typeof scoreCube>
): void {
  const TOL = 1e-9; // property-test tolerance vs the 1e-12 formula equivalence
  for (const k of [
    'archetype',
    'glue',
    'color',
    'curve',
    'interaction',
    'power',
    'type',
    'fixingMultiplier',
    'total',
  ] as const) {
    expect(a[k], `term ${k}`).toBeCloseTo(b[k], 9);
    expect(Math.abs(a[k] - b[k])).toBeLessThan(TOL);
  }
}
