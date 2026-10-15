import {
  MANA_SYMBOL_KEYS,
  type ManaSymbolKey,
  type ManaSymbolQuery,
} from '@spellcontrol/binder-routing';

/** The symbols the pad adds: the five colors, colorless, X, Phyrexian and snow. */
export type PadSymbol = ManaSymbolKey;

export const PAD_SYMBOLS: readonly PadSymbol[] = MANA_SYMBOL_KEYS;

/**
 * The pad's value is the engine's `ManaSymbolQuery` (`BinderFilter.manaSymbols`),
 * so a surface stores it as is. The shortcut chips map onto it:
 * Has X is `counts.X`, Phyrexian is `counts.P`, No colored symbols is
 * `noColored`, No mana cost is `noCost`, and Count hybrid is the engine's
 * `hybrid` (on unless it is `false`). The mode "Exactly these colored" is
 * `exactColored`.
 */
export type ManaCostFilter = ManaSymbolQuery;

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

export type FlagKey = 'hasX' | 'hybrid' | 'phyrexian' | 'noColored' | 'noCost';

export const FLAGS: Array<{ key: FlagKey; label: string }> = [
  { key: 'hasX', label: 'Has X' },
  { key: 'hybrid', label: 'Count hybrid' },
  { key: 'phyrexian', label: 'Phyrexian' },
  { key: 'noColored', label: 'No colored symbols' },
  { key: 'noCost', label: 'No mana cost' },
];

/** Whether a shortcut chip reads as on. Count hybrid is on by default; the others are off. */
export function flagOn(v: ManaCostFilter, key: FlagKey): boolean {
  switch (key) {
    case 'hasX':
      return countOf(v, 'X') > 0;
    case 'phyrexian':
      return countOf(v, 'P') > 0;
    case 'hybrid':
      return v.hybrid !== false;
    default:
      return !!v[key];
  }
}

/** The query after tapping a shortcut chip. */
export function toggleFlag(v: ManaCostFilter, key: FlagKey): ManaCostFilter {
  const on = flagOn(v, key);
  if (key === 'hasX' || key === 'phyrexian') {
    const s: PadSymbol = key === 'hasX' ? 'X' : 'P';
    const counts = { ...v.counts };
    if (on) delete counts[s];
    else counts[s] = 1;
    return { ...v, counts };
  }
  if (key === 'hybrid') {
    const { hybrid: _drop, ...rest } = v;
    return on ? { ...rest, hybrid: false } : rest;
  }
  const next = { ...v };
  if (on) delete next[key];
  else next[key] = true;
  return next;
}

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const joinAnd = (parts: string[]) =>
  parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

export const countOf = (v: ManaCostFilter, s: PadSymbol) => v.counts[s] ?? 0;

/** How many things are set: each symbol added, plus each shortcut that differs from the default. */
export function manaCostCount(v: ManaCostFilter): number {
  return (
    PAD_SYMBOLS.reduce((n, s) => n + countOf(v, s), 0) +
    (v.noColored ? 1 : 0) +
    (v.noCost ? 1 : 0) +
    (v.hybrid === false ? 1 : 0)
  );
}

/** The sentence under the pad: "Costs with at least two black symbols, plus anything else." */
export function manaCostSummary(v: ManaCostFilter): string {
  const parts = PAD_SYMBOLS.filter((s) => countOf(v, s) > 0).map((s) => {
    const n = countOf(v, s);
    const word = WORDS[n] || String(n);
    return s === 'X' ? `${word} X` : `${word} ${NAMES[s]} ${n > 1 ? 'symbols' : 'symbol'}`;
  });
  const phrases = [
    v.noColored && 'have no colored symbols',
    v.noCost && 'have no mana cost',
  ].filter((p): p is string => !!p);
  const sentences: string[] = [];
  if (parts.length) {
    sentences.push(
      v.mode === 'atLeast'
        ? `Costs with at least ${joinAnd(parts)}, plus anything else.`
        : `Costs with exactly ${joinAnd(parts)} as colored symbols, plus any generic.`
    );
  }
  if (phrases.length) sentences.push(`Cards that ${joinAnd(phrases)}.`);
  if (v.hybrid === false) sentences.push("Hybrid symbols don't count.");
  return sentences.length ? sentences.join(' ') : 'Any mana cost.';
}
