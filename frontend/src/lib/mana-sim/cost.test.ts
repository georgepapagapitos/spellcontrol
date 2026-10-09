import { describe, expect, it } from 'vitest';
import {
  allocate,
  canPay,
  canPayWithDrops,
  dropShortMask,
  dropTotal,
  maskOf,
  parseManaCost,
  popcount,
  symbolsOf,
  type DropSupply,
  type PoolUnit,
} from './cost';
import { ANY_COLOR, MANA_B, MANA_C, MANA_G, MANA_R, MANA_U, MANA_W } from './types';

const cost = (text: string) => {
  const c = parseManaCost(text);
  if (!c) throw new Error(`unparsed ${text}`);
  return c;
};

describe('mask helpers', () => {
  it('builds, counts and spells masks', () => {
    expect(maskOf(['W', 'u', 'X'])).toBe(MANA_W | MANA_U);
    expect(popcount(MANA_W | MANA_B | MANA_C)).toBe(3);
    expect(symbolsOf(MANA_U | MANA_G | MANA_C)).toEqual(['U', 'G', 'C']);
  });
});

describe('parseManaCost', () => {
  it('returns null for no cost', () => {
    expect(parseManaCost(undefined)).toBeNull();
    expect(parseManaCost('')).toBeNull();
  });

  it('reads generic and colored pips (Wrath of God)', () => {
    const c = cost('{2}{W}{W}');
    expect(c).toMatchObject({ mv: 4, generic: 2, pips: [MANA_W, MANA_W], units: 4 });
    expect(c.checks).toEqual([{ mask: MANA_W, need: 2 }]);
  });

  it('reads {0} as free (Ornithopter)', () => {
    expect(cost('{0}')).toMatchObject({ mv: 0, units: 0, pips: [] });
  });

  it('reads X as zero (Fireball)', () => {
    expect(cost('{X}{R}')).toMatchObject({ mv: 1, generic: 0, pips: [MANA_R] });
  });

  it('reads hybrid as one pip of either color (Kitchen Finks)', () => {
    const c = cost('{1}{G/W}{G/W}');
    expect(c.pips).toEqual([MANA_W | MANA_G, MANA_W | MANA_G]);
    expect(c.mv).toBe(3);
  });

  it('pays Phyrexian pips with life (Dismember)', () => {
    expect(cost('{1}{B/P}{B/P}')).toMatchObject({ mv: 3, units: 1, pips: [] });
  });

  it('reads {2/W} as a W pip worth 2 mana value (Spectral Procession)', () => {
    expect(cost('{2/W}{2/W}{2/W}')).toMatchObject({ mv: 6, pips: [MANA_W, MANA_W, MANA_W] });
  });

  it('reads {C} as a colourless-specific pip and snow as generic', () => {
    expect(cost('{3}{C}').pips).toEqual([MANA_C]);
    expect(cost('{2}{G}{S}')).toMatchObject({ generic: 3, mv: 4 });
  });

  it('builds a Hall check for every union of pip masks', () => {
    const c = cost('{W}{U}{U}');
    expect(c.checks).toEqual(
      expect.arrayContaining([
        { mask: MANA_W, need: 1 },
        { mask: MANA_U, need: 2 },
        { mask: MANA_W | MANA_U, need: 3 },
      ])
    );
    expect(c.key).toBe(cost('{U}{W}{U}').key);
  });
});

describe('canPay', () => {
  it('pays when each pip has its own source', () => {
    expect(canPay(cost('{1}{W}{U}'), [MANA_W, MANA_U, MANA_C])).toBe(true);
  });

  it('refuses when the mana amount is short', () => {
    expect(canPay(cost('{2}{W}'), [MANA_W, MANA_W])).toBe(false);
  });

  it('refuses when one dual would have to pay two pips', () => {
    // A single W/U dual and a Mountain can't make {W}{U}.
    expect(canPay(cost('{W}{U}'), [MANA_W | MANA_U, MANA_R])).toBe(false);
    expect(canPay(cost('{W}{U}'), [MANA_W | MANA_U, MANA_U])).toBe(true);
  });

  it('counts the extra units', () => {
    expect(canPay(cost('{U}{U}'), [MANA_U], [MANA_U | MANA_B])).toBe(true);
  });

  it('pays hybrid from either color', () => {
    expect(canPay(cost('{1}{G/W}{G/W}'), [MANA_G, MANA_W, MANA_B])).toBe(true);
    expect(canPay(cost('{1}{G/W}{G/W}'), [MANA_G, MANA_B, MANA_B])).toBe(false);
  });

  it('needs a real colorless source for {C}', () => {
    expect(canPay(cost('{3}{C}'), [MANA_W, MANA_W, MANA_W, ANY_COLOR])).toBe(false);
    expect(canPay(cost('{3}{C}'), [MANA_W, MANA_W, MANA_W, MANA_C])).toBe(true);
  });
});

