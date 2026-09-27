import { describe, it, expect } from 'vitest';
import { simulateDraft, simulateCommanderDraft } from './draft-sim';
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

/** A legend candidate — a legendary creature `card()`, same defaults. */
function legend(p: Partial<CubeCard>): CubeCard {
  return card({ typeLine: 'Legendary Creature — Human', ...p });
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

// ── simulateCommanderDraft (board E461) ─────────────────────────────────────

/** A generous legend section: 2-3 candidates in every mono colour and every
 *  pair, cubePop spread wide enough that roughly half clear any pool-derived
 *  quality bar and half don't. */
function richLegends(): CubeCard[] {
  const legends: CubeCard[] = [];
  const colors = ['W', 'U', 'B', 'R', 'G'] as const;
  for (const c of colors) {
    legends.push(legend({ colors: [c], cubePop: 0.9, rank: 5 }));
    legends.push(legend({ colors: [c], cubePop: 0.7, rank: 50 }));
    legends.push(legend({ colors: [c], cubePop: 0.1, rank: 2000 }));
  }
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      legends.push(legend({ colors: [colors[i], colors[j]], cubePop: 0.8, rank: 20 }));
      legends.push(legend({ colors: [colors[i], colors[j]], cubePop: 0.2, rank: 1500 }));
    }
  }
  return legends;
}

/**
 * A spell pool built around a handful of specific 2-colour PAIR identities
 * (mono of each colour in the pair, plus gold of that exact pair, all of
 * which are identity-legal for it) rather than every identity at once —
 * spreading supply thin across all 16 possible identities dilutes any one
 * of them below what a 45-pick draft can realistically capture (a real
 * Commander cube's legend section is a few dozen identities deep across
 * hundreds of nonland cards; a synthetic pool this small has to concentrate
 * to demonstrate the same shape). Mono commanders are deliberately NOT
 * exercised here — a single-colour identity's own nonland supply is half a
 * pair's, and a real cube's own pair-heavy legend mix (design doc Finding 2)
 * means this is the representative case, not a dodge.
 */
function pairFocusedSpells(pairs: readonly (readonly [string, string])[]): CubeCard[] {
  const pool: CubeCard[] = [];
  const colors = [...new Set(pairs.flat())];
  for (const c of colors) {
    for (let i = 0; i < 50; i++) {
      pool.push(card({ colors: [c], cmc: 1 + (i % 6), rank: i, cubePop: 0.5 }));
    }
  }
  for (const pair of pairs) {
    for (let i = 0; i < 60; i++) {
      pool.push(card({ colors: [...pair], cmc: 2 + (i % 5), rank: 500 + i, cubePop: 0.4 }));
    }
  }
  for (let i = 0; i < 40; i++) {
    pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 900 + i }));
  }
  return pool;
}

/** A generous legend section for exactly `pairs`, cubePop alternating so
 *  roughly half clear the pool-derived quality bar. */
function pairFocusedLegends(pairs: readonly (readonly [string, string])[]): CubeCard[] {
  const legends: CubeCard[] = [];
  for (const pair of pairs) {
    for (let i = 0; i < 15; i++) {
      legends.push(legend({ colors: [...pair], cubePop: i % 2 === 0 ? 0.9 : 0.4, rank: i }));
    }
  }
  return legends;
}

const SIZE_360_CMDR: CubeSize = 360; // sizeInfo(360).players === 8
const SIZE_180_CMDR: CubeSize = 180; // sizeInfo(180).players === 4

describe('simulateCommanderDraft — determinism', () => {
  it('same spells+legends (any order) + seed → identical result', () => {
    const spells = wellShapedPool();
    const legends = richLegends();
    const a = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 5, seed: 11 });
    const b = simulateCommanderDraft([...spells].reverse(), [...legends].reverse(), SIZE_360_CMDR, {
      runs: 5,
      seed: 11,
    });
    expect(b).toEqual(a);
  });

  it('the default (pool-derived) seed is also stable across calls', () => {
    const spells = wellShapedPool();
    const legends = richLegends();
    const a = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 5 });
    const b = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 5 });
    expect(b).toEqual(a);
  });
});

