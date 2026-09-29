import { describe, it, expect } from 'vitest';
import { generateCube, bucketOf, curveSlotOf, byQuality, apportion, CubeCard } from './generate';
import { targetsForSize, CUBE_SIZES } from './targets';
import { scoreCube } from './objective';

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
    colorIdentity: p.colorIdentity,
    producedMana: p.producedMana,
  };
}

/** A generous, color-balanced pool — enough to fill a 360 cube comfortably. */
function richPool(): CubeCard[] {
  const pool: CubeCard[] = [];
  const colors: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G']];
  for (const c of colors) {
    for (let i = 0; i < 90; i++) {
      pool.push(
        card({
          colors: c,
          cmc: i % 8,
          role: i % 7 === 0 ? 'removal' : i % 11 === 0 ? 'ramp' : i % 13 === 0 ? 'cardDraw' : null,
          rank: i * 10 + c[0].charCodeAt(0),
        })
      );
    }
  }
  for (let i = 0; i < 60; i++) pool.push(card({ colors: ['W', 'U'], cmc: 3, rank: 500 + i }));
  for (let i = 0; i < 60; i++)
    pool.push(card({ colors: [], typeLine: 'Artifact', cmc: 2, rank: 600 + i }));
  for (let i = 0; i < 90; i++)
    pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 700 + i }));
  return pool;
}

describe('bucketOf', () => {
  it('classifies lands, colorless, mono, and multicolor', () => {
    expect(bucketOf(card({ typeLine: 'Land' }))).toBe('land');
    expect(bucketOf(card({ colors: [], typeLine: 'Artifact' }))).toBe('colorless');
    expect(bucketOf(card({ colors: ['R'] }))).toBe('R');
    expect(bucketOf(card({ colors: ['R', 'G'] }))).toBe('multicolor');
  });
});

describe('curveSlotOf', () => {
  it('buckets cmc, clamping 7+', () => {
    expect(curveSlotOf(0)).toBe('0');
    expect(curveSlotOf(2.0)).toBe('2');
    expect(curveSlotOf(9)).toBe('7');
  });
});

describe('generateCube — rich pool', () => {
  const cube = generateCube(richPool(), 360);

  it('produces exactly the requested size with no shortfall', () => {
    expect(cube.picks.length).toBe(360);
    expect(cube.shortfall).toBe(0);
  });

  it('is singleton (unique oracle ids, no basics)', () => {
    const ids = cube.picks.map((p) => p.card.oracleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cube.picks.some((p) => /basic/i.test(p.card.typeLine))).toBe(false);
  });

  it('hits the empirical color targets within tolerance', () => {
    const t = targetsForSize(360);
    for (const c of ['W', 'U', 'B', 'R', 'G'] as const) {
      const want = Math.round(t.color[c].median * 360);
      expect(Math.abs(cube.byBucket[c] - want)).toBeLessThanOrEqual(3);
    }
  });

  it('shapes roles toward the target rather than ignoring them', () => {
    const removal = cube.picks.filter((p) => p.card.role === 'removal').length;
    // corpus removal is ~25% of nonland; with a role-rich pool we should land well above zero.
    expect(removal).toBeGreaterThan(20);
  });

  it('annotates every pick with a reason', () => {
    expect(cube.picks.every((p) => p.reason.length > 0)).toBe(true);
  });

  it('reports balanced colors as a positive note', () => {
    expect(cube.gaps.some((g) => g.severity === 'note' && /balanced/i.test(g.text))).toBe(true);
  });
});

