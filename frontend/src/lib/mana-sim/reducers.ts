/**
 * Cost reducers: a permanent that makes some of your spells cheaper (Ruby
 * Medallion, Etherium Sculptor, Goblin Warchief). Read from Oracle text once per
 * card; a goal run applies the ones it has cast (`createReducers`).
 *
 * Only the generic part of a cost shrinks, so a reduced cost keeps its pips and
 * its Hall checks: `{...cost, generic - n, units - n}`. Castability numbers never
 * see reducers (the simulator's castability asks what the lands can pay for the
 * printed cost); only the goal run, which casts permanents in order, does.
 *
 * Not read, on purpose: a type chosen on entry (Herald's Horn, Urza's Incubator,
 * Morophon), an amount that depends on the board (Temur Battlecrier, Earthquake
 * Dragon), self-cost (Blasphemous Act, affinity), graveyard and exile casts, and
 * reducers of abilities rather than spells (Training Grounds, channel lands).
 */

import { maskOf } from './cost';
import type { ManaCard, ManaCost, ManaMask } from './types';

/** Card types as bits, for a spell's front face. */
export const KIND_BITS = {
  artifact: 1,
  creature: 2,
  enchantment: 4,
  instant: 8,
  sorcery: 16,
  planeswalker: 32,
  battle: 64,
} as const;

/** The card-type bitmask of a type line (the part before the dash). */
export function kindsOf(typeLine: string): number {
  const types = typeLine.toLowerCase().split('—')[0];
  let m = 0;
  for (const [name, bit] of Object.entries(KIND_BITS))
    if (new RegExp(`\\b${name}\\b`).test(types)) m |= bit;
  return m;
}

/** Subtypes of a type line, lowercased ("Legendary Creature — Goblin Shaman" → goblin, shaman). */
export function subtypesOf(typeLine: string): string[] {
  const rest = typeLine.split('//')[0].split('—')[1];
  return rest ? rest.toLowerCase().split(/\s+/).filter(Boolean) : [];
}

/** One group of spells a reducer applies to; a spell qualifies when it meets every set field. */
export interface SpellFilter {
  /** Spell has at least one of these colors (0 = any). */
  colors: ManaMask;
  /** Spell has at least one of these types (0 = any). */
  kinds: number;
  /** Spell has none of these types. */
  notKinds: number;
  /** Spell has this subtype ("goblin"). */
  tribe: string | null;
}

/** "Spells you cast cost {n} less": applies when any filter matches. */
export interface CostReducer {
  n: number;
  filters: readonly SpellFilter[];
}

const COLOR_WORDS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};
/** Words that look like a creature type in a filter but are not one. */
const NOT_A_TRIBE = new Set([
  'historic',
  'legendary',
  'multicolored',
  'monocolored',
  'colorless',
  'snow',
  'basic',
  'nonbasic',
  'face-down',
  'noncreature',
  'nonland',
  'permanent',
  'other',
  'your',
  'those',
  'chosen',
  'x',
]);

/** One "red creature" / "dragon" / "noncreature" phrase; null when any word is not understood. */
function filterOf(phrase: string): SpellFilter | null {
  const f: SpellFilter = { colors: 0, kinds: 0, notKinds: 0, tribe: null };
  const words = phrase.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return null;
  for (const w of words) {
    if (COLOR_WORDS[w]) f.colors |= maskOf([COLOR_WORDS[w]]);
    else if (w === 'noncreature') f.notKinds |= KIND_BITS.creature;
    else if (w in KIND_BITS) f.kinds |= KIND_BITS[w as keyof typeof KIND_BITS];
    else if (/^[a-z]+$/.test(w) && !NOT_A_TRIBE.has(w) && words.length === 1) f.tribe = w;
    else return null;
  }
  // Two words must be a color then a type ("red creature"), not two colors or two types.
  if (words.length === 2 && !(f.colors && (f.kinds || f.notKinds))) return null;
  return f;
}

