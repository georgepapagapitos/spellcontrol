/**
 * Printed mana-cost symbol queries: the engine behind `BinderFilter.manaSymbols`
 * ("cost has at least {B}{B}", "exactly one white pip", "no colored symbols").
 *
 * This is about the SYMBOLS printed on the card, not its mana value
 * (`cmcMin`/`cmcMax`/`manaValues`) and not its colors (`colorIdentity`).
 *
 * Card data carries `manaCost` as Scryfall's `mana_cost` string, e.g.
 * "{3}{B}{B}". Multi-face cards without a top-level cost carry the faces
 * joined by " // " ("{1}{R} // {2}{U}"; an empty face stays empty).
 * A multi-face card matches a count query when ANY face satisfies it, because
 * either face can be cast; `noCost` needs every face to be costless.
 */

/** The symbol keys a query can count: the five colors, colorless {C}, {X}, Phyrexian, snow. */
export type ManaSymbolKey = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'X' | 'P' | 'S';

export const MANA_SYMBOL_KEYS: readonly ManaSymbolKey[] = [
  'W',
  'U',
  'B',
  'R',
  'G',
  'C',
  'X',
  'P',
  'S',
];

const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * - `atLeast`: the cost contains at least these symbol counts. Extra symbols
 *   and generic mana are fine.
 * - `exactColored`: the W/U/B/R/G counts equal these (a color not listed must
 *   be absent; generic mana is free). C, X, P and S are checked exactly only
 *   when listed, otherwise ignored.
 */
export type ManaSymbolMode = 'atLeast' | 'exactColored';

/**
 * Counting rules (both modes):
 * - A hybrid symbol like {W/U} counts once toward EACH of its colors
 *   (Kitchen Finks {1}{G/W}{G/W} is G2 and W2). A twobrid {2/W} counts as W.
 * - A Phyrexian symbol {W/P} counts toward W and toward P.
 * - `hybrid: false` stops hybrid/twobrid symbols counting toward colors
 *   (only single-color pips count); Phyrexian symbols still count.
 *
 * `counts` AND together and form one alternative. `noColored` and `noCost` are
 * further alternatives, and the query matches when ANY active alternative does
 * (they can't be AND-ed: "no cost" contradicts any count). An empty `counts`
 * adds no alternative, so a query of only `noCost` matches costless cards and
 * nothing else; no counts and no flags is no constraint.
 */
export interface ManaSymbolQuery {
  counts: Partial<Record<ManaSymbolKey, number>>;
  mode: ManaSymbolMode;
  /** Default true. See the counting rules above. */
  hybrid?: boolean;
  /** Also match a cost with no colored symbol ({3}, {X}, {C}{C}). A card with no cost does not match this. */
  noColored?: boolean;
  /** Also match a card with no mana cost at all (lands, Ancestral Vision). */
  noCost?: boolean;
}

interface ParsedSymbol {
  colors: ManaSymbolKey[];
  hybrid: boolean;
  phyrexian: boolean;
  /** Counts toward the X/C/S keys directly. */
  special?: ManaSymbolKey;
}

function isColor(p: string): boolean {
  return (COLOR_KEYS as readonly string[]).includes(p);
}

function parseSymbol(raw: string): ParsedSymbol | null {
  const parts = raw.toUpperCase().split('/');
  if (parts.length === 1) {
    const p = parts[0];
    if (p === 'X' || p === 'C' || p === 'S') {
      return { colors: [], hybrid: false, phyrexian: false, special: p };
    }
    if (isColor(p)) return { colors: [p as ManaSymbolKey], hybrid: false, phyrexian: false };
    return null; // generic {2}, {0}, {Y}, {Z}… carry no queryable symbol
  }
  const phyrexian = parts.includes('P');
  const colors = parts.filter((p) => isColor(p) || p === 'C') as ManaSymbolKey[];
  if (colors.length === 0 && !phyrexian) return null;
  const twobrid = /^\d+$/.test(parts[0]);
  return { colors, hybrid: colors.length > 1 || twobrid, phyrexian };
}

interface FaceTally {
  counts: Record<ManaSymbolKey, number>;
  /** Same tally with hybrid/twobrid symbols left out of the color keys. */
  strict: Record<ManaSymbolKey, number>;
}