describe('generateCube — small pods (180 / 270)', () => {
  it('builds a full cube at the requested small size', () => {
    for (const size of [180, 270] as const) {
      const cube = generateCube(richPool(), size);
      expect(cube.picks.length).toBe(size);
      expect(cube.shortfall).toBe(0);
    }
  });

  it('reuses the 360 band RATIOS but scales the absolute fixing-land count down', () => {
    const base = targetsForSize(360);
    const small = targetsForSize(180);
    // Color/curve/role are size-free ratios → identical to the 360 band.
    expect(small.color).toEqual(base.color);
    expect(small.curve).toEqual(base.curve);
    expect(small.role).toEqual(base.role);
    // fixingLands is an absolute count → scaled by size (180/360 = ½), so a 180
    // cube isn't judged against 360-card fixing counts.
    expect(small.size).toBe(180);
    expect(small.fixingLands.p25).toBeCloseTo(base.fixingLands.p25 / 2);
    expect(small.fixingLands.median).toBeCloseTo(base.fixingLands.median / 2);
    expect(small.fixingLands.p75).toBeCloseTo(base.fixingLands.p75 / 2);
  });

  it('does not flag a healthy small-pod cube as short on fixing', () => {
    // A 180 cube at the scaled fixing median should NOT raise the fixing gap that
    // the unscaled 360 thresholds used to (29 lands vs the old 39–70).
    const cube = generateCube(richPool(), 180);
    const fixingGap = cube.gaps.find((g) => /fixing lands/i.test(g.text));
    expect(fixingGap).toBeUndefined();
  });
});

describe('generateCube — collection light in a color', () => {
  it('flags the under-supported color as a gap', () => {
    const pool = richPool().filter((c) => !(c.colors.length === 1 && c.colors[0] === 'U'));
    // add back just a handful of blue so it's present but far below target
    for (let i = 0; i < 5; i++) pool.push(card({ colors: ['U'], cmc: i, rank: 50 + i }));
    const cube = generateCube(pool, 360);
    expect(cube.gaps.some((g) => g.severity === 'short' && /Blue/i.test(g.text))).toBe(true);
  });
});

describe('generateCube — pool smaller than size', () => {
  it('ships what it can and reports the shortfall', () => {
    const pool = richPool().slice(0, 200);
    const cube = generateCube(pool, 360);
    expect(cube.picks.length).toBeLessThan(360);
    expect(cube.shortfall).toBeGreaterThan(0);
    expect(cube.gaps.some((g) => g.severity === 'short' && /short of a 360/i.test(g.text))).toBe(
      true
    );
  });
});

describe('generateCube — synergy slider', () => {
  // A rich pool plus deliberately LOW-quality (high-rank) Black sacrifice cards:
  // pure goodstuff would never pick them, so any that appear were swapped in by
  // the objective refiner. 10 enablers + 10 payoffs = a draftable archetype.
  function withSacrifice(): CubeCard[] {
    const pool = richPool();
    for (let i = 0; i < 10; i++) {
      pool.push(card({ colors: ['B'], cmc: 3, rank: 5000 + i, synergyProducers: ['sacrifice'] }));
      pool.push(card({ colors: ['B'], cmc: 3, rank: 6000 + i, synergyPayoffs: ['sacrifice'] }));
    }
    return pool;
  }
  const sacCount = (c: ReturnType<typeof generateCube>) =>
    c.picks.filter(
      (p) =>
        p.card.synergyProducers?.includes('sacrifice') ||
        p.card.synergyPayoffs?.includes('sacrifice')
    ).length;

  it('synergyLevel 0 is byte-for-byte identical to no options', () => {
    const pool = withSacrifice();
    const a = generateCube(pool, 360);
    const b = generateCube(pool, 360, { synergyLevel: 0 });
    expect(b.picks.map((p) => p.card.oracleId)).toEqual(a.picks.map((p) => p.card.oracleId));
  });

  it('pulls in more on-axis cards as synergy rises', () => {
    const pool = withSacrifice();
    const lo = sacCount(generateCube(pool, 360, { synergyLevel: 0 }));
    const hi = sacCount(generateCube(pool, 360, { synergyLevel: 1 }));
    expect(lo).toBe(0); // low-quality sacrifice cards never make a goodstuff cube
    expect(hi).toBeGreaterThan(lo);
  });

  // Regression: engaging synergy used to reserve per-axis slots BEFORE the greedy
  // shaped curve/roles, which ate the cube's removal to pay for archetype cards
  // (measured on a real 2.6k pool: 23.5% → 12.6% interaction, and a LOWER
  // objective score than not engaging synergy at all). The refiner replaced it,
  // and the objective's fit curve no longer bottoms out at 0 — so cutting
  // interaction now costs score instead of being free.
  it('does not strip interaction to pay for archetypes', () => {
    const pool = withSacrifice();
    const removalCount = (c: ReturnType<typeof generateCube>) =>
      c.picks.filter((p) => p.card.role === 'removal' || p.card.role === 'boardwipe').length;
    const goodstuff = removalCount(generateCube(pool, 360, { synergyLevel: 0 }));
    const synergy = removalCount(generateCube(pool, 360, { synergyLevel: 1 }));
    expect(goodstuff).toBeGreaterThan(0); // the fixture actually has interaction
    // The seed now lands ON the corpus removal target, so a refiner swap that
    // trims a single removal card can be a legitimate move toward the target
    // (the fit is symmetric). What must never recur is the wholesale gutting.
    expect(synergy).toBeGreaterThanOrEqual(Math.floor(goodstuff * 0.95));
  });

  it('picks up an archetype split across colors (enabler + payoff in different buckets)', () => {
    const pool = richPool();
    pool.push(card({ name: 'Outlet', colors: ['B'], rank: 9000, synergyProducers: ['sacrifice'] }));
    pool.push(card({ name: 'Payoff', colors: ['R'], rank: 9001, synergyPayoffs: ['sacrifice'] }));
    const cube = generateCube(pool, 360, { synergyLevel: 1 });
    const names = cube.picks.map((p) => p.card.name);
    expect(names).toContain('Outlet');
    expect(names).toContain('Payoff');
  });

  it('does not force a one-sided axis (enablers with no payoff)', () => {
    const pool = richPool();
    // 10 sacrifice ENABLERS, zero payoffs → not draftable → no reserve.
    for (let i = 0; i < 10; i++) {
      pool.push(card({ colors: ['B'], cmc: 3, rank: 5000 + i, synergyProducers: ['sacrifice'] }));
    }
    const cube = generateCube(pool, 360, { synergyLevel: 1 });
    const forced = cube.picks.filter((p) => p.card.synergyProducers?.includes('sacrifice')).length;
    expect(forced).toBe(0);
  });
});