describe('simulateCommanderDraft — pod and pack arithmetic', () => {
  it('an 8-player size with plenty of cards drafts the full nominal pod', () => {
    const spells = wellShapedPool();
    const legends = richLegends();
    const result = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 4 });
    expect(result.playersPerRun).toBe(8);
    expect(result.packsPerPlayer).toBe(3);
    expect(result.cardsPerPack).toBe(15);
    expect(result.totalDecks).toBe(4 * 8);
    expect(result.shortCube).toBe(false);
  });

  it('a pool smaller than the pod needs drafts what exists, players scaled down', () => {
    const spells = wellShapedPool().slice(0, 60);
    const legends = richLegends().slice(0, 5); // combined well under 8 * 45
    const result = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 3, seed: 7 });
    expect(result.shortCube).toBe(true);
    const expectedPlayers = Math.floor((spells.length + legends.length) / 45);
    expect(result.playersPerRun).toBe(expectedPlayers);
    expect(result.totalDecks).toBe(3 * expectedPlayers);
  });

  it('an empty pool never crashes and reports zero everything, no false unbuildable flags', () => {
    const result = simulateCommanderDraft([], [], SIZE_360_CMDR, { runs: 2 });
    expect(result.playersPerRun).toBe(1);
    expect(result.builtDeckShare).toBe(0);
    expect(result.noCommanderShare).toBe(1);
    // No legend supply at all → nothing is "supported", so nothing is flagged
    // as unbuildable either (same M4 "nothing to penalize" shape as the
    // limited pod's undraftedArchetypes).
    expect(result.unbuildableIdentities).toEqual([]);
  });

  it('every drafted deck lands in exactly one bucket: identity shares + no-commander sum to 1', () => {
    const spells = wellShapedPool();
    const legends = richLegends();
    const result = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 6, seed: 3 });
    const identitySum = result.identityShares.reduce((s, r) => s + r.share, 0);
    expect(identitySum + result.noCommanderShare).toBeCloseTo(1, 5);
  });
});

describe('simulateCommanderDraft — the buildable bar', () => {
  it('a rich, well-supplied cube reaches a real buildable share across several identities', () => {
    const pairs = [
      ['W', 'U'],
      ['B', 'R'],
    ] as const;
    const spells = pairFocusedSpells(pairs);
    const legends = pairFocusedLegends(pairs);
    const result = simulateCommanderDraft(spells, legends, SIZE_180_CMDR, { runs: 30, seed: 42 });
    // Measured 0.92 at the 23-playable bar (COMMANDER_PLAYABLE_TARGET) on
    // this pool — 0.7 leaves real headroom for seed variance while staying
    // far clear of the STARVED cube's hard 0.125 ceiling (at most one
    // commander per run) below.
    expect(result.builtDeckShare).toBeGreaterThan(0.7);
    const identitiesUsed = result.identityShares.filter((s) => s.share > 0).length;
    expect(identitiesUsed).toBeGreaterThan(1);
  });

  it('a legend-starved cube (almost no commander candidates) rarely builds a deck', () => {
    const spells = wellShapedPool();
    const legends = [legend({ colors: ['W'], cubePop: 0.3, rank: 1000 })]; // the only candidate anywhere
    const result = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 10, seed: 5 });
    expect(result.noCommanderShare).toBeGreaterThan(0.8);
    expect(result.builtDeckShare).toBeLessThan(0.2);
  });
});

describe('simulateCommanderDraft — a mono-identity-starved cube', () => {
  it('a legend section supporting only ONE identity funnels nearly every commander into it, and flags nothing else', () => {
    // Every legend candidate — and all the gold supply — is WU. No other
    // identity (including plain mono W or U) has ANY legend candidate at all,
    // so it's the one and only bucket a drafted commander could ever land in.
    const pairs = [['W', 'U']] as const;
    const spells = pairFocusedSpells(pairs);
    const legends = pairFocusedLegends(pairs);
    const result = simulateCommanderDraft(spells, legends, SIZE_180_CMDR, { runs: 20, seed: 9 });
    const wuShare = result.identityShares.find((s) => s.identity === 'WU')!.share;
    const otherShares = result.identityShares.filter((s) => s.identity !== 'WU');
    expect(wuShare).toBeGreaterThan(0);
    for (const s of otherShares) expect(s.share).toBe(0);
    // Only 'WU' ever had supply, so it's the only bucket that COULD be
    // flagged "unbuildable" — and shouldn't be, since it has plenty of spells.
    expect(result.unbuildableIdentities).not.toContain('WU');
  });

  it('an identity with legend supply but zero identity-legal spells anywhere is flagged unbuildable', () => {
    // W has real backing (50 mono-white spells); BG has NONE — no black, no
    // green, and no colourless nonland card exists anywhere in this pool, so
    // any drafter who ends up with a BG commander can never field 23
    // identity-legal playables around it, however the draft itself goes.
    const spells: CubeCard[] = [];
    for (let i = 0; i < 50; i++) {
      spells.push(card({ colors: ['W'], cmc: 1 + (i % 5), rank: i, cubePop: 0.5 }));
    }
    for (let i = 0; i < 100; i++) {
      spells.push(
        card({ colors: [i % 2 === 0 ? 'U' : 'R'], cmc: 1 + (i % 5), rank: 200 + i, cubePop: 0.3 })
      );
    }
    for (let i = 0; i < 80; i++) {
      spells.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 900 + i }));
    }
    const legends = [
      legend({ colors: ['W'], cubePop: 0.9, rank: 5 }),
      legend({ colors: ['B', 'G'], cubePop: 0.9, rank: 6 }),
    ];
    const result = simulateCommanderDraft(spells, legends, SIZE_360_CMDR, { runs: 10, seed: 13 });
    expect(result.unbuildableIdentities).toContain('BG');
  });
});
