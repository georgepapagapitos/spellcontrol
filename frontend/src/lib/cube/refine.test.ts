import { describe, it, expect } from 'vitest';
import { bucketOf, generateCube, type CubeCard, type GeneratedCube, type Pick } from './generate';
import { targetsForSize, type ColorBucket, type CubeSize } from './targets';
import { scoreCube } from './objective';
import { refineCube } from './refine';

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['W'],
    cmc: p.cmc ?? 3,
    typeLine: p.typeLine ?? 'Creature — Human',
    role: p.role ?? null,
    rank: p.rank,
    synergyProducers: p.synergyProducers,
    synergyPayoffs: p.synergyPayoffs,
  };
}
const ALL_BUCKETS: ColorBucket[] = ['W', 'U', 'B', 'R', 'G', 'multicolor', 'colorless', 'land'];
const picksOf = (cards: CubeCard[]): Pick[] =>
  cards.map((c) => ({ card: c, bucket: bucketOf(c), reason: '' }));
function seedOf(cards: CubeCard[], size: CubeSize): GeneratedCube {
  const byBucket = {} as Record<ColorBucket, number>;
  for (const b of ALL_BUCKETS) byBucket[b] = 0;
  for (const c of cards) byBucket[bucketOf(c)]++;
  return {
    size,
    picks: picksOf(cards),
    byBucket,
    targetByBucket: byBucket,
    gaps: [],
    shortfall: 0,
    poolSize: cards.length,
  };
}

/**
 * A seed with a partially-supported tokens axis (4 enablers + 4 payoffs) plus 8
 * non-synergy White fillers it can cut, and a pool holding 8 more White tokens
 * cards to draft in — so the refiner has a real improving move.
 */
function tokensScenario() {
  let n = 0;
  const tokensIn = (kind: 'p' | 'y', rank: number) =>
    card({
      name: `tok-${kind}-${n++}`,
      colors: ['W'],
      cmc: 3,
      rank,
      synergyProducers: kind === 'p' ? ['tokens'] : undefined,
      synergyPayoffs: kind === 'y' ? ['tokens'] : undefined,
    });
  const seedCards: CubeCard[] = [];
  for (let i = 0; i < 4; i++) seedCards.push(tokensIn('p', 100 + i));
  for (let i = 0; i < 4; i++) seedCards.push(tokensIn('y', 200 + i));
  const fillers: CubeCard[] = [];
  for (let i = 0; i < 8; i++) fillers.push(card({ colors: ['W'], cmc: 3, rank: i + 1 }));
  const extras: CubeCard[] = [];
  for (let i = 0; i < 4; i++) extras.push(tokensIn('p', 300 + i));
  for (let i = 0; i < 4; i++) extras.push(tokensIn('y', 400 + i));
  const seed = seedOf([...seedCards, ...fillers], 360);
  const pool = [...seedCards, ...fillers, ...extras];
  return { seed, pool };
}

const band360 = targetsForSize(360);
const tokenCount = (picks: Pick[]) =>
  picks.filter(
    (p) => p.card.synergyProducers?.includes('tokens') || p.card.synergyPayoffs?.includes('tokens')
  ).length;