/**
 * The reducers in a card's Oracle text, from permanents only. A line is read
 * only in the plain form "<spells> you cast cost {N} less to cast."
 */
export function parseReducers(text: string, typeLine: string): CostReducer[] {
  if (!/\b(artifact|creature|enchantment)\b/i.test(typeLine.split('—')[0])) return [];
  const out: CostReducer[] = [];
  for (const raw of text.split('\n')) {
    const m = raw
      .trim()
      .toLowerCase()
      .replace(/’/g, "'")
      .match(/^(?:(.+?) )?spells you cast cost \{(\d)\} less to cast\.?$/);
    if (!m) continue;
    const phrases = m[1] ? m[1].split(/,\s*(?:and\s+)?|\s+and\s+/) : [];
    const filters = phrases.map(filterOf);
    if (filters.some((f) => f === null)) continue;
    out.push({ n: Number(m[2]), filters: filters as SpellFilter[] });
  }
  return out;
}

/** Does the reducer apply to this spell? A land is never a spell. */
export function appliesTo(r: CostReducer, c: ManaCard): boolean {
  if (c.landCard || !c.cost) return false;
  if (r.filters.length === 0) return true;
  return r.filters.some(
    (f) =>
      (!f.colors || (c.colors & f.colors) !== 0) &&
      (!f.kinds || (c.kinds & f.kinds) !== 0) &&
      (c.kinds & f.notKinds) === 0 &&
      (!f.tribe || c.tribes.includes(f.tribe) || c.tribes.includes('*'))
  );
}

const reducedCache = new WeakMap<ManaCost, ManaCost[]>();

/** `cost` with `n` generic taken off (never below 0, never touching a pip). */
export function reducedCost(cost: ManaCost, n: number): ManaCost {
  const g = Math.min(n, cost.generic);
  if (g <= 0) return cost;
  let byG = reducedCache.get(cost);
  if (!byG) reducedCache.set(cost, (byG = []));
  return (byG[g] ??= {
    ...cost,
    generic: cost.generic - g,
    units: cost.units - g,
    key: `${cost.generic - g}|${cost.pips.join(',')}`,
  });
}

export interface Reducers {
  /** A new game: none cast. */
  reset(): void;
  /** The card at `id` was cast: its reducers are live. */
  cast(id: number): void;
  /** What casting `id` costs now. */
  costOf(id: number): ManaCost | null;
  /** Would casting reducer `id` make any of `ids` cheaper than it is now? */
  helps(id: number, ids: readonly number[]): boolean;
  isReducer(id: number): boolean;
}

/** Null when no card in the deck reduces costs: the printed costs are the costs. */
export function createReducers(cards: readonly ManaCard[]): Reducers | null {
  if (!cards.some((c) => c.reducers.length > 0)) return null;
  /** Generic taken off each card now. */
  const off = new Int8Array(cards.length);
  const live: CostReducer[] = [];
  const total = (id: number, extra: readonly CostReducer[]): number => {
    let n = 0;
    for (const r of live) if (appliesTo(r, cards[id])) n += r.n;
    for (const r of extra) if (appliesTo(r, cards[id])) n += r.n;
    return n;
  };
  return {
    reset() {
      live.length = 0;
      off.fill(0);
    },
    cast(id) {
      if (cards[id].reducers.length === 0) return;
      live.push(...cards[id].reducers);
      for (let i = 0; i < cards.length; i++) off[i] = total(i, []);
    },
    costOf: (id) => {
      const cost = cards[id].cost;
      return cost && off[id] > 0 ? reducedCost(cost, off[id]) : cost;
    },
    helps(id, ids) {
      for (const other of ids) {
        const cost = cards[other].cost;
        if (!cost || other === id) continue;
        const now = Math.min(off[other], cost.generic);
        if (Math.min(total(other, cards[id].reducers), cost.generic) > now) return true;
      }
      return false;
    },
    isReducer: (id) => cards[id].reducers.length > 0,
  };
}
