import { describe, it, expect } from 'vitest';
import { generateCube, bucketOf, type CubeCard, type Pick } from './generate';
import { targetsForSize, type CubeSize } from './targets';
import {
  scoreCube,
  rawPower,
  computeRankP80,
  targetArchetypeCount,
  type CubeScore,
} from './objective';

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
    synergyProducers: p.synergyProducers,
    synergyPayoffs: p.synergyPayoffs,
  };
}
const picksOf = (cards: CubeCard[]): Pick[] =>
  cards.map((c) => ({ card: c, bucket: bucketOf(c), reason: '' }));

function richPool(): CubeCard[] {
  const pool: CubeCard[] = [];
  for (const c of [['W'], ['U'], ['B'], ['R'], ['G']] as CubeCard['colors'][]) {
    for (let i = 0; i < 90; i++)
      pool.push(
        card({ colors: c, cmc: i % 8, role: i % 7 === 0 ? 'removal' : null, rank: i * 10 })
      );
  }
  for (let i = 0; i < 60; i++)
    pool.push(card({ colors: [], typeLine: 'Artifact', cmc: 2, rank: 600 + i }));
  for (let i = 0; i < 90; i++)
    pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 700 + i }));
  return pool;
}

describe('rawPower', () => {
  it('is bounded to [0,1]', () => {
    const p80 = 1000;
    for (const c of [
      card({ rank: 1, cmc: 0 }),
      card({ rank: 9999, cmc: 9 }),
      card({ rank: undefined, cmc: 3 }),
    ]) {
      const v = rawPower(c, p80);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('rewards an efficient instant over an identical sorcery (flash/tempo)', () => {
    const p80 = 1000;
    const instant = card({ rank: 500, cmc: 1, typeLine: 'Instant' });
    const sorcery = card({ rank: 500, cmc: 1, typeLine: 'Sorcery' });
    expect(rawPower(instant, p80)).toBeGreaterThan(rawPower(sorcery, p80));
  });

  it('weights a top-rank card above a fringe-rank one at equal cmc', () => {
    const p80 = 1000;
    expect(rawPower(card({ rank: 1, cmc: 3 }), p80)).toBeGreaterThan(
      rawPower(card({ rank: 999, cmc: 3 }), p80)
    );
  });
});

describe('computeRankP80', () => {
  it('returns the 80th-percentile rank of the pool', () => {
    const pool = Array.from({ length: 10 }, (_, i) => card({ rank: (i + 1) * 10 }));
    // sorted ranks 10..100; P80 (0-indexed) = floor((10-1)*0.8) = 7 → 80
    expect(computeRankP80(pool)).toBe(80);
  });
  it('falls back to a neutral floor when no card has a rank', () => {
    expect(computeRankP80([card({ rank: undefined }), card({ rank: undefined })])).toBe(5000);
  });
});

describe('scoreCube — bounds & terms', () => {
  it('total and every term are in [0,1] for real cubes at every size', () => {
    for (const size of [180, 270, 360, 450, 540, 720] as CubeSize[]) {
      const cube = generateCube(richPool(), size);
      const band = targetsForSize(size);
      const s = scoreCube(cube.picks, richPool(), band, size);
      for (const k of [
        'archetype',
        'glue',
        'color',
        'curve',
        'interaction',
        'power',
        'total',
      ] as (keyof CubeScore)[]) {
        expect(s[k] as number).toBeGreaterThanOrEqual(0);
        expect(s[k] as number).toBeLessThanOrEqual(1);
      }
    }
  });

  it('color term scores actual proportions, unbiased by a target-size shortfall', () => {
    // A 120-card cube built to the 360 band's exact color medians. Because the
    // color term divides by actual picks (not the 360 target), the matching
    // proportions score near-perfect — the old `/ size` denominator would have
    // collapsed every color to ~0 on a cube this far under size.
    const band = targetsForSize(360);
    const n = 120;
    const picks: CubeCard[] = [];
    for (const col of ['W', 'U', 'B', 'R', 'G'] as const) {
      const cnt = Math.round(band.color[col].median * n);
      for (let i = 0; i < cnt; i++) picks.push(card({ colors: [col], cmc: i % 6, rank: i }));
    }
    while (picks.length < n)
      picks.push(card({ colors: [], typeLine: 'Artifact', rank: picks.length }));
    const s = scoreCube(picksOf(picks), picks, band, 360);
    // Healthy (>0.6) despite n≪360; the old `/ size` denominator would collapse
    // every color toward 0 (shares would read as ~⅓ of their true value).
    expect(s.color).toBeGreaterThan(0.6);
  });
});

describe('scoreCube — archetype portfolio', () => {
  const band = targetsForSize(360);

  it('scores an enabler-only axis at 0 when the cube fails to draft its payoff', () => {
    // The pool CAN draft sacrifice (has both sides), but the cube took only
    // enablers → symmetric balance makes that axis (and the term) score 0.
    const cube = Array.from({ length: 5 }, () =>
      card({ colors: ['B'], synergyProducers: ['sacrifice'] })
    );
    const pool = [...cube, card({ colors: ['B'], synergyPayoffs: ['sacrifice'] })];
    const s = scoreCube(picksOf(cube), pool, band, 360);
    expect(s.axes.find((a) => a.axis === 'sacrifice')?.score).toBe(0);
    expect(s.archetype).toBe(0);
  });

  it('does not penalize a zero-tag pool (archetype = 1)', () => {
    const cards = Array.from({ length: 20 }, () => card({}));
    expect(scoreCube(picksOf(cards), cards, band, 360).archetype).toBe(1);
  });

  it('caps a blanket spellslinger pile so it cannot fake deep support', () => {
    const cards: CubeCard[] = [];
    for (let i = 0; i < 200; i++)
      cards.push(card({ colors: ['U'], typeLine: 'Instant', synergyProducers: ['spellslinger'] }));
    cards.push(card({ colors: ['U'], synergyPayoffs: ['spellslinger'] }));
    const s = scoreCube(picksOf(cards), cards, band, 360);
    const ss = s.axes.find((a) => a.axis === 'spellslinger');
    // 1 payoff vs a capped enabler count → balance is tiny → score stays low.
    expect(ss!.score).toBeLessThan(0.2);
  });

  it('targetArchetypeCount scales ~1.25 per drafter (5 at 180, 10 at a full pod)', () => {
    expect(targetArchetypeCount(180)).toBe(5); // round(1.25 * 4 drafters)
    expect(targetArchetypeCount(360)).toBe(10); // round(1.25 * 8 drafters)
  });

  it('scores the best-K archetypes — extra unsupportable themes do not dilute it', () => {
    // A 180 cube (targetArchetypeCount = 5) that deeply, mono-color drafts five
    // archetypes scores ~1 on each. Adding TEN more axes the *pool* can draft but
    // the cube never touches must NOT drag the term down — a focused cube isn't
    // penalized for ignoring themes no 4-player pod can pursue. The old
    // mean-over-all-draftable would have collapsed this from 1.0 → 5/15 ≈ 0.33.
    const b180 = targetsForSize(180);
    const CUBE_AXES = ['sacrifice', 'tokens', 'landfall', 'graveyard', 'artifacts'] as const;
    const EXTRA_AXES = [
      'counters',
      'lifegain',
      'enchantress',
      'tribal',
      'blink',
      'grouphug',
      'discard',
      'mill',
      'monarch',
      'venture',
    ] as const;
    const cube: CubeCard[] = [];
    for (const ax of CUBE_AXES) {
      for (let i = 0; i < 6; i++) cube.push(card({ colors: ['B'], synergyProducers: [ax] }));
      for (let i = 0; i < 6; i++) cube.push(card({ colors: ['B'], synergyPayoffs: [ax] }));
    }
    // Extras live only in the pool (never picked) but make 10 more axes draftable.
    const extras: CubeCard[] = [];
    for (const ax of EXTRA_AXES) {
      extras.push(card({ colors: ['G'], synergyProducers: [ax] }));
      extras.push(card({ colors: ['G'], synergyPayoffs: [ax] }));
    }
    const focused = scoreCube(picksOf(cube), cube, b180, 180).archetype;
    const withTail = scoreCube(picksOf(cube), [...cube, ...extras], b180, 180).archetype;
    expect(focused).toBeGreaterThan(0.9); // five deep, balanced, concentrated axes
    expect(withTail).toBeCloseTo(focused, 10); // the long tail is ignored, not averaged in
  });

  it('rewards a balanced, color-concentrated axis above a smeared one', () => {
    const focused: CubeCard[] = [];
    for (let i = 0; i < 8; i++)
      focused.push(card({ colors: ['B'], synergyProducers: ['sacrifice'] }));
    for (let i = 0; i < 8; i++)
      focused.push(card({ colors: ['B'], synergyPayoffs: ['sacrifice'] }));
    const smeared: CubeCard[] = [];
    const five = [['W'], ['U'], ['B'], ['R'], ['G']];
    for (let i = 0; i < 8; i++)
      smeared.push(card({ colors: five[i % 5], synergyProducers: ['sacrifice'] }));
    for (let i = 0; i < 8; i++)
      smeared.push(card({ colors: five[i % 5], synergyPayoffs: ['sacrifice'] }));
    const sf = scoreCube(picksOf(focused), focused, band, 360).axes[0].score;
    const sm = scoreCube(picksOf(smeared), smeared, band, 360).axes[0].score;
    expect(sf).toBeGreaterThan(sm);
  });
});

describe('scoreCube — other terms', () => {
  const band = targetsForSize(360);

  it('glue excludes spellslinger (a pile of bare instants scores 0 glue)', () => {
    const cards = Array.from({ length: 10 }, () =>
      card({ colors: ['U'], typeLine: 'Instant', synergyProducers: ['spellslinger'] })
    );
    expect(scoreCube(picksOf(cards), cards, band, 360).glue).toBe(0);
  });

  it('interaction divides by nonland count — lands do not dilute it (M5)', () => {
    // Same 40 nonland cards (20 removal); only the land count differs. If the
    // denominator were total size, these would diverge; because it's nonland,
    // the interaction score is identical.
    const nonland = [
      ...Array.from({ length: 20 }, () => card({ role: 'removal', colors: ['R'] })),
      ...Array.from({ length: 20 }, () => card({ colors: ['R'] })),
    ];
    const noLands = nonland;
    const withLands = [...nonland, ...Array.from({ length: 40 }, () => card({ typeLine: 'Land' }))];
    const a = scoreCube(picksOf(noLands), noLands, band, noLands.length).interaction;
    const b = scoreCube(picksOf(withLands), withLands, band, withLands.length).interaction;
    expect(a).toBeCloseTo(b, 5);
  });

  it('caps a fixing-starved cube with the 0.75 multiplier', () => {
    // No lands at all → below p25 * 0.5 → multiplier kicks in.
    const cards = Array.from({ length: 100 }, (_, i) => card({ colors: ['W'], rank: i }));
    const s = scoreCube(picksOf(cards), cards, band, 100);
    expect(s.fixingMultiplier).toBe(0.75);
    expect(s.total).toBeLessThan(
      0.4 * s.archetype +
        0.15 * s.glue +
        0.15 * s.color +
        0.15 * s.curve +
        0.1 * s.interaction +
        0.05 * s.power
    );
  });

  it('power consistency drops when the bottom decile is weak', () => {
    const band360 = targetsForSize(360);
    const strong = Array.from({ length: 50 }, () => card({ rank: 1, cmc: 1, typeLine: 'Instant' }));
    const weakTail = [
      ...Array.from({ length: 40 }, () => card({ rank: 1, cmc: 1, typeLine: 'Instant' })),
      ...Array.from({ length: 10 }, () => card({ rank: 99999, cmc: 9 })),
    ];
    expect(scoreCube(picksOf(strong), strong, band360, 360).power).toBeGreaterThan(
      scoreCube(picksOf(weakTail), weakTail, band360, 360).power
    );
  });
});