describe('generateCube — archetype gaps', () => {
  const addSac = (pool: CubeCard[], producers: number, payoffs: number) => {
    for (let i = 0; i < producers; i++)
      pool.push(card({ colors: ['B'], cmc: 3, rank: 5000 + i, synergyProducers: ['sacrifice'] }));
    for (let i = 0; i < payoffs; i++)
      pool.push(card({ colors: ['B'], cmc: 3, rank: 6000 + i, synergyPayoffs: ['sacrifice'] }));
    return pool;
  };
  const hasGap = (c: ReturnType<typeof generateCube>, sev: 'short' | 'note', re: RegExp) =>
    c.gaps.some((g) => g.severity === sev && re.test(g.text));

  it('stays silent about archetypes at synergyLevel 0', () => {
    const cube = generateCube(addSac(richPool(), 14, 8), 360);
    expect(cube.gaps.some((g) => /enablers|payoff/i.test(g.text))).toBe(false);
  });

  it('celebrates a deeply supported archetype', () => {
    const cube = generateCube(addSac(richPool(), 14, 8), 360, { synergyLevel: 1 });
    expect(hasGap(cube, 'note', /Strong Sacrifice.*support/i)).toBe(true);
  });

  it('flags an enabler-rich archetype with no payoff', () => {
    const cube = generateCube(addSac(richPool(), 12, 0), 360, { synergyLevel: 1 });
    expect(hasGap(cube, 'short', /Sacrifice.*no payoff/i)).toBe(true);
  });

  it('flags a thin archetype below the draftable floor', () => {
    const cube = generateCube(addSac(richPool(), 8, 8), 360, { synergyLevel: 1 });
    expect(hasGap(cube, 'short', /Sacrifice.*thin for a draftable archetype/i)).toBe(true);
  });
});