function emptyCounts(): Record<ManaSymbolKey, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, X: 0, P: 0, S: 0 };
}

function tallyFace(face: string): FaceTally {
  const counts = emptyCounts();
  const strict = emptyCounts();
  for (const m of face.matchAll(/\{([^}]+)\}/g)) {
    const s = parseSymbol(m[1]);
    if (!s) continue;
    if (s.special) {
      counts[s.special]++;
      strict[s.special]++;
    }
    for (const c of s.colors) {
      counts[c]++;
      if (!s.hybrid) strict[c]++;
    }
    if (s.phyrexian) {
      counts.P++;
      strict.P++;
    }
  }
  return { counts, strict };
}

/** Split a card's `manaCost` into its faces ("{1}{R} // {2}{U}"), trimmed; empty faces kept. */
export function manaCostFaces(manaCost: string | undefined): string[] {
  return (manaCost ?? '').split('//').map((f) => f.trim());
}

/** Hot-path form of a ManaSymbolQuery: only the meaningful counts, so the per-card matcher does no filtering. */
export interface CompiledManaSymbols {
  entries: [ManaSymbolKey, number][];
  mode: ManaSymbolMode;
  hybrid: boolean;
  noColored: boolean;
  noCost: boolean;
}

/** Returns undefined when the query constrains nothing. */
export function compileManaSymbols(
  q: ManaSymbolQuery | undefined
): CompiledManaSymbols | undefined {
  if (!q) return undefined;
  const entries: [ManaSymbolKey, number][] = [];
  for (const k of MANA_SYMBOL_KEYS) {
    const n = q.counts?.[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    // A listed 0 is meaningful in exact mode ("no red"); in atLeast it is a no-op.
    if (n > 0 || (q.mode === 'exactColored' && n === 0)) {
      entries.push([k, Math.max(0, Math.floor(n))]);
    }
  }
  if (entries.length === 0 && !q.noColored && !q.noCost) return undefined;
  return {
    entries,
    mode: q.mode,
    hybrid: q.hybrid !== false,
    noColored: !!q.noColored,
    noCost: !!q.noCost,
  };
}

/**
 * The persistable form of a query: zero counts dropped (except exact-mode
 * zeros), non-finite counts dropped, flags only when true, `hybrid` only when
 * false (true is the default). Undefined when the query constrains nothing.
 * Use it before saving so an inactive draft never lands in a binder rule.
 */
export function normalizeManaSymbolQuery(
  q: ManaSymbolQuery | undefined
): ManaSymbolQuery | undefined {
  const c = compileManaSymbols(q);
  if (!c || !q) return undefined;
  return {
    counts: Object.fromEntries(c.entries) as ManaSymbolQuery['counts'],
    mode: q.mode,
    ...(q.hybrid === false ? { hybrid: false } : {}),
    ...(c.noColored ? { noColored: true } : {}),
    ...(c.noCost ? { noCost: true } : {}),
  };
}

/** True when the query constrains anything. */
export function manaSymbolQueryIsActive(q: ManaSymbolQuery | undefined): boolean {
  return compileManaSymbols(q) !== undefined;
}

function countsMatch(c: CompiledManaSymbols, face: FaceTally): boolean {
  const have = c.hybrid ? face.counts : face.strict;
  if (c.mode === 'atLeast') return c.entries.every(([k, n]) => have[k] >= n);
  const listed = new Map(c.entries);
  for (const k of COLOR_KEYS) if (have[k] !== (listed.get(k) ?? 0)) return false;
  for (const k of ['C', 'X', 'P', 'S'] as const) {
    const n = listed.get(k);
    if (n !== undefined && have[k] !== n) return false;
  }
  return true;
}

/** Does a card with this printed `manaCost` satisfy the compiled query? */
export function manaCostMatches(manaCost: string | undefined, c: CompiledManaSymbols): boolean {
  const faces = manaCostFaces(manaCost).filter((f) => f.length > 0);
  if (faces.length === 0) return c.noCost;
  const tallies = faces.map(tallyFace);
  if (c.entries.length > 0 && tallies.some((t) => countsMatch(c, t))) return true;
  // Colored = any WUBRG symbol, hybrid and Phyrexian included.
  return c.noColored && tallies.some((t) => COLOR_KEYS.every((k) => t.counts[k] === 0));
}
