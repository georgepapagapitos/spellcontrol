import type { ComboMatch } from '../types/combos';

/**
 * Search + filter for the collection combos view. Pure and synchronous — the
 * whole list is already in memory (the matcher returns it in one shot), so
 * filtering never touches the network.
 */

export type ComboResultKind = 'mana' | 'damage' | 'draw' | 'tokens' | 'life' | 'win';

export type ComboPieceCount = '2' | '3' | '4+';

export interface ComboFilterState {
  /** WUBRG + 'C'. Empty = no constraint. See `fitsColors` for the semantics. */
  colors: Set<string>;
  /** Empty = no constraint. A combo matches if ANY of its results is selected. */
  results: Set<ComboResultKind>;
  /** Empty = no constraint. */
  pieceCounts: Set<ComboPieceCount>;
  /** Only combos at least one owned commander could legally host. */
  hostOnly: boolean;
}

/** Human labels for the result buckets — shared by the popover and its chips. */
export const COMBO_RESULT_LABELS: Record<ComboResultKind, string> = {
  win: 'Wins the game',
  mana: 'Mana',
  damage: 'Damage',
  draw: 'Draw',
  tokens: 'Tokens',
  life: 'Life',
};

export function emptyComboFilters(): ComboFilterState {
  return { colors: new Set(), results: new Set(), pieceCounts: new Set(), hostOnly: false };
}

export function countActiveFilters(f: ComboFilterState): number {
  return f.colors.size + f.results.size + f.pieceCounts.size + (f.hostOnly ? 1 : 0);
}

/**
 * Keyword buckets over Spellbook's freeform `produces[]` strings ("Infinite
 * colorless mana", "Near-infinite damage to each opponent", …).
 *
 * ⚠️ This is a HEURISTIC, not a taxonomy — the source strings are prose written
 * per-combo, so a bucket can miss an unusual phrasing. It's used only to filter
 * a list the user can also clear, never to make a claim about a combo, so a
 * miss costs a hidden row rather than a wrong statement. Order matters: `win`
 * is checked first so an explicit game-winning line isn't filed as mere damage.
 */
const RESULT_PATTERNS: Array<[ComboResultKind, RegExp]> = [
  ['win', /\b(win|wins|winning|lose|loses|losing) the game\b/i],
  ['mana', /\bmana\b/i],
  ['damage', /\bdamage\b/i],
  ['draw', /\bdraw|\bcards? in hand\b|\bcard draw\b/i],
  ['tokens', /\btokens?\b/i],
  ['life', /\blife\b|\blifeloss\b|\blife gain\b/i],
];

/** Every result bucket a combo's `produces` strings fall into (possibly none). */
export function comboResultKinds(produces: readonly string[]): Set<ComboResultKind> {
  const kinds = new Set<ComboResultKind>();
  for (const p of produces) {
    for (const [kind, re] of RESULT_PATTERNS) {
      if (re.test(p)) kinds.add(kind);
    }
  }
  return kinds;
}

/** '2' | '3' | '4+' for a combo of `n` pieces. */
export function pieceCountBucket(n: number): ComboPieceCount {
  if (n <= 2) return '2';
  if (n === 3) return '3';
  return '4+';
}

/**
 * Colour semantics: selecting {U, B} means "combos I could run in a UB deck" —
 * i.e. the combo's identity must FIT INSIDE the selection, not merely overlap
 * it. Same subset rule `useDeckCombos.filterByIdentity` applies against a
 * commander, which is what makes the filter useful for "what can I build".
 *
 * Spellbook identities are lowercase WUBRG, or 'c' for colorless. Colorless
 * fits in any selection, so a combo with identity 'c' (or '') always passes
 * once any colour is chosen.
 */
function fitsColors(identity: string, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  const letters = [...identity.toUpperCase()].filter((ch) => ch !== 'C');
  // Colorless combos: only shown when 'C' is among the selection, so that
  // picking just 'C' is a meaningful "colorless only" filter.
  if (letters.length === 0) return selected.has('C');
  return letters.every((ch) => selected.has(ch));
}

/** Case-insensitive match over the combo's card names and its result text. */
function matchesSearch(m: ComboMatch, needle: string): boolean {
  if (!needle) return true;
  for (const c of m.combo.cards) {
    if (c.cardName.toLowerCase().includes(needle)) return true;
  }
  for (const p of m.combo.produces) {
    if (p.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export interface FilterOptions {
  /** Raw search text; trimmed + lowercased here so callers don't have to. */
  search?: string;
  /**
   * True when at least one owned commander could host this combo. Required
   * when `hostOnly` is set; without it the host filter is a no-op rather than
   * silently emptying the list.
   */
  canHost?: (m: ComboMatch) => boolean;
}

export function filterCombos(
  matches: readonly ComboMatch[],
  f: ComboFilterState,
  opts: FilterOptions = {}
): ComboMatch[] {
  const needle = (opts.search ?? '').trim().toLowerCase();

  return matches.filter((m) => {
    if (!matchesSearch(m, needle)) return false;
    if (!fitsColors(m.combo.identity, f.colors)) return false;

    if (f.pieceCounts.size > 0 && !f.pieceCounts.has(pieceCountBucket(m.combo.cards.length))) {
      return false;
    }

    if (f.results.size > 0) {
      const kinds = comboResultKinds(m.combo.produces);
      let hit = false;
      for (const k of f.results) {
        if (kinds.has(k)) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }

    if (f.hostOnly && opts.canHost && !opts.canHost(m)) return false;

    return true;
  });
}