describe('generateCube — objective score + refiner', () => {
  // Deliberately LOW-quality (high-rank) Black sacrifice cards: goodstuff would
  // never pick them, so any depth in the cube came from the reserve + refiner.
  function withSacrifice(): CubeCard[] {
    const pool = richPool();
    for (let i = 0; i < 12; i++) {
      pool.push(card({ colors: ['B'], cmc: 3, rank: 5000 + i, synergyProducers: ['sacrifice'] }));
      pool.push(card({ colors: ['B'], cmc: 3, rank: 6000 + i, synergyPayoffs: ['sacrifice'] }));
    }
    return pool;
  }

  it('attaches a bounded objective score when synergy is engaged', () => {
    const cube = generateCube(withSacrifice(), 360, { synergyLevel: 1 });
    expect(cube.score).toBeDefined();
    expect(cube.score!.total).toBeGreaterThan(0);
    expect(cube.score!.total).toBeLessThanOrEqual(1);
  });

  it('attaches no score at synergyLevel 0 (archetype depth is a slider feature)', () => {
    expect(generateCube(withSacrifice(), 360).score).toBeUndefined();
  });

  it('synergyLevel 0 does not refine — picks are byte-for-byte the greedy cube', () => {
    // Build the score independently and confirm the picks are exactly the
    // goodstuff selection (no swaps happened at level 0).
    const pool = withSacrifice();
    const a = generateCube(pool, 360);
    const b = generateCube(pool, 360, { synergyLevel: 0 });
    expect(b.picks.map((p) => p.card.oracleId)).toEqual(a.picks.map((p) => p.card.oracleId));
  });

  it('refining (synergyLevel > 0) scores at least as high as the un-refined seed', () => {
    const pool = withSacrifice();
    const band = targetsForSize(360);
    const seedScore = scoreCube(generateCube(pool, 360).picks, pool, band, 360).total;
    const refined = generateCube(pool, 360, { synergyLevel: 1 });
    expect(refined.score!.total).toBeGreaterThanOrEqual(seedScore);
  });

  it('is deterministic under refinement (same pool + size → identical cube)', () => {
    const pool = withSacrifice();
    const a = generateCube(pool, 360, { synergyLevel: 1 });
    const b = generateCube(pool, 360, { synergyLevel: 1 });
    expect(a.picks.map((p) => p.card.oracleId)).toEqual(b.picks.map((p) => p.card.oracleId));
  });
});

describe('generateCube — dedupes duplicate printings to one copy', () => {
  it('keeps the best-ranked copy of a repeated oracle id', () => {
    const dupes = [
      card({ name: 'Sol Ring', oracleId: 'sol', colors: [], typeLine: 'Artifact', rank: 999 }),
      card({ name: 'Sol Ring', oracleId: 'sol', colors: [], typeLine: 'Artifact', rank: 1 }),
    ];
    const cube = generateCube([...dupes, ...richPool()], 360);
    const sols = cube.picks.filter((p) => p.card.oracleId === 'sol');
    expect(sols.length).toBe(1);
    expect(sols[0].card.rank).toBe(1);
  });
});

describe('generateCube — locked and banned (cube edit)', () => {
  it('is byte-for-byte identical to no-options when locked/banned are empty', () => {
    const pool = richPool();
    const a = generateCube(pool, 360);
    const b = generateCube(pool, 360, { locked: [], banned: [] });
    expect(b.picks.map((p) => p.card.oracleId)).toEqual(a.picks.map((p) => p.card.oracleId));
    expect(b.byBucket).toEqual(a.byBucket);
    expect(b.shortfall).toBe(a.shortfall);
  });

  it('banned cards never appear in the result', () => {
    const pool = richPool();
    const base = generateCube(pool, 360);
    const bannedId = base.picks[0].card.oracleId;
    const cube = generateCube(pool, 360, { banned: [bannedId] });
    expect(cube.picks.some((p) => p.card.oracleId === bannedId)).toBe(false);
    expect(cube.poolSize).toBe(base.poolSize - 1);
  });

  it('locked cards always appear in their color bucket, filling the cube around them', () => {
    const pool = richPool();
    const target = pool.find((c) => c.colors[0] === 'W')!;
    const cube = generateCube(pool, 360, { locked: [target] });
    expect(cube.picks.some((p) => p.card.oracleId === target.oracleId)).toBe(true);
    expect(cube.picks.length).toBe(360);
  });

  it('a locked card no longer in the pool is still seated, using its saved data', () => {
    const pool = richPool();
    const sold = pool.find((c) => c.colors[0] === 'G')!;
    const remaining = pool.filter((c) => c.oracleId !== sold.oracleId);
    const cube = generateCube(remaining, 360, { locked: [sold] });
    expect(cube.picks.some((p) => p.card.oracleId === sold.oracleId)).toBe(true);
  });

  it('banning a locked card drops it — bans win over locks', () => {
    const pool = richPool();
    const target = pool.find((c) => c.colors[0] === 'R')!;
    const cube = generateCube(pool, 360, { locked: [target], banned: [target.oracleId] });
    expect(cube.picks.some((p) => p.card.oracleId === target.oracleId)).toBe(false);
  });

  it('a locked card counts toward its bucket target — no duplicate slot spent', () => {
    const pool = richPool();
    const target = pool.find((c) => c.colors[0] === 'U')!;
    const withLock = generateCube(pool, 360, { locked: [target] });
    const withoutLock = generateCube(pool, 360);
    // Locking a card that the unlocked build already picked doesn't grow the cube.
    expect(withLock.picks.length).toBe(withoutLock.picks.length);
  });

  it('is deterministic with locks and bans (same pool + size + options → same cube)', () => {
    const pool = richPool();
    const locked = [pool[10], pool[50]];
    const banned = [pool[20].oracleId, pool[60].oracleId];
    const a = generateCube(pool, 360, { locked, banned, synergyLevel: 1 });
    const b = generateCube(pool, 360, { locked, banned, synergyLevel: 1 });
    expect(a.picks.map((p) => p.card.oracleId)).toEqual(b.picks.map((p) => p.card.oracleId));
  });
});

