import { normalizeScryfallQuery } from '../normalize-search';
import type { SlimCard } from './types';

/**
 * Tiny offline Scryfall-query interpreter. Covers the subset the deck builder
 * actually emits — full Scryfall syntax is out of scope. Unsupported tokens
 * are silently ignored so a query with one unsupported clause still returns
 * useful results rather than zero.
 *
 * Supported:
 *   - `t:<word>` or `type:<word>` → type_line includes (case-insensitive)
 *   - `o:"..."` or `oracle:"..."` → oracle_text includes
 *   - `keyword:<word>` → keywords contains
 *   - `otag:<tag>` / `oracletag:` / `function:` → oracle tags contains (only when
 *     the card list is decorated with tags or a `tagsFor` lookup is supplied —
 *     undecorated cards degrade to match-anything, like unknown clauses)
 *   - `r:<rarity>` or `rarity:<rarity>` → rarity equals
 *   - `f:<format>` → legalities[format] === 'legal'
 *   - `banned:<format>` → legalities[format] === 'banned'
 *   - `id<=WUBRG` / `id=WUBRG` / `id:WUBRG` → color_identity subset / equals
 *   - `c<=WU` / `c:WU` → colors subset
 *   - `cmc<=N` `cmc>=N` `cmc<N` `cmc>N` `cmc=N` `cmc:N`
 *   - `is:commander` `is:mdfc` `is:gamechanger` `is:digital`
 *   - `!"<exact name>"` → name equals (case-insensitive)
 *   - `-` prefix → negation
 *   - `OR` (uppercase) splits clauses into alternative groups (top-level only)
 *   - parentheses group clauses (no nested OR — current emitters don't nest)
 *
 * Anything else is logged once and treated as match-anything.
 */

type Clause =
  | { kind: 'type'; value: string; neg: boolean }
  | { kind: 'oracle'; value: string; neg: boolean }
  | { kind: 'keyword'; value: string; neg: boolean }
  | { kind: 'otag'; value: string; neg: boolean }
  | { kind: 'rarity'; value: string; neg: boolean }
  | { kind: 'format'; value: string; neg: boolean }
  | { kind: 'banned'; value: string; neg: boolean }
  | { kind: 'identity'; op: 'eq' | 'subset'; value: string; neg: boolean }
  | { kind: 'color'; op: 'eq' | 'subset'; value: string; neg: boolean }
  | { kind: 'cmc'; op: 'eq' | 'lte' | 'gte' | 'lt' | 'gt'; value: number; neg: boolean }
  | { kind: 'is'; value: string; neg: boolean }
  | { kind: 'exactName'; value: string; neg: boolean }
  | { kind: 'free'; value: string; neg: boolean }
  | { kind: 'unknown'; value: string; neg: boolean };

/** A query is a top-level OR of AND-groups. */
export interface ParsedQuery {
  groups: Clause[][];
}

export function parseQuery(input: string): ParsedQuery {
  // Undo the space mobile keyboards insert after an operator colon
  // ("t: vampire" → "t:vampire") so the clause tokenizes as one operator
  // instead of an empty filter + a free word. Mirrors the live client, which
  // normalizes in liveSearchCards — here is the offline path's one place.
  const tokens = tokenize(normalizeScryfallQuery(input));
  const groups: Clause[][] = [[]];
  for (const tok of tokens) {
    if (tok === 'OR') {
      groups.push([]);
      continue;
    }
    const clause = classify(tok);
    groups[groups.length - 1].push(clause);
  }
  return { groups };
}

