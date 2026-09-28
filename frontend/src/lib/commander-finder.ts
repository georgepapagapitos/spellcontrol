/**
 * The commander finder's pure half: query building, color matching, match
 * reasons and ordering for `CommanderSearch`. No I/O, no React.
 *
 * One result list, three filters that combine (colors, playstyles, and
 * "In my collection"), plus a search box that reads plain words as a name,
 * type-line or rules-text search and passes Scryfall syntax through as typed.
 */
import { hasQuerySyntax } from './deck-add-search';
import { normalizeScryfallQuery } from './normalize-search';
import { playstyleById, playstyleScryfallClause } from './commander-playstyle-index';

export type ColorMode = 'exact' | 'within';
export type FinderSource = 'all' | 'owned';
export type FinderSort = 'match' | 'popular' | 'owned' | 'name' | 'mv';

const WUBRG = 'WUBRGC';

const COLOR_WORD: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

/** Sorted color key ("BG") → the combination's community name. */
const COLOR_COMBO: Record<string, string> = {
  W: 'Mono-white',
  U: 'Mono-blue',
  B: 'Mono-black',
  R: 'Mono-red',
  G: 'Mono-green',
  C: 'Colorless',
  WU: 'Azorius',
  WB: 'Orzhov',
  WR: 'Boros',
  WG: 'Selesnya',
  UB: 'Dimir',
  UR: 'Izzet',
  UG: 'Simic',
  BR: 'Rakdos',
  BG: 'Golgari',
  RG: 'Gruul',
  WUB: 'Esper',
  WUR: 'Jeskai',
  WUG: 'Bant',
  WBR: 'Mardu',
  WBG: 'Abzan',
  WRG: 'Naya',
  UBR: 'Grixis',
  UBG: 'Sultai',
  URG: 'Temur',
  BRG: 'Jund',
  WUBR: 'Yore-Tiller',
  WUBG: 'Witch-Maw',
  WURG: 'Ink-Treader',
  WBRG: 'Dune-Brood',
  UBRG: 'Glint-Eye',
  WUBRG: 'Five-color',
};

/** Colors in WUBRG order, colorless last. */
export function sortColors(colors: Iterable<string>): string[] {
  return [...colors].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
}

/** "Golgari", "Mono-black", "Five-color"; empty string for no colors. */
export function colorComboName(colors: Iterable<string>): string {
  const key = sortColors(colors).join('');
  return key ? (COLOR_COMBO[key] ?? '') : '';
}