describe('drop supply', () => {
  const supply = (p: Partial<DropSupply>): DropSupply => ({
    fixed: [],
    early: [],
    flex: [],
    today: [],
    drops: 0,
    ...p,
  });

  it('caps lands at the drops made plus today', () => {
    const s = supply({ flex: [MANA_W, MANA_W, MANA_W], drops: 1 });
    expect(dropTotal(s)).toBe(2);
    expect(canPayWithDrops(cost('{W}{W}'), s)).toBe(true);
    expect(canPayWithDrops(cost('{1}{W}{W}'), s)).toBe(false);
  });

  it('lets a tapped-now land only be an earlier drop', () => {
    // One drop made; two taplands in hand could only have filled that one slot.
    const s = supply({ early: [MANA_U, MANA_U], drops: 1 });
    expect(dropTotal(s)).toBe(1);
    expect(canPayWithDrops(cost('{U}{U}'), s)).toBe(false);
    // An untapped land for today makes the second blue.
    expect(canPayWithDrops(cost('{U}{U}'), { ...s, today: [MANA_U] })).toBe(true);
  });

  it("uses at most one of this turn's draws", () => {
    const s = supply({ today: [MANA_R, MANA_R], drops: 0 });
    expect(dropTotal(s)).toBe(1);
    expect(canPayWithDrops(cost('{R}{R}'), { ...s, drops: 5 })).toBe(false);
  });

  it('adds fixed mana outside the land caps', () => {
    const s = supply({ fixed: [MANA_C, MANA_C], flex: [MANA_G], drops: 0 });
    expect(dropTotal(s)).toBe(3);
    expect(canPayWithDrops(cost('{2}{G}'), s)).toBe(true);
  });

  it('memoizes per mask when given a memo', () => {
    const memo = new Int32Array(64).fill(-1);
    const s = supply({ flex: [MANA_W], today: [MANA_W], drops: 1, memo });
    expect(canPayWithDrops(cost('{W}{W}'), s)).toBe(true);
    expect(memo[MANA_W]).toBe(2);
    expect(canPayWithDrops(cost('{W}{W}'), s)).toBe(true);
  });

  it('blames the color that was short, or both when they share one source', () => {
    const one = supply({ flex: [MANA_W, MANA_W], drops: 1 });
    expect(dropShortMask(cost('{W}{U}'), one)).toBe(MANA_U);
    const shared = supply({ flex: [MANA_W | MANA_U, MANA_R], drops: 1 });
    expect(dropShortMask(cost('{W}{U}'), shared)).toBe(MANA_W | MANA_U);
    expect(dropShortMask(cost('{R}'), shared)).toBe(0);
  });
});

describe('allocate', () => {
  const unit = (mask: number, spend: 0 | 1 | 2 = 0): PoolUnit => ({ mask, spend, source: -1 });

  it('returns null when the cost cannot be paid', () => {
    expect(allocate(cost('{2}{W}'), [unit(MANA_W), unit(MANA_U)])).toBeNull();
    expect(allocate(cost('{W}{W}'), [unit(MANA_W), unit(MANA_U)])).toBeNull();
    expect(allocate(cost('{1}{W}'), [unit(MANA_W)])).toBeNull();
  });

  it('matches pips through an augmenting path', () => {
    // {W}{U} off an Azorius and an Orzhov dual: W first grabs the Azorius
    // dual, so U has to move W over to the Orzhov one.
    const used = allocate(cost('{W}{U}'), [unit(MANA_W | MANA_U), unit(MANA_W | MANA_B)]);
    expect(used?.sort()).toEqual([0, 1]);
  });

  it('spends lands before Treasures and plain mana before flexible mana', () => {
    const pool = [unit(ANY_COLOR, 1), unit(MANA_W | MANA_U), unit(MANA_C), unit(MANA_G)];
    // {1}{G}: the Forest pays G, the colorless unit pays the 1; the dual and the Treasure stay.
    expect(allocate(cost('{1}{G}'), pool)?.sort()).toEqual([2, 3]);
  });

  it('pays {0} with nothing', () => {
    expect(allocate(cost('{0}'), [])).toEqual([]);
  });

  it('handles a pool bigger than its scratch buffers, then a small one again', () => {
    const big = Array.from({ length: 100 }, () => unit(MANA_G));
    expect(allocate(cost('{2}{G}{G}'), big)).toHaveLength(4);
    expect(allocate(cost('{U}'), [unit(MANA_G), unit(MANA_U)])).toEqual([1]);
  });
});
