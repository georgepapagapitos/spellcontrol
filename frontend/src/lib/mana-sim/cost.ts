/**
 * Mana costs and paying them.
 *
 * A mana supply is a multiset of units, one per mana: a Plains is one `W` unit,
 * a Hallowed Fountain one `W | U` unit, a Sol Ring two `C` units. Paying a cost
 * is a bipartite matching of pips to units that can make them, plus enough
 * units left for the generic part. Hall's theorem makes the matching check
 * exact and cheap: for every union `S` of the cost's pip masks, the pips that
 * only `S` can pay must not outnumber the units that make some mana in `S`.
 * With at most six mana types the unions are few, and the per-state counts
 * come from one subset-sum transform over the 64 masks.
 */

import { MANA_C, MANA_SYMBOLS, type CostCheck, type ManaCost, type ManaMask } from './types';

const SYMBOL_BIT: Record<string, ManaMask> = { W: 1, U: 2, B: 4, R: 8, G: 16, C: 32 };

/** Mask of a list of mana letters (`['W', 'U']` → W | U). Unknown letters are ignored. */
export function maskOf(symbols: readonly string[]): ManaMask {
  let m = 0;
  for (const s of symbols) m |= SYMBOL_BIT[s.toUpperCase()] ?? 0;
  return m;
}

/** Number of mana types in a mask. */
export function popcount(m: ManaMask): number {
  let n = 0;
  for (let x = m; x; x &= x - 1) n++;
  return n;
}

/** Letters of a mask, in WUBRGC order. */
export function symbolsOf(m: ManaMask): string[] {
  return MANA_SYMBOLS.filter((_, i) => m & (1 << i));
}

/**
 * Parse a printed mana cost. Returns null for an absent or empty cost (a land,
 * or Ancestral Vision), which cannot be cast for mana.
 *
 * - Numbers and snow {S} are generic.
 * - {X}/{Y}/{Z} are 0, as in mana value.
 * - Hybrid {W/U} is one pip payable by either; {2/W} is one {W} pip (its
 *   two-generic alternative is ignored) and counts 2 toward mana value.
 * - Phyrexian pips are paid with life in a goldfish: mana value only.
 */
export function parseManaCost(text: string | undefined | null): ManaCost | null {
  if (!text) return null;
  let generic = 0;
  let mv = 0;
  const pips: ManaMask[] = [];
  for (const [, raw] of text.matchAll(/\{([^}]+)\}/g)) {
    const sym = raw.toUpperCase();
    if (/^\d+$/.test(sym)) {
      generic += Number(sym);
      mv += Number(sym);
    } else if (sym === 'X' || sym === 'Y' || sym === 'Z') {
      continue;
    } else if (sym === 'S') {
      // {S} paid as generic; snow sources aren't tracked. Add a snow
      // bit to ManaMask if a snow deck's castability ever matters.
      generic += 1;
      mv += 1;
    } else if (sym.includes('/')) {
      const parts = sym.split('/');
      if (parts.includes('P')) {
        mv += 1;
      } else if (/^\d+$/.test(parts[0])) {
        pips.push(maskOf(parts.slice(1)));
        mv += Number(parts[0]);
      } else {
        pips.push(maskOf(parts));
        mv += 1;
      }
    } else if (SYMBOL_BIT[sym] !== undefined) {
      pips.push(SYMBOL_BIT[sym]);
      mv += 1;
    }
  }
  pips.sort((a, b) => popcount(a) - popcount(b) || a - b);
  return {
    text,
    mv,
    generic,
    pips,
    units: generic + pips.length,
    checks: hallChecks(pips),
    key: `${generic}|${pips.join(',')}`,
  };
}

/** Every union of the distinct pip masks, with how many pips it alone can pay. */
function hallChecks(pips: readonly ManaMask[]): CostCheck[] {
  const distinct = [...new Set(pips)];
  const byUnion = new Map<ManaMask, number>();
  for (let sub = 1; sub < 1 << distinct.length; sub++) {
    let union = 0;
    for (let i = 0; i < distinct.length; i++) if (sub & (1 << i)) union |= distinct[i];
    if (byUnion.has(union)) continue;
    byUnion.set(union, pips.filter((p) => (p & ~union) === 0).length);
  }
  return [...byUnion].map(([mask, need]) => ({ mask, need }));
}

const countAble = (units: readonly ManaMask[], mask: ManaMask): number => {
  let n = 0;
  for (let i = 0; i < units.length; i++) if (units[i] & mask) n++;
  return n;
};

/**
 * Can `units` (plus the `extra` units) pay `cost`? Exact. Counting per check
 * beats any precomputed table here: a turn's pool is a handful of units and a
 * cost has one to three checks.
 */
export function canPay(
  cost: ManaCost,
  units: readonly ManaMask[],
  extra: readonly ManaMask[] = []
): boolean {
  if (units.length + extra.length < cost.units) return false;
  for (const c of cost.checks) {
    if (countAble(units, c.mask) + countAble(extra, c.mask) < c.need) return false;
  }
  return true;
}