function tokenize(input: string): string[] {
  // Strip surrounding parens — the emitter wraps each clause in parens to keep
  // operator precedence sane, but we treat them as no-ops at top level since
  // we don't support nesting. Inner parens get stripped too.
  const trimmed = input.replace(/[()]/g, ' ').trim();
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"') {
      buf += ch;
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function classify(rawTok: string): Clause {
  let tok = rawTok;
  const neg = tok.startsWith('-');
  if (neg) tok = tok.slice(1);

  // Exact name match: !"foo bar"
  if (tok.startsWith('!')) {
    const value = stripQuotes(tok.slice(1));
    return { kind: 'exactName', value: value.toLowerCase(), neg };
  }

  const colonIdx = tok.search(/[:=<>]/);
  if (colonIdx === -1) {
    // bare word: treat as oracle/name fuzzy
    return { kind: 'free', value: stripQuotes(tok).toLowerCase(), neg };
  }

  const key = tok.slice(0, colonIdx).toLowerCase();
  const opChars = matchOp(tok.slice(colonIdx));
  const op = opChars.op;
  const value = stripQuotes(tok.slice(colonIdx + opChars.length));

  switch (key) {
    case 't':
    case 'type':
      return { kind: 'type', value: value.toLowerCase(), neg };
    case 'o':
    case 'oracle':
      return { kind: 'oracle', value: value.toLowerCase(), neg };
    case 'keyword':
      return { kind: 'keyword', value: value.toLowerCase(), neg };
    case 'otag':
    case 'oracletag':
    case 'function':
      return { kind: 'otag', value: value.toLowerCase(), neg };
    case 'r':
    case 'rarity':
      return { kind: 'rarity', value: value.toLowerCase(), neg };
    case 'f':
    case 'format':
    case 'legal':
      return { kind: 'format', value: value.toLowerCase(), neg };
    case 'banned':
      return { kind: 'banned', value: value.toLowerCase(), neg };
    case 'id':
    case 'identity':
      return {
        kind: 'identity',
        op: op === ':' || op === '=' ? 'eq' : 'subset',
        value: value.toUpperCase(),
        neg,
      };
    case 'c':
    case 'color':
    case 'colors':
      return {
        kind: 'color',
        op: op === ':' || op === '=' ? 'eq' : 'subset',
        value: value.toUpperCase(),
        neg,
      };
    case 'cmc':
    case 'mv':
    case 'manavalue': {
      const num = Number(value);
      if (!Number.isFinite(num)) return { kind: 'unknown', value: tok, neg };
      const cmcOp =
        op === '<=' ? 'lte' : op === '>=' ? 'gte' : op === '<' ? 'lt' : op === '>' ? 'gt' : 'eq';
      return { kind: 'cmc', op: cmcOp, value: num, neg };
    }
    case 'is':
      return { kind: 'is', value: value.toLowerCase(), neg };
    default:
      return { kind: 'unknown', value: tok, neg };
  }
}

function matchOp(rest: string): { op: ':' | '=' | '<=' | '>=' | '<' | '>'; length: number } {
  if (rest.startsWith('<=')) return { op: '<=', length: 2 };
  if (rest.startsWith('>=')) return { op: '>=', length: 2 };
  if (rest.startsWith('<')) return { op: '<', length: 1 };
  if (rest.startsWith('>')) return { op: '>', length: 1 };
  if (rest.startsWith('=')) return { op: '=', length: 1 };
  return { op: ':', length: 1 };
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * Structural subset of {@link SlimCard} the matcher reads — lets other card
 * shapes (e.g. the collection's EnrichedCard, adapted in lib/deck-add-search)
 * run the same query engine without carrying the full slim payload.
 */
export interface QueryCard {
  name: string;
  cmc: number;
  typeLine: string;
  oracleText?: string;
  colors: string[];
  colorIdentity: string[];
  keywords?: string[];
  legalities: Record<string, string>;
  layout?: string;
  rarity?: string;
  isGameChanger?: boolean;
  /** Oracle tags (kebab keys) — supply via decoration or {@link MatchOpts.tagsFor}. */
  tags?: string[];
}

export interface MatchOpts {
  /** Lazy oracle-tag lookup for `otag:` clauses when cards aren't decorated. */
  tagsFor?: (name: string) => string[];
}

/** True when any clause reads oracle tags — gate for loading the tag snapshot. */
export function queryUsesOtag(query: ParsedQuery): boolean {
  return query.groups.some((g) => g.some((c) => c.kind === 'otag'));
}

// Scryfall's single-letter rarity shorthand (r:m ≡ r:mythic).
const RARITY_ALIAS: Record<string, string> = {
  c: 'common',
  u: 'uncommon',
  r: 'rare',
  m: 'mythic',
  s: 'special',
  b: 'bonus',
};

function matchClause(card: QueryCard, c: Clause, opts?: MatchOpts): boolean {
  // Degrade-to-ignored must ignore negation too: with no tag/rarity data in
  // hand, `otag:x` AND `-otag:x` are both no-ops (the UI reports the clause
  // as "ignored" — negating the degrade would instead zero all results).
  if (c.kind === 'otag' && (card.tags ?? opts?.tagsFor?.(card.name)) === undefined) return true;
  if (c.kind === 'rarity' && card.rarity === undefined) return true;
  const positive = matchPositive(card, c, opts);
  return c.neg ? !positive : positive;
}

function matchPositive(card: QueryCard, c: Clause, opts?: MatchOpts): boolean {
  switch (c.kind) {
    case 'type':
      return card.typeLine.toLowerCase().includes(c.value);
    case 'oracle':
      return (card.oracleText ?? '').toLowerCase().includes(c.value);
    case 'keyword':
      return card.keywords?.some((k) => k.toLowerCase() === c.value) ?? false;
    case 'otag': {
      const tags = card.tags ?? opts?.tagsFor?.(card.name);
      // No tag data in hand (snapshot not loaded / undecorated list): degrade
      // to match-anything like an unknown clause rather than zeroing results.
      if (tags === undefined) return true;
      return tags.some((t) => t.toLowerCase() === c.value);
    }
    case 'rarity':
      // Older slim payloads lack rarity — degrade to match-anything.
      if (card.rarity === undefined) return true;
      return card.rarity.toLowerCase() === (RARITY_ALIAS[c.value] ?? c.value);
    case 'format':
      return card.legalities[c.value] === 'legal';
    case 'banned':
      return card.legalities[c.value] === 'banned';
    case 'identity':
      return matchColorSet(card.colorIdentity, c.value, c.op);
    case 'color':
      return matchColorSet(card.colors, c.value, c.op);
    case 'cmc':
      switch (c.op) {
        case 'eq':
          return card.cmc === c.value;
        case 'lte':
          return card.cmc <= c.value;
        case 'gte':
          return card.cmc >= c.value;
        case 'lt':
          return card.cmc < c.value;
        case 'gt':
          return card.cmc > c.value;
      }
      // fallthrough not reachable; satisfies exhaustiveness
      return false;
    case 'is':
      return matchIs(card, c.value);
    case 'exactName':
      return card.name.toLowerCase() === c.value;
    case 'free':
      // Plain words fuzzy-match name or oracle text.
      return (
        card.name.toLowerCase().includes(c.value) ||
        (card.oracleText ?? '').toLowerCase().includes(c.value)
      );
    case 'unknown':
      // Unknown clauses are treated as no-op (match anything) rather than no-match;
      // this is the "degrade gracefully" path.
      return true;
  }
}

function matchColorSet(cardColors: string[], needleStr: string, op: 'eq' | 'subset'): boolean {
  const needle = parseColorWord(needleStr);
  const have = new Set(cardColors);
  if (op === 'eq') {
    if (have.size !== needle.size) return false;
    for (const c of needle) if (!have.has(c)) return false;
    return true;
  }
  // subset: card's identity is a subset of the needle
  for (const c of have) if (!needle.has(c)) return false;
  return true;
}

function parseColorWord(word: string): Set<string> {
  const out = new Set<string>();
  const upper = word.toUpperCase();
  // Named shortcuts (azorius, etc.) aren't worth supporting — emitters use WUBRG strings.
  for (const ch of upper) {
    if ((WUBRG as readonly string[]).includes(ch)) out.add(ch);
  }
  return out;
}

function matchIs(card: QueryCard, value: string): boolean {
  switch (value) {
    case 'commander':
      // Legendary creature OR legendary planeswalker that says "can be your commander"
      return (
        /Legendary/i.test(card.typeLine) &&
        (/Creature/i.test(card.typeLine) ||
          (card.oracleText ?? '').toLowerCase().includes('can be your commander'))
      );
    case 'mdfc':
      return card.layout === 'modal_dfc';
    case 'split':
      return card.layout === 'split';
    case 'transform':
      return card.layout === 'transform';
    case 'digital':
      // slim payload drops paper-only filter at projection time, so digital cards
      // should already be absent. Conservatively return false.
      return false;
    case 'gamechanger':
      return !!card.isGameChanger;
    case 'permanent':
      return /(Creature|Artifact|Enchantment|Land|Planeswalker|Battle)/i.test(card.typeLine);
    case 'creature':
      return /Creature/i.test(card.typeLine);
    case 'land':
      return /Land/i.test(card.typeLine);
    case 'spell':
      return !/Land/i.test(card.typeLine);
    default:
      return true; // unknown is-clause: treat as no-op
  }
}

export function matchesQuery(card: QueryCard, query: ParsedQuery, opts?: MatchOpts): boolean {
  if (query.groups.length === 0) return true;
  for (const group of query.groups) {
    let ok = true;
    for (const clause of group) {
      if (!matchClause(card, clause, opts)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export function filterCards(
  cards: Iterable<SlimCard>,
  query: string,
  opts?: MatchOpts
): SlimCard[] {
  const parsed = parseQuery(query);
  const out: SlimCard[] = [];
  for (const card of cards) {
    if (matchesQuery(card, parsed, opts)) out.push(card);
  }
  return out;
}