describe('refineCube', () => {
  it('preserves size, singleton-ness, and owned-boundness', () => {
    const { seed, pool } = tokensScenario();
    const r = refineCube(seed, pool, band360, 360);
    expect(r.picks.length).toBe(seed.picks.length);
    const ids = r.picks.map((p) => p.card.oracleId);
    expect(new Set(ids).size).toBe(ids.length); // singleton
    const poolIds = new Set(pool.map((c) => c.oracleId));
    expect(ids.every((i) => poolIds.has(i))).toBe(true); // owned-bound
  });

  it('keeps byBucket invariant (swaps are same-bucket)', () => {
    const { seed, pool } = tokensScenario();
    const r = refineCube(seed, pool, band360, 360);
    expect(r.byBucket).toEqual(seed.byBucket);
    // and it matches a fresh tally of the output
    const tally = {} as Record<ColorBucket, number>;
    for (const b of ALL_BUCKETS) tally[b] = 0;
    for (const p of r.picks) tally[bucketOf(p.card)]++;
    expect(r.byBucket).toEqual(tally);
  });

  it('improves the objective over the seed and records the swaps', () => {
    const { seed, pool } = tokensScenario();
    const before = scoreCube(seed.picks, pool, band360, 360).total;
    const r = refineCube(seed, pool, band360, 360);
    expect(r.finalScore).toBeGreaterThan(before);
    expect(r.swapLog.length).toBeGreaterThan(0);
    expect(tokenCount(r.picks)).toBeGreaterThan(tokenCount(seed.picks));
  });

  it('is deterministic — identical output across runs', () => {
    const a = tokensScenario();
    const b = tokensScenario();
    // rebuild with the SAME card identities so the two pools are equal
    const r1 = refineCube(a.seed, a.pool, band360, 360);
    const r2 = refineCube(a.seed, a.pool, band360, 360);
    expect(r1.picks.map((p) => p.card.oracleId)).toEqual(r2.picks.map((p) => p.card.oracleId));
    // and a structurally-identical independent scenario climbs the same way
    expect(r1.swapLog.length).toBe(refineCube(b.seed, b.pool, band360, 360).swapLog.length);
  });

  it('terminates within the iteration cap', () => {
    const { seed, pool } = tokensScenario();
    const r = refineCube(seed, pool, band360, 360);
    expect(r.swapLog.length).toBeLessThanOrEqual(720);
  });

  it('is a no-op when the pool supports no draftable archetype', () => {
    const cards = Array.from({ length: 30 }, (_, i) => card({ colors: ['G'], rank: i }));
    const seed = seedOf(cards, 360);
    const r = refineCube(seed, cards, band360, 360);
    expect(r.swapLog).toHaveLength(0);
    expect(r.picks.map((p) => p.card.oracleId)).toEqual(seed.picks.map((p) => p.card.oracleId));
  });

  it('relaxes to ±1 curve slot when no exact-slot card is cuttable', () => {
    // Partial tokens axis at slot 3; the only non-synergy fillers it can cut sit
    // at slot 4, and the draftable extras are at slot 3 → the exact-slot match
    // fails and the refiner must use the ±1 relaxation to make any swap.
    let n = 0;
    const tok = (kind: 'p' | 'y', rank: number) =>
      card({
        name: `t${n++}`,
        colors: ['W'],
        cmc: 3,
        rank,
        synergyProducers: kind === 'p' ? ['tokens'] : undefined,
        synergyPayoffs: kind === 'y' ? ['tokens'] : undefined,
      });
    const seedCards: CubeCard[] = [];
    for (let i = 0; i < 4; i++) seedCards.push(tok('p', 100 + i));
    for (let i = 0; i < 4; i++) seedCards.push(tok('y', 200 + i));
    const fillers = Array.from({ length: 8 }, (_, i) =>
      card({ colors: ['W'], cmc: 4, rank: i + 1 })
    ); // slot 4, not 3
    const extras: CubeCard[] = [];
    for (let i = 0; i < 4; i++) extras.push(tok('p', 300 + i));
    for (let i = 0; i < 4; i++) extras.push(tok('y', 400 + i));
    const seed = seedOf([...seedCards, ...fillers], 360);
    const pool = [...seedCards, ...fillers, ...extras];
    const r = refineCube(seed, pool, band360, 360);
    expect(r.swapLog.length).toBeGreaterThan(0);
    expect(tokenCount(r.picks)).toBeGreaterThan(tokenCount(seed.picks));
  });

  it('ranks multiple draftable axes deterministically (cold start, no bootstrap)', () => {
    // Two axes the pool can draft (tokens + counters) but neither is in the seed
    // → both rank at score 0, exercising the lexicographic tiebreak; a single
    // swap can never raise a from-zero (one-sided) axis, so nothing is applied.
    const fillers = Array.from({ length: 8 }, (_, i) => card({ colors: ['W'], cmc: 3, rank: i }));
    const pool = [
      ...fillers,
      card({ colors: ['W'], cmc: 3, rank: 900, synergyProducers: ['tokens'] }),
      card({ colors: ['W'], cmc: 3, rank: 901, synergyPayoffs: ['tokens'] }),
      card({ colors: ['W'], cmc: 3, rank: 902, synergyProducers: ['counters'] }),
      card({ colors: ['W'], cmc: 3, rank: 903, synergyPayoffs: ['counters'] }),
    ];
    const seed = seedOf(fillers, 360);
    const r = refineCube(seed, pool, band360, 360);
    expect(r.swapLog).toHaveLength(0);
    expect(r.picks.map((p) => p.card.oracleId)).toEqual(seed.picks.map((p) => p.card.oracleId));
  });

  it('never returns a worse cube than a real greedy seed', () => {
    // A real (synergy-free) cube → refine has nothing to chase → equal, not worse.
    const pool: CubeCard[] = [];
    for (const c of [['W'], ['U'], ['B'], ['R'], ['G']] as CubeCard['colors'][])
      for (let i = 0; i < 90; i++) pool.push(card({ colors: c, cmc: i % 8, rank: i * 10 }));
    for (let i = 0; i < 90; i++) pool.push(card({ colors: [], typeLine: 'Land', rank: 700 + i }));
    const greedy = generateCube(pool, 360);
    const before = scoreCube(greedy.picks, pool, band360, 360).total;
    const r = refineCube(greedy, pool, band360, 360);
    expect(r.finalScore).toBeGreaterThanOrEqual(before);
  });
});