describe('generateCube — pick reasons', () => {
  it('quota picks name the quota and the count', () => {
    const cube = generateCube(richPool(), 360);
    const removalPicks = cube.picks.filter((p) => /^Removal quota \(/.test(p.reason));
    expect(removalPicks.length).toBeGreaterThan(0);
    expect(removalPicks[0].reason).toMatch(/^Removal quota \(\d+ of \d+\)/);
  });

  it('quota picks name a runner-up (and the byQuality field that decided it) when the pool has more of the role than the quota takes', () => {
    // Removal supply (40) far exceeds any plausible per-bucket quota, so the
    // top picks each have a real runner-up left in the deferred pile.
    const pool = richPool();
    for (let i = 0; i < 40; i++)
      pool.push(
        card({
          colors: ['W'],
          cmc: 1 + (i % 5),
          role: 'removal',
          rank: 1 + i,
          name: `Removal ${i}`,
        })
      );
    const cube = generateCube(pool, 360);
    const removalPicks = cube.picks.filter((p) => /^Removal quota \(/.test(p.reason));
    expect(removalPicks.some((p) => /· beat .+ on EDHREC rank$/.test(p.reason))).toBe(true);
  });

  it("curve fill names the color, the slot, and the count toward that slot's cap", () => {
    const cube = generateCube(richPool(), 360);
    const curvePicks = cube.picks.filter((p) => /^Fills \w+('s)? \d(\+)?-drops \(/.test(p.reason));
    expect(curvePicks.length).toBeGreaterThan(0);
    expect(curvePicks[0].reason).toMatch(/^Fills \w+('s)? \d(\+)?-drops \(\d+ of \d+\)/);
  });

  it('has no runner-up clause for the last eligible card', () => {
    // A pool with exactly one card of a kind — nothing else competed for its slot.
    const pool = richPool();
    pool.push(card({ name: 'Lone Payoff', colors: ['B'], rank: 1, synergyPayoffs: ['sacrifice'] }));
    const cube = generateCube(pool, 360, { synergyLevel: 1 });
    // Not asserting WHICH reason kind it lands as — only that at least one pick's
    // reason has no "beat" clause, proving the omission path is reachable.
    expect(cube.picks.some((p) => !/beat .+ on/.test(p.reason))).toBe(true);
  });

  it('locked cards say what the row\'s "Locked" pill does not', () => {
    const pool = richPool();
    const target = pool.find((c) => c.colors[0] === 'W')!;
    const cube = generateCube(pool, 360, { locked: [target] });
    expect(cube.picks.find((p) => p.card.oracleId === target.oracleId)!.reason).toBe(
      'Kept through rebuilds'
    );
  });

  it('filler by quality: a color/bucket with no competition just says so, no runner-up', () => {
    const pool = richPool()
      .filter((c) => !(c.colors.length === 0 && c.typeLine === 'Artifact'))
      .concat([
        card({ colors: [], typeLine: 'Artifact', cmc: 2, rank: 5 }),
        card({ colors: [], typeLine: 'Artifact', cmc: 3, rank: 6 }),
      ]);
    const cube = generateCube(pool, 360);
    const colorlessPicks = cube.picks.filter((p) => p.card.typeLine === 'Artifact');
    expect(colorlessPicks.length).toBe(2);
    for (const p of colorlessPicks) expect(p.reason).toBe('Best remaining colorless card');
  });

  it('in-bucket backfill: a color stuck at one curve slot says it ran out of on-curve cards', () => {
    const pool = richPool()
      .filter((c) => !(c.colors.length === 1 && c.colors[0] === 'U'))
      .concat(Array.from({ length: 60 }, (_, i) => card({ colors: ['U'], cmc: 3, rank: 800 + i })));
    const cube = generateCube(pool, 360);
    const backfilled = cube.picks.filter((p) =>
      /^Blue ran out of on-curve cards · best remaining/.test(p.reason)
    );
    expect(backfilled.length).toBeGreaterThan(0);
  });

  it("cross-bucket backfill names the color that actually ran short, not the picked card's own color", () => {
    const pool = richPool()
      .filter((c) => !(c.colors.length === 1 && c.colors[0] === 'G'))
      .concat(
        Array.from({ length: 10 }, (_, i) => card({ colors: ['G'], cmc: i % 6, rank: 4000 + i }))
      );
    const cube = generateCube(pool, 360);
    expect(
      cube.picks.some((p) => p.reason === 'Fills a gap: green ran short in your collection')
    ).toBe(true);
  });

  it('fixing lands: a pair-targeted land names the pair and the count, a plain one says "Land by quality"', () => {
    const pool = richPool().concat(
      Array.from({ length: 8 }, (_, i) =>
        card({
          name: `WU Land ${i}`,
          colors: [],
          typeLine: 'Land',
          rank: 50 + i,
          colorIdentity: ['W', 'U'],
          producedMana: ['W', 'U'],
        })
      )
    );
    const cube = generateCube(pool, 360);
    const fixesPicks = cube.picks.filter((p) => /^Fixes WU \(/.test(p.reason));
    expect(fixesPicks.length).toBeGreaterThan(0);
    expect(fixesPicks[0].reason).toMatch(/^Fixes WU \(\d+ of \d+\)/);
    const genericLandPicks = cube.picks.filter((p) => p.reason.startsWith('Land by quality'));
    expect(genericLandPicks.length).toBeGreaterThan(0);
  });

  it('refiner swaps name the archetype it deepened and the card it replaced', () => {
    const pool = richPool();
    for (let i = 0; i < 12; i++) {
      pool.push(card({ colors: ['B'], cmc: 3, rank: 5000 + i, synergyProducers: ['sacrifice'] }));
      pool.push(card({ colors: ['B'], cmc: 3, rank: 6000 + i, synergyPayoffs: ['sacrifice'] }));
    }
    const cube = generateCube(pool, 360, { synergyLevel: 1 });
    const swapped = cube.picks.filter((p) =>
      /^Deepens .+ \(\d+ enablers?, \d+ payoffs?\) · replaced .+/.test(p.reason)
    );
    expect(swapped.length).toBeGreaterThan(0);
  });
});

describe('byQuality — the cube signal outranks EDHREC rank (E288)', () => {
  it('orders by cube popularity, then Elo, then rank, then oracleId', () => {
    const signet = card({
      name: 'Arcane Signet',
      oracleId: 'a',
      rank: 3,
      cubePop: 4.25,
      cubeElo: 1655,
    });
    const mindStone = card({
      name: 'Mind Stone',
      oracleId: 'b',
      rank: 32,
      cubePop: 14.94,
      cubeElo: 1366,
    });
    const bolt = card({
      name: 'Lightning Bolt',
      oracleId: 'c',
      rank: 158,
      cubePop: 26.41,
      cubeElo: 1658,
    });
    const tiePopLowElo = card({ oracleId: 'd', rank: 1, cubePop: 14.94, cubeElo: 1200 });
    const neverCubedTop = card({ oracleId: 'e', rank: 1 }); // EDHREC #1, unknown to CubeCobra
    const neverCubedLow = card({ oracleId: 'f', rank: 9000 });
    const unranked = card({ oracleId: 'g' });
    const sorted = [
      unranked,
      neverCubedLow,
      tiePopLowElo,
      signet,
      neverCubedTop,
      mindStone,
      bolt,
    ].sort(byQuality);
    expect(sorted.map((c) => c.oracleId)).toEqual(['c', 'b', 'd', 'a', 'e', 'f', 'g']);
  });

  it('is deterministic regardless of input order', () => {
    const cards = [
      card({ oracleId: 'x', cubePop: 1 }),
      card({ oracleId: 'y', cubePop: 1 }),
      card({ oracleId: 'z', rank: 4 }),
    ];
    const a = [...cards].sort(byQuality).map((c) => c.oracleId);
    const b = [...cards]
      .reverse()
      .sort(byQuality)
      .map((c) => c.oracleId);
    expect(a).toEqual(b);
    expect(a).toEqual(['x', 'y', 'z']);
  });
});

describe('role ceilings (E288) — a quota is a floor AND the cap', () => {
  it('stops taking ramp past its quota even when every ramp card outranks the filler', () => {
    const pool: CubeCard[] = [];
    const colors: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G']];
    for (const c of colors) {
      // 40 top-signal ramp cards per color would fill 80% of a color's section
      // by quality alone; the filler creatures are all weaker.
      for (let i = 0; i < 40; i++)
        pool.push(
          card({
            colors: c,
            cmc: 1 + (i % 4),
            typeLine: 'Artifact',
            role: 'ramp',
            cubePop: 50 - i * 0.1,
          })
        );
      for (let i = 0; i < 60; i++)
        pool.push(
          card({ colors: c, cmc: 1 + (i % 6), typeLine: 'Creature — Elf', cubePop: 10 - i * 0.1 })
        );
    }
    for (let i = 0; i < 90; i++)
      pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, cubePop: 5 }));
    const cube = generateCube(pool, 360);
    expect(cube.picks).toHaveLength(360);
    const nonland = cube.picks.filter((p) => !/land/i.test(p.card.typeLine));
    const ramp = nonland.filter((p) => p.card.role === 'ramp').length / nonland.length;
    const band = targetsForSize(360);
    expect(ramp).toBeLessThanOrEqual(band.role.ramp.median + 0.02);
    expect(ramp).toBeGreaterThanOrEqual(band.role.ramp.median - 0.02);
  });

  it('still fills the cube from capped cards when nothing else is left', () => {
    const pool: CubeCard[] = [];
    for (let i = 0; i < 400; i++)
      pool.push(
        card({
          colors: [['W'], ['U'], ['B'], ['R'], ['G']][i % 5],
          cmc: 1 + (i % 5),
          typeLine: 'Artifact',
          role: 'ramp',
          cubePop: 20,
        })
      );
    const cube = generateCube(pool, 180);
    expect(cube.picks).toHaveLength(180);
  });
});

describe('play format', () => {
  it('stamps the format on the cube and shapes a commander cube toward the Commander band', () => {
    const pool = richPool();
    const draft = generateCube(pool, 360);
    const commander = generateCube(pool, 360, { format: 'commander' });
    expect(draft.format).toBe('limited');
    expect(commander.format).toBe('commander');
    expect(commander.picks).toHaveLength(360);
    // Different corpus → different color/land apportionment.
    expect(commander.targetByBucket).not.toEqual(draft.targetByBucket);
    expect(commander.targetByBucket).toEqual(
      generateCube(pool, 360, { format: 'commander' }).targetByBucket
    );
  });
});

describe('legend shortfall gap (board #12, PR3)', () => {
  it('adds a "short" gap when the commander cube has fewer legends than LEGEND_TARGET, and never for limited', () => {
    // richPool() has no legendary creatures at all, so a Commander build's
    // legend section is empty — well short of any size's target.
    const pool = richPool();
    const commander = generateCube(pool, 360, { format: 'commander' });
    expect(commander.legends).toEqual([]);
    const shortGap = commander.gaps.find((g) => /legendary creatures are eligible/.test(g.text));
    expect(shortGap).toBeDefined();
    expect(shortGap!.severity).toBe('short');
    expect(shortGap!.text).toBe(
      'Only 0 legendary creatures are eligible, 100 short of the 100-commander target.'
    );

    // The same pool built as limited never mentions legends at all.
    const limited = generateCube(pool, 360);
    expect(limited.gaps.some((g) => /legendary creatures are eligible/.test(g.text))).toBe(false);
  });

  it('adds no shortfall gap once the pool supplies at least the target', () => {
    // richPool() alone already fills every spell bucket (90 cards/colour vs.
    // a ~36-card target at 180), so 125 ADDITIONAL legendary creatures,
    // ranked worse than anything richPool already offers, are never needed
    // as spells and stay free for the legend section.
    const pool = richPool();
    const colors: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G']];
    for (const c of colors) {
      for (let i = 0; i < 25; i++) {
        pool.push(
          card({ colors: c, typeLine: 'Legendary Creature — Test', cmc: 3, rank: 90000 + i })
        );
      }
    }
    // 125 legends comfortably covers 180's target (60).
    const commander = generateCube(pool, 180, { format: 'commander' });
    expect(commander.legends!.length).toBe(60);
    expect(commander.gaps.some((g) => /legendary creatures are eligible/.test(g.text))).toBe(false);
  });
});

describe('gap copy — fixing lands and corpus naming (board E462)', () => {
  /** Same shape as richPool() minus every land card, so the fixing gap always
   *  fires with a real (zero) count instead of a synthetic one. */
  function poolNoLands(): CubeCard[] {
    const pool: CubeCard[] = [];
    const colors: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G']];
    for (const c of colors) {
      for (let i = 0; i < 90; i++) {
        pool.push(card({ colors: c, cmc: i % 8, rank: i * 10 + c[0].charCodeAt(0) }));
      }
    }
    for (let i = 0; i < 60; i++) pool.push(card({ colors: ['W', 'U'], cmc: 3, rank: 500 + i }));
    return pool;
  }

  it('says "No fixing lands" — never "Only 0" — when the cube has none', () => {
    const cube = generateCube(poolNoLands(), 360);
    const fixingGap = cube.gaps.find((g) => /fixing lands/i.test(g.text));
    expect(fixingGap).toBeDefined();
    expect(fixingGap!.text.startsWith('No fixing lands.')).toBe(true);
    expect(fixingGap!.text).not.toMatch(/Only 0/);
  });

  it('still says "Only N fixing lands" when the count is nonzero', () => {
    const pool = poolNoLands();
    for (let i = 0; i < 3; i++) {
      pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 900 + i }));
    }
    const cube = generateCube(pool, 360);
    const fixingGap = cube.gaps.find((g) => /fixing lands/i.test(g.text))!;
    expect(fixingGap.text.startsWith('Only 3 fixing lands.')).toBe(true);
  });

  it('names the size-band corpus with "Real ... run" phrasing for a limited cube', () => {
    const cube = generateCube(poolNoLands(), 360);
    const fixingGap = cube.gaps.find((g) => /fixing lands/i.test(g.text))!;
    expect(fixingGap.text).toMatch(/Real 360-card cubes run \d+–\d+\./);
  });

  it('names the Commander corpus, not the generic size band, for a Commander cube', () => {
    const cube = generateCube(poolNoLands(), 360, { format: 'commander' });
    const fixingGap = cube.gaps.find((g) => /fixing lands/i.test(g.text))!;
    expect(fixingGap.text).toMatch(/Real Commander cubes run \d+–\d+\./);
    expect(fixingGap.text).not.toMatch(/360-card cubes/);
  });

  it('still names the pauper/peasant corpus for a rarity-shaped limited cube (unaffected by this fix)', () => {
    const cube = generateCube(poolNoLands(), 360, { rarity: 'pauper' });
    const fixingGap = cube.gaps.find((g) => /fixing lands/i.test(g.text))!;
    expect(fixingGap.text).toMatch(/Real pauper cubes run/);
  });
});

describe('apportion', () => {
  it('sums bucket targets to exactly `size`, for every band and every offered size (E454)', () => {
    for (const format of ['limited', 'commander'] as const) {
      for (const size of CUBE_SIZES) {
        const band = targetsForSize(size, format);
        const shares = Object.fromEntries(
          Object.entries(band.color).map(([bucket, stat]) => [bucket, stat.median])
        ) as Record<keyof typeof band.color, number>;
        const targetByBucket = apportion(shares, size);
        const sum = Object.values(targetByBucket).reduce((a, b) => a + b, 0);
        expect(sum, `${format} ${size}`).toBe(size);
      }
    }
  });
});