/** "Black-green", "Black", "White-blue-black": the colors in words. */
function colorWords(colors: Iterable<string>): string {
  const words = sortColors(colors).map((c) => COLOR_WORD[c] ?? c);
  const joined = words.join('-');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Does a commander's color identity pass the color filter? An empty filter
 * passes everything. A colorless commander has identity `[]`, read as `C`.
 *  - `exact`: the identity is exactly the selection (Golgari = black-green only).
 *  - `within`: every color of the identity is selected, so a mono-black or a
 *    colorless commander also fits a Golgari deck.
 */
export function colorIdentityMatches(
  identity: readonly string[] | undefined,
  filter: ReadonlySet<string>,
  mode: ColorMode
): boolean {
  if (filter.size === 0) return true;
  const ident = identity && identity.length > 0 ? identity : ['C'];
  if (mode === 'within') {
    if (ident.length === 1 && ident[0] === 'C') return true;
    return ident.every((c) => filter.has(c));
  }
  return ident.length === filter.size && ident.every((c) => filter.has(c));
}

/**
 * The one-line hint beside the Exactly / Within switch. The switch alone
 * doesn't say what it does (STYLE_GUIDE § Color pip rows: the hint is
 * mandatory), so this spells out the current selection.
 */
export function colorModeHint(filter: ReadonlySet<string>, mode: ColorMode): string {
  if (filter.size === 0) return '';
  if (filter.has('C')) return 'Colorless commanders only';
  const words = colorWords(filter);
  if (mode === 'within') return `Anything you can play in ${words.toLowerCase()}`;
  return filter.size === 1
    ? `Mono-${words.toLowerCase()} commanders only`
    : `${words} commanders only`;
}

/** Scryfall's color-identity clause for the filter; empty for no colors. */
function colorClause(filter: ReadonlySet<string>, mode: ColorMode): string {
  if (filter.size === 0) return '';
  if (filter.has('C')) return 'id=c';
  const letters = sortColors(filter).join('').toLowerCase();
  return mode === 'within' ? `id<=${letters}` : `id=${letters}`;
}

export interface FinderQuery {
  text: string;
  colors: ReadonlySet<string>;
  colorMode: ColorMode;
  playstyleIds: readonly string[];
}

/** Is anything narrowing the list beyond colors? Decides browse vs search. */
export function isSearching(q: Pick<FinderQuery, 'text' | 'playstyleIds'>): boolean {
  return q.text.trim().length >= 2 || q.playstyleIds.length > 0;
}

/**
 * The Scryfall query for a finder search, WITHOUT the commander base clause
 * (`is:commander f:commander`, or PDH's `t:creature r:uncommon`), which the
 * client adds. Plain words search the name, type line and rules text; a query
 * with Scryfall syntax passes through as typed. Several playstyles are OR'd:
 * AND would usually return nothing, and the overlap ranks first instead
 * ({@link compareEntries}).
 *
 * `withPlaystyles: false` leaves the playstyle clauses out, for the offline
 * catalog, whose query engine has no regex; the caller filters locally then.
 */
export function buildScryfallQuery(q: FinderQuery, withPlaystyles = true): string {
  const parts: string[] = [];
  const color = colorClause(q.colors, q.colorMode);
  if (color) parts.push(color);
  const text = q.text.trim();
  if (text.length >= 2) {
    if (hasQuerySyntax(text)) {
      // Undo the space a phone keyboard puts after an operator's colon.
      parts.push(`(${normalizeScryfallQuery(text)})`);
    } else {
      const phrase = text.replace(/"/g, '');
      parts.push(`((${phrase}) OR t:"${phrase}" OR o:"${phrase}")`);
    }
  }
  if (withPlaystyles) {
    const clauses = q.playstyleIds
      .map((id) => playstyleById(id))
      .flatMap((p) => {
        const clause = p ? playstyleScryfallClause(p) : null;
        return clause ? [clause] : [];
      });
    if (clauses.length === 1) parts.push(clauses[0]);
    else if (clauses.length > 1) parts.push(`(${clauses.join(' OR ')})`);
  }
  return parts.join(' ');
}

export interface MatchReason {
  field: 'name' | 'type' | 'rules';
  /** The line to show: the type line, or the rules sentence that matched. */
  text: string;
  /** The matched span inside `text`, for highlighting. */
  start: number;
  end: number;
}

/** Longest rules excerpt a tile shows before clipping around the match. */
const REASON_MAX = 110;

/**
 * Why a card matched a plain-words search, so a tile can say "Rules text:
 * …sacrifice…". That line is how a player learns the box searches rules text
 * without being told. Null for Scryfall syntax (the reason is the query) and
 * for no match.
 */
export function matchReason(
  card: { name: string; typeLine?: string; oracleText?: string },
  text: string
): MatchReason | null {
  const q = text.trim().toLowerCase();
  if (q.length < 2 || hasQuerySyntax(q)) return null;
  const name = card.name.toLowerCase();
  if (name.includes(q)) {
    const start = name.indexOf(q);
    return { field: 'name', text: card.name, start, end: start + q.length };
  }
  const type = card.typeLine ?? '';
  const ti = type.toLowerCase().indexOf(q);
  if (ti >= 0) return { field: 'type', text: type, start: ti, end: ti + q.length };
  const oracle = card.oracleText ?? '';
  const oi = oracle.toLowerCase().indexOf(q);
  if (oi < 0) return null;
  // The sentence (or line) holding the match.
  const before = oracle.slice(0, oi);
  const sentenceStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('. ') + 1, 0);
  const rest = oracle.slice(oi);
  const endRel = rest.search(/\.(\s|$)|\n/);
  const sentenceEnd = endRel < 0 ? oracle.length : oi + endRel + 1;
  let from = sentenceStart;
  let to = sentenceEnd;
  if (to - from > REASON_MAX) {
    from = Math.max(from, oi - 40);
    to = Math.min(to, from + REASON_MAX);
  }
  const slice = oracle.slice(from, to).trim();
  const lead = oracle.slice(from, to).length - oracle.slice(from, to).trimStart().length;
  const prefix = from > sentenceStart ? '…' : '';
  const suffix = to < sentenceEnd ? '…' : '';
  const start = prefix.length + (oi - from - lead);
  return { field: 'rules', text: `${prefix}${slice}${suffix}`, start, end: start + q.length };
}

/** One commander in the result list, whatever source it came from. */
export interface FinderEntry {
  /** Stable React key. */
  key: string;
  name: string;
  /** Color identity letters, `['C']` for colorless. */
  colors: string[];
  typeLine?: string;
  oracleText?: string;
  cmc?: number;
  /** Lower is more popular (EDHREC rank or list position). */
  popularity?: number;
  /** EDHREC deck count, when the source list carries it. */
  numDecks?: number;
  /** Playstyle ids this commander was classified under, strongest first. */
  playstyleIds: string[];
  /** Best position on the EDHREC tag lists of the selected playstyles. */
  tagRank?: number;
}

export interface CompareContext {
  sort: FinderSort;
  text: string;
  selectedPlaystyles: readonly string[];
  /** Readiness percent by lowercased name; undefined until it loads. */
  readiness: (name: string) => number | undefined;
}

const FIELD_RANK = { name: 0, type: 1, rules: 2 } as const;

/** Ascending with unknown values last in both directions (memory: unknown sorts last). */
function byKnown(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

function overlap(e: FinderEntry, selected: readonly string[]): number {
  return selected.reduce((n, id) => n + (e.playstyleIds.includes(id) ? 1 : 0), 0);
}

/**
 * Result order for a sort. "Best match" puts commanders matching more of the
 * chosen playstyles first, then EDHREC's crowd list for those playstyles, then
 * a name hit over a type hit over a rules-text hit, then popularity.
 */
export function compareEntries(a: FinderEntry, b: FinderEntry, ctx: CompareContext): number {
  const alpha = a.name.localeCompare(b.name);
  const popular = byKnown(a.popularity, b.popularity) || alpha;
  switch (ctx.sort) {
    case 'name':
      return alpha;
    case 'mv':
      return byKnown(a.cmc, b.cmc) || popular;
    case 'popular':
      return popular;
    case 'owned': {
      const ra = ctx.readiness(a.name.toLowerCase());
      const rb = ctx.readiness(b.name.toLowerCase());
      // Descending percent, unscored last.
      return (
        byKnown(ra === undefined ? undefined : -ra, rb === undefined ? undefined : -rb) || popular
      );
    }
    default: {
      const ov = overlap(b, ctx.selectedPlaystyles) - overlap(a, ctx.selectedPlaystyles);
      if (ov !== 0) return ov;
      const tag = byKnown(a.tagRank, b.tagRank);
      if (tag !== 0) return tag;
      const ra = matchReason(a, ctx.text);
      const rb = matchReason(b, ctx.text);
      const fa = ra ? FIELD_RANK[ra.field] : 3;
      const fb = rb ? FIELD_RANK[rb.field] : 3;
      return fa - fb || popular;
    }
  }
}

/** The sort in effect: "Best match" only exists while something is searched. */
export function effectiveSort(chosen: FinderSort | null, searching: boolean): FinderSort {
  if (chosen === 'match' && !searching) return 'popular';
  return chosen ?? (searching ? 'match' : 'popular');
}

/** One way out of an empty result, offered as a button. */
export interface Relaxation {
  id: 'source' | 'within' | 'text' | `style:${string}`;
  label: string;
}

/**
 * Filters an empty result could drop, most likely to help first. An empty
 * state names the filter to remove instead of saying "No commanders found".
 */
export function relaxations(q: FinderQuery & { source: FinderSource }): Relaxation[] {
  const out: Relaxation[] = [];
  if (q.source === 'owned') out.push({ id: 'source', label: 'Search all commanders' });
  if (q.colorMode === 'exact' && q.colors.size > 0 && !q.colors.has('C')) {
    out.push({ id: 'within', label: `Within ${colorWords(q.colors).toLowerCase()}` });
  }
  for (const id of q.playstyleIds) {
    const p = playstyleById(id);
    if (p) out.push({ id: `style:${id}`, label: `Remove ${p.label}` });
  }
  if (q.text.trim()) out.push({ id: 'text', label: 'Clear the search' });
  return out;
}

/**
 * The active filters as one line: `Golgari · Aristocrats or Tokens · “sac”`.
 * Empty when nothing is set.
 */
export function filterSummary(q: FinderQuery): string {
  const parts: string[] = [];
  if (q.colors.size > 0) {
    const name = colorComboName(q.colors);
    parts.push(q.colorMode === 'within' && !q.colors.has('C') ? `within ${name}` : name);
  }
  const styles = q.playstyleIds.flatMap((id) => {
    const p = playstyleById(id);
    return p ? [p.label] : [];
  });
  if (styles.length > 0) parts.push(styles.join(' or '));
  const text = q.text.trim();
  if (text.length >= 2) parts.push(`“${text}”`);
  return parts.join(' · ');
}