/**
 * The mana a turn COULD have had for one card, with the land drops re-chosen
 * for it (Karsten's question: were the right lands drawn?). Lands are split
 * by when they could have been played:
 *
 * - `early`: lands that can only have been an earlier drop (they enter tapped
 *   now: a tapland in hand, one already played). At most `drops` of them.
 * - `flex`: lands that could have been an earlier drop or today's (untapped
 *   now, drawn before this turn).
 * - `today`: lands drawn this turn that enter untapped: only today's drop. At
 *   most 1.
 * - `fixed`: mana that is there regardless (rocks, dorks, Treasures, lands a
 *   ramp spell put in).
 *
 * Every chosen land set must also fit `drops + 1` land drops. Each land is one
 * unit here, so the caps form a laminar family and the choosable lands a
 * laminar matroid; Rado's theorem then makes the Hall check exact with each
 * group's count capped: able(S) = fixed(S) + min(drops + 1,
 * min(drops, early(S)) + min(1, today(S)) + flex(S)).
 */
export interface DropSupply {
  fixed: ManaMask[];
  early: ManaMask[];
  flex: ManaMask[];
  today: ManaMask[];
  drops: number;
  /** Optional per-mask memo of `able` (-1 = unset); reset it whenever the groups change. */
  memo?: Int32Array;
}

function dropAble(s: DropSupply, mask: ManaMask): number {
  if (s.memo && s.memo[mask] >= 0) return s.memo[mask];
  const lands =
    Math.min(s.drops, countAble(s.early, mask)) +
    Math.min(1, countAble(s.today, mask)) +
    countAble(s.flex, mask);
  const able = countAble(s.fixed, mask) + Math.min(s.drops + 1, lands);
  if (s.memo) s.memo[mask] = able;
  return able;
}

/** Total mana the re-chosen drops could give (the "enough mana" test). */
export function dropTotal(s: DropSupply): number {
  const lands = Math.min(s.drops, s.early.length) + Math.min(1, s.today.length) + s.flex.length;
  return s.fixed.length + Math.min(s.drops + 1, lands);
}

/** Can some choice of land drops pay `cost`? Exact under the model above. */
export function canPayWithDrops(cost: ManaCost, s: DropSupply): boolean {
  if (dropTotal(s) < cost.units) return false;
  for (const c of cost.checks) if (dropAble(s, c.mask) < c.need) return false;
  return true;
}

/**
 * Which mana types were short when the amount was there but the cost still
 * could not be paid: the smallest violated union, so a single missing color
 * is blamed alone and a shared shortfall (a {W}{U} cost off one W/U dual)
 * blames both. 0 when payable.
 */
export function dropShortMask(cost: ManaCost, s: DropSupply): ManaMask {
  let best = 0;
  let bestSize = 7;
  for (const c of cost.checks) {
    if (dropAble(s, c.mask) >= c.need) continue;
    const size = popcount(c.mask);
    if (size < bestSize) {
      best = c.mask;
      bestSize = size;
    }
  }
  return best;
}

/** A unit in a turn's mana pool. `spend` > 0 marks a one-shot unit (Treasure, Mana Vault). */
export interface PoolUnit {
  mask: ManaMask;
  /** 0 persistent (a land, an untapping rock); 1 Treasure; 2 one-shot source. */
  spend: 0 | 1 | 2;
  /** For a one-shot source, which source it belongs to. */
  source: number;
}

let ownerBuf = new Int32Array(64);
let seenBuf = new Int32Array(64);

/** Cheaper-to-spend first: persistent before one-shot, then fewer mana types. */
function unitRank(u: PoolUnit): number {
  return u.spend * 8 + popcount(u.mask) + (u.mask & MANA_C ? 0 : 1);
}

/**
 * Choose the pool units that pay `cost`, or null when it can't be paid. Pips
 * are matched most-constrained first by augmenting paths (Kuhn), preferring
 * the units that are cheapest to give up; generic takes what is left, cheapest
 * first. Returns indices into `pool`.
 */
export function allocate(cost: ManaCost, pool: readonly PoolUnit[]): number[] | null {
  const n = pool.length;
  if (n < cost.units) return null;
  // Insertion sort by rank: pools are a handful of units.
  const order: number[] = [];
  const rank: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = unitRank(pool[i]);
    let j = order.length;
    while (j > 0 && rank[j - 1] > r) {
      order[j] = order[j - 1];
      rank[j] = rank[j - 1];
      j--;
    }
    order[j] = i;
    rank[j] = r;
  }
  // Scratch buffers reused across calls: allocate is synchronous and never re-entered.
  if (ownerBuf.length < n) {
    ownerBuf = new Int32Array(n * 2);
    seenBuf = new Int32Array(n * 2);
  }
  const owner = ownerBuf;
  const seen = seenBuf;
  owner.fill(-1, 0, n);
  seen.fill(0, 0, n);
  let stamp = 0;
  const pips = cost.pips;

  const tryPip = (p: number): boolean => {
    for (const u of order) {
      if (seen[u] === stamp || !(pool[u].mask & pips[p])) continue;
      seen[u] = stamp;
      if (owner[u] < 0 || tryPip(owner[u])) {
        owner[u] = p;
        return true;
      }
    }
    return false;
  };

  for (let p = 0; p < pips.length; p++) {
    stamp++;
    if (!tryPip(p)) return null;
  }
  const used: number[] = [];
  for (let u = 0; u < n; u++) if (owner[u] >= 0) used.push(u);
  let generic = cost.generic;
  for (const u of order) {
    if (generic === 0) break;
    if (owner[u] >= 0) continue;
    used.push(u);
    generic--;
  }
  return generic === 0 ? used : null;
}
