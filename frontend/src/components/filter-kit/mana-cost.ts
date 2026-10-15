/** The symbols the pad adds: the five colors, colorless, X, Phyrexian and snow. */
export type PadSymbol = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'X' | 'P' | 'S';

export const PAD_SYMBOLS: readonly PadSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C', 'X', 'P', 'S'];

/**
 * The pad's value. Kept local to the kit: the engine's planned `manaCost`
 * field mirrors it, and the wave-2 agent that wires the surface aligns this
 * type with the engine's (rename or re-export, not a second shape).
 *
 * - `counts`: how many of each symbol the cost must have. Absent or 0 means
 *   no requirement.
 * - `mode`: `atLeast` is "has these and may have more"; `exact` is "exactly
 *   these colored symbols, plus any generic".
 * - the flags are the shortcut chips.
 */
export interface ManaCostFilter {
  counts: Partial<Record<PadSymbol, number>>;
  mode: 'atLeast' | 'exact';
  hasX?: boolean;
  hybrid?: boolean;
  phyrexian?: boolean;
  noColored?: boolean;
  noCost?: boolean;
}

export const EMPTY_MANA_COST: ManaCostFilter = { counts: {}, mode: 'atLeast' };

export const NAMES: Record<PadSymbol, string> = {
  W: 'white mana',
  U: 'blue mana',
  B: 'black mana',
  R: 'red mana',
  G: 'green mana',
  C: 'colorless mana',
  X: 'X',
  P: 'Phyrexian mana',
  S: 'snow mana',
};

export const FLAGS: Array<{
  key: 'hasX' | 'hybrid' | 'phyrexian' | 'noColored' | 'noCost';
  label: string;
  phrase: string;
}> = [
  { key: 'hasX', label: 'Has X', phrase: 'have X in the cost' },
  { key: 'hybrid', label: 'Hybrid', phrase: 'have a hybrid symbol' },
  { key: 'phyrexian', label: 'Phyrexian', phrase: 'have a Phyrexian symbol' },
  { key: 'noColored', label: 'No colored symbols', phrase: 'have no colored symbols' },
  { key: 'noCost', label: 'No mana cost', phrase: 'have no mana cost' },
];

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const joinAnd = (parts: string[]) =>
  parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

export const countOf = (v: ManaCostFilter, s: PadSymbol) => v.counts[s] ?? 0;

/** How many things are set: each symbol added, plus each shortcut on. */
export function manaCostCount(v: ManaCostFilter): number {
  return PAD_SYMBOLS.reduce((n, s) => n + countOf(v, s), 0) + FLAGS.filter((f) => v[f.key]).length;
}

/** The sentence under the pad: "Costs with at least two black symbols, plus anything else." */
export function manaCostSummary(v: ManaCostFilter): string {
  const parts = PAD_SYMBOLS.filter((s) => countOf(v, s) > 0).map((s) => {
    const n = countOf(v, s);
    const word = WORDS[n] || String(n);
    return s === 'X' ? `${word} X` : `${word} ${NAMES[s]} ${n > 1 ? 'symbols' : 'symbol'}`;
  });
  const phrases = FLAGS.filter((f) => v[f.key]).map((f) => f.phrase);
  const sentences: string[] = [];
  if (parts.length) {
    sentences.push(
      v.mode === 'atLeast'
        ? `Costs with at least ${joinAnd(parts)}, plus anything else.`
        : `Costs with exactly ${joinAnd(parts)} as colored symbols, plus any generic.`
    );
  }
  if (phrases.length) sentences.push(`Cards that ${joinAnd(phrases)}.`);
  return sentences.length ? sentences.join(' ') : 'Any mana cost.';
}
