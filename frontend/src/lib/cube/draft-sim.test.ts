import { describe, it, expect } from 'vitest';
import { simulateDraft } from './draft-sim';
import type { CubeCard } from './core';
import type { CubeSize } from './targets';

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

/** A full-size, well-shaped 8-player pool: plenty of nonland playables in
 *  every colour and in mixed pairs, plus a deep tokens axis and a barely-there
 *  (undraftable) graveyard axis. */
function wellShapedPool(): CubeCard[] {
  const pool: CubeCard[] = [];
  const colors: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G']];
  for (const c of colors) {
    for (let i = 0; i < 60; i++) {
      pool.push(
        card({
          colors: c,
          cmc: 1 + (i % 6),
          role: i % 6 === 0 ? 'removal' : null,
          rank: i * 7 + c[0].charCodeAt(0),
          cubePop: Math.max(0.2, 1 - i / 60),
        })
      );
    }
  }
  // Two-colour gold cards for every pair, so more than one pair is viable.
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      for (let k = 0; k < 10; k++) {
        pool.push(
          card({
            colors: [colors[i][0], colors[j][0]],
            cmc: 2 + (k % 4),
            rank: 300 + k,
            cubePop: 0.3,
          })
        );
      }
    }
  }
  for (let i = 0; i < 30; i++)
    pool.push(card({ colors: [], typeLine: 'Artifact', cmc: 2, rank: 800 + i }));
  for (let i = 0; i < 80; i++)
    pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 900 + i }));
  // A deep, draftable tokens axis (well past LEAN_MIN_TOTAL if any deck leans in).
  for (let i = 0; i < 10; i++)
    pool.push(card({ colors: ['W'], cmc: 2, rank: 10 + i, synergyProducers: ['tokens'] }));
  for (let i = 0; i < 10; i++)
    pool.push(card({ colors: ['W'], cmc: 3, rank: 20 + i, synergyPayoffs: ['tokens'] }));
  // A graveyard axis that exists (so it counts as "draftable") but is far too
  // thin for any deck to ever lean into (1 enabler, 1 payoff).
  pool.push(card({ colors: ['B'], cmc: 2, rank: 5, synergyProducers: ['graveyard'] }));
  pool.push(card({ colors: ['B'], cmc: 6, rank: 6, synergyPayoffs: ['graveyard'] }));
  return pool;
}

const SIZE_360: CubeSize = 360; // sizeInfo(360).players === 8

describe('simulateDraft — determinism', () => {
  it('same cube (any card order) + size + seed → identical result', () => {
    const pool = wellShapedPool();
    const shuffled = [...pool].reverse();
    const a = simulateDraft(pool, SIZE_360, { runs: 5, seed: 1234 });
    const b = simulateDraft(shuffled, SIZE_360, { runs: 5, seed: 1234 });
    expect(b).toEqual(a);
  });

  it('the default (pool-derived) seed is also stable across calls', () => {
    const pool = wellShapedPool();
    const a = simulateDraft(pool, SIZE_360, { runs: 5 });
    const b = simulateDraft(pool, SIZE_360, { runs: 5 });
    expect(b).toEqual(a);
  });

  it('a different seed can produce a different result', () => {
    const pool = wellShapedPool();
    const a = simulateDraft(pool, SIZE_360, { runs: 5, seed: 1 });
    const b = simulateDraft(pool, SIZE_360, { runs: 5, seed: 2 });
    // Not a hard guarantee for any possible pool, but true for this one —
    // guards against a seed argument that's silently ignored.
    expect(b).not.toEqual(a);
  });
});

describe('simulateDraft — pod and pack arithmetic', () => {
  it('an 8-player size with plenty of cards drafts the full nominal pod', () => {
    const pool = wellShapedPool();
    const result = simulateDraft(pool, SIZE_360, { runs: 4 });
    expect(result.playersPerRun).toBe(8);
    expect(result.packsPerPlayer).toBe(3);
    expect(result.cardsPerPack).toBe(15);
    expect(result.totalDecks).toBe(4 * 8);
    expect(result.shortCube).toBe(false);
  });

  it('a 4-player size drafts 4 players', () => {
    const pool = wellShapedPool();
    const result = simulateDraft(pool, 180 as CubeSize, { runs: 2 });
    expect(result.playersPerRun).toBe(4);
    expect(result.totalDecks).toBe(2 * 4);
  });
});

describe('simulateDraft — short cube', () => {
  it('a pool smaller than the pod needs drafts what exists, players scaled down, no crash', () => {
    const pool = wellShapedPool().slice(0, 100); // < 8 * 45 = 360
    const result = simulateDraft(pool, SIZE_360, { runs: 3, seed: 7 });
    expect(result.shortCube).toBe(true);
    expect(result.playersPerRun).toBe(Math.floor(100 / 45)); // 2
    expect(result.totalDecks).toBe(3 * result.playersPerRun);
    expect(Number.isFinite(result.reachedBarShare)).toBe(true);
    const totalShare = result.pairShares.reduce((s, p) => s + p.share, 0);
    expect(totalShare).toBeCloseTo(1, 5);
  });

  it('an empty cube never crashes and reports zero draftability', () => {
    const result = simulateDraft([], SIZE_360, { runs: 2 });
    expect(result.playersPerRun).toBe(1);
    expect(result.reachedBarShare).toBe(0);
    expect(result.undraftedArchetypes).toEqual([]);
  });
});

describe('simulateDraft — the two-colour bar', () => {
  it('a mono-colour cube with too few nonland cards fails the bar for every deck', () => {
    const pool: CubeCard[] = [];
    for (let i = 0; i < 15; i++) pool.push(card({ colors: ['W'], cmc: 1 + (i % 5), rank: i }));
    for (let i = 0; i < 17; i++)
      pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 100 + i }));
    const result = simulateDraft(pool, 180 as CubeSize, { runs: 5, seed: 9 });
    expect(result.reachedBarShare).toBe(0);
  });

  it('a well-shaped, deep pool clears the bar for most decks across several pairs', () => {
    const pool = wellShapedPool();
    const result = simulateDraft(pool, SIZE_360, { runs: 8, seed: 42 });
    expect(result.reachedBarShare).toBeGreaterThan(0.8);
    const pairsUsed = result.pairShares.filter((p) => p.share > 0).length;
    expect(pairsUsed).toBeGreaterThan(1);
  });
});

describe('simulateDraft — undrafted archetypes', () => {
  it('flags a draftable-but-too-thin axis and clears a genuinely deep one', () => {
    const pool = wellShapedPool();
    const result = simulateDraft(pool, SIZE_360, { runs: 10, seed: 42 });
    const flagged = result.undraftedArchetypes.map((a) => a.axis);
    expect(flagged).toContain('graveyard');
    expect(flagged).not.toContain('tokens');
  });

  it('a pool with no archetype tags at all flags nothing (nothing to draft)', () => {
    const pool: CubeCard[] = [];
    for (let i = 0; i < 400; i++)
      pool.push(
        card({ colors: [['W'], ['U'], ['B'], ['R'], ['G']][i % 5], cmc: 1 + (i % 6), rank: i })
      );
    for (let i = 0; i < 80; i++)
      pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 1000 + i }));
    const result = simulateDraft(pool, SIZE_360, { runs: 2 });
    expect(result.undraftedArchetypes).toEqual([]);
  });
});
