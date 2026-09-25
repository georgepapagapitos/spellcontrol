/**
 * Strict, three-valued evaluator for Commander Spellbook "template" queries —
 * the Scryfall-flavoured search a combo variant attaches when it needs a card
 * it can't name (variant id carries a `--<templateIds>` suffix; the template's
 * `scryfallQuery` is e.g. "mv<=1 (mana={0} or mana={1} or mana={C}) is:permanent"
 * for "Permanent Castable for {C}").
 *
 * `evaluateTemplate` returns `true`/`false` when the grammar and the card's own
 * data are enough to decide, and `null` when either isn't — an unsupported
 * clause, an unknown `otag:`, or a card field we can't parse (`power: "*"`).
 * NEVER guess `true` for something we can't evaluate: unlike
 * `frontend/src/lib/offline/scryfall-query.ts` (search, which degrades an
 * unknown clause to match-anything on purpose), a bracket floor is exactly the
 * place a false "complete" is a worse answer than "unresolved".
 *
 * Coverage measured against the 204-template Spellbook corpus (2026-09-24):
 * every clause type actually used except Scryfall's `produces:` (mana
 * production) — see the ship report for the exact count. Grammar covered:
 * nested parens, `or`/`OR`, explicit `and`, implicit AND, `-` negation,
 * `t:`/`type:`, `o:`/`oracle:` (quoted substring, bare word, `/regex/`, `~` =
 * this card's own name), `kw:`/`keyword:`, `mana=`/`m=` (exact symbol
 * multiset), `mana:`/`m:` (contains), `mv`/`cmc` comparisons, `is:`
 * (permanent/creature/spell/commander/dfc/tdfc/mdfc/flip/hybrid), `c`/`color`
 * (`=` exact, `:` contains-at-least, `c`/`0`/`colorless` = colorless),
 * `pow`/`power`/`tou`/`toughness` comparisons, `!"exact name"`, `otag:` (only
 * when the injected {@link OracleTagLookup} actually carries that tag).
 */

// ── Card + tag shapes ────────────────────────────────────────────────────────

/**
 * Structural subset of Scryfall's card JSON the evaluator reads. Both apps'
 * real card types (frontend `ScryfallCard`, backend cache `ScryfallCard`)
 * satisfy this as-is — no adapter needed at the call sites.
 */
export interface TemplateCard {
  name: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  keywords?: string[];
  power?: string;
  toughness?: string;
  layout?: string;
  card_faces?: Array<{
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
  }>;
}

/**
 * Scryfall oracle-tag (otag:) membership, injected like {@link TagLookup} —
 * this is the FULL ~4.5k-tag community corpus (the frontend's
 * `otag-index.json` / `lib/card-tags.ts`), a different, much larger dataset
 * than the app's own 24-tag `TagLookup` used for bracket signals.
 * `isKnownTag` gates true/false vs null: a tag the loaded corpus doesn't
 * carry at all (or a corpus that hasn't loaded yet) makes the clause
 * unsupported for this call, never a silent false.
 */
export interface OracleTagLookup {
  isKnownTag(tag: string): boolean;
  hasTag(cardName: string, tag: string): boolean;
}

/** An {@link OracleTagLookup} that knows nothing — every `otag:` clause reads
 *  null. The safe default when the tag corpus hasn't loaded. */
export const EMPTY_ORACLE_TAGS: OracleTagLookup = {
  isKnownTag: () => false,
  hasTag: () => false,
};

type Tri = boolean | null;
type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

// ── Clause + AST types ───────────────────────────────────────────────────────

type Clause =
  | { c: 'name'; value: string }
  | { c: 'oracle'; value: string }
  | { c: 'oracleRegex'; re: RegExp }
  | { c: 'type'; value: string }
  | { c: 'keyword'; value: string }
  | { c: 'otag'; value: string }
  | { c: 'manaExact'; symbols: string[] }
  | { c: 'manaContains'; symbols: string[] }
  | { c: 'mv'; op: CmpOp; value: number }
  | { c: 'is'; value: string }
  | { c: 'color'; op: 'eq' | 'contains'; colorless: boolean; value: Set<string> }
  | { c: 'pow'; op: CmpOp; value: number }
  | { c: 'tou'; op: CmpOp; value: number }
  | { c: 'unsupported' };

type Node =
  | { t: 'clause'; neg: boolean; clause: Clause }
  | { t: 'and'; nodes: Node[] }
  | { t: 'or'; nodes: Node[] };

// ── Tokenizer ─────────────────────────────────────────────────────────────

type Token =
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'or' }
  | { type: 'and' }
  | { type: 'clause'; raw: string; neg: boolean };

function isBoundary(before: string | undefined, after: string | undefined): boolean {
  const beforeOk = before === undefined || /[\s(]/.test(before);
  const afterOk = after === undefined || /[\s)]/.test(after);
  return beforeOk && afterOk;
}

/** Consume one clause's raw text (with its quotes/regex delimiters intact),
 *  from `i` up to the next whitespace or paren OUTSIDE a `"..."` or `/.../`
 *  span — both of which may themselves contain spaces/parens (e.g.
 *  `o:/^cycling (\{1\}|\{2\})$/`). */
function consumeClauseSpan(q: string, i: number): number {
  const n = q.length;
  while (i < n) {
    const ch = q[i];
    if (ch === '"') {
      i++;
      while (i < n && q[i] !== '"') i++;
      if (i < n) i++;
      continue;
    }
    if (ch === '/') {
      i++;
      while (i < n && q[i] !== '/') i++;
      if (i < n) i++;
      continue;
    }
    if (/\s/.test(ch) || ch === '(' || ch === ')') break;
    i++;
  }
  return i;
}

function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  const n = q.length;
  let i = 0;
  while (i < n) {
    const ch = q[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (q.slice(i, i + 2).toLowerCase() === 'or' && isBoundary(q[i - 1], q[i + 2])) {
      tokens.push({ type: 'or' });
      i += 2;
      continue;
    }
    if (q.slice(i, i + 3).toLowerCase() === 'and' && isBoundary(q[i - 1], q[i + 3])) {
      tokens.push({ type: 'and' });
      i += 3;
      continue;
    }
    // A '-' directly before a clause negates it. `-(` never occurs in the
    // corpus (measured); left unhandled here it becomes an isolated
    // unsupported clause token rather than corrupting paren matching.
    let neg = false;
    if (ch === '-' && q[i + 1] !== undefined && q[i + 1] !== '(' && !/\s/.test(q[i + 1])) {
      neg = true;
      i++;
    }
    const start = i;
    i = consumeClauseSpan(q, i);
    const raw = q.slice(start, i);
    if (raw.length === 0) {
      i++;
      continue;
    }
    tokens.push({ type: 'clause', raw, neg });
  }
  return tokens;
}

// ── Parser (recursive descent: OR of AND of unary) ──────────────────────────

interface Pos {
  i: number;
}

function parseExpr(tokens: Token[], pos: Pos): Node {
  const nodes: Node[] = [parseAnd(tokens, pos)];
  while (pos.i < tokens.length && tokens[pos.i].type === 'or') {
    pos.i++;
    nodes.push(parseAnd(tokens, pos));
  }
  return nodes.length === 1 ? nodes[0] : { t: 'or', nodes };
}

function parseAnd(tokens: Token[], pos: Pos): Node {
  const nodes: Node[] = [];
  while (pos.i < tokens.length) {
    const tok = tokens[pos.i];
    if (tok.type === 'or' || tok.type === 'rparen') break;
    if (tok.type === 'and') {
      pos.i++; // explicit "and" is the same as juxtaposition
      continue;
    }
    nodes.push(parseUnary(tokens, pos));
  }
  if (nodes.length === 0) return { t: 'clause', neg: false, clause: { c: 'unsupported' } };
  return nodes.length === 1 ? nodes[0] : { t: 'and', nodes };
}

function parseUnary(tokens: Token[], pos: Pos): Node {
  const tok = tokens[pos.i];
  if (tok.type === 'lparen') {
    pos.i++;
    const inner = parseExpr(tokens, pos);
    if (tokens[pos.i]?.type === 'rparen') pos.i++;
    return inner;
  }
  if (tok.type === 'clause') {
    pos.i++;
    return { t: 'clause', neg: tok.neg, clause: classifyClause(tok.raw) };
  }
  // Defensive: an isolated 'or'/'and'/')' reached here on malformed input.
  pos.i++;
  return { t: 'clause', neg: false, clause: { c: 'unsupported' } };
}

const parseCache = new Map<string, Node>();

function parseTemplateQuery(query: string): Node {
  let ast = parseCache.get(query);
  if (!ast) {
    ast = parseExpr(tokenize(query), { i: 0 });
    parseCache.set(query, ast);
  }
  return ast;
}

// ── Clause classification ───────────────────────────────────────────────────

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function matchOp(rest: string): { op: string; len: number } {
  if (rest.startsWith('<=')) return { op: '<=', len: 2 };
  if (rest.startsWith('>=')) return { op: '>=', len: 2 };
  if (rest.startsWith('!=')) return { op: '!=', len: 2 };
  if (rest.startsWith('<')) return { op: '<', len: 1 };
  if (rest.startsWith('>')) return { op: '>', len: 1 };
  if (rest.startsWith('=')) return { op: '=', len: 1 };
  return { op: ':', len: 1 };
}

function cmpOpFrom(op: string): CmpOp | null {
  switch (op) {
    case '=':
    case ':':
      return '=';
    case '!=':
      return '!=';
    case '<':
      return '<';
    case '<=':
      return '<=';
    case '>':
      return '>';
    case '>=':
      return '>=';
    default:
      return null;
  }
}

const WUBRG = ['w', 'u', 'b', 'r', 'g'];
const COLOR_WORDS: Record<string, string> = {
  white: 'w',
  blue: 'u',
  black: 'b',
  red: 'r',
  green: 'g',
};

function parseColorWord(word: string): Set<string> {
  const out = new Set<string>();
  const named = COLOR_WORDS[word];
  if (named) {
    out.add(named);
    return out;
  }
  for (const ch of word) if (WUBRG.includes(ch)) out.add(ch);
  return out;
}

function extractSymbols(value: string): string[] {
  const matches = value.match(/\{[^}]+\}/g);
  return matches ? matches.map((s) => s.toUpperCase()) : [];
}

function classifyClause(raw: string): Clause {
  if (raw.startsWith('!')) {
    return { c: 'name', value: stripQuotes(raw.slice(1)).toLowerCase() };
  }
  const idx = raw.search(/[:=<>!]/);
  if (idx === -1) return { c: 'unsupported' };
  const key = raw.slice(0, idx).toLowerCase();
  const { op, len } = matchOp(raw.slice(idx));
  const rawValue = raw.slice(idx + len);

  switch (key) {
    case 't':
    case 'type':
      return { c: 'type', value: stripQuotes(rawValue).toLowerCase() };
    case 'o':
    case 'oracle': {
      if (rawValue.length >= 2 && rawValue.startsWith('/') && rawValue.endsWith('/')) {
        try {
          return { c: 'oracleRegex', re: new RegExp(rawValue.slice(1, -1), 'im') };
        } catch {
          return { c: 'unsupported' };
        }
      }
      return { c: 'oracle', value: stripQuotes(rawValue).toLowerCase() };
    }
    case 'kw':
    case 'keyword':
      return { c: 'keyword', value: stripQuotes(rawValue).toLowerCase() };
    case 'otag':
    case 'oracletag':
    case 'function':
      return { c: 'otag', value: stripQuotes(rawValue).toLowerCase() };
    case 'm':
    case 'mana': {
      const symbols = extractSymbols(rawValue);
      if (op === '=') return { c: 'manaExact', symbols };
      if (op === ':') return { c: 'manaContains', symbols };
      return { c: 'unsupported' };
    }
    case 'mv':
    case 'cmc':
    case 'manavalue': {
      const num = Number(rawValue);
      const cop = cmpOpFrom(op);
      if (!Number.isFinite(num) || !cop) return { c: 'unsupported' };
      return { c: 'mv', op: cop, value: num };
    }
    case 'is':
      return { c: 'is', value: stripQuotes(rawValue).toLowerCase() };
    case 'c':
    case 'color':
    case 'colors': {
      const word = stripQuotes(rawValue).toLowerCase();
      if (word === 'c' || word === '0' || word === 'colorless') {
        return { c: 'color', op: 'eq', colorless: true, value: new Set() };
      }
      return {
        c: 'color',
        op: op === '=' ? 'eq' : 'contains',
        colorless: false,
        value: parseColorWord(word),
      };
    }
    case 'pow':
    case 'power': {
      const num = Number(rawValue);
      const cop = cmpOpFrom(op);
      if (!Number.isFinite(num) || !cop) return { c: 'unsupported' };
      return { c: 'pow', op: cop, value: num };
    }
    case 'tou':
    case 'toughness': {
      const num = Number(rawValue);
      const cop = cmpOpFrom(op);
      if (!Number.isFinite(num) || !cop) return { c: 'unsupported' };
      return { c: 'tou', op: cop, value: num };
    }
    default:
      return { c: 'unsupported' };
  }
}

// ── Card-field helpers (mirrors backend cache.ts's face-flattening) ────────

function effectiveTypeLine(card: TemplateCard): string {
  if (card.type_line) return card.type_line;
  return (card.card_faces ?? [])
    .map((f) => f.type_line ?? '')
    .filter(Boolean)
    .join(' // ');
}

function effectiveOracleText(card: TemplateCard): string {
  if (card.oracle_text) return card.oracle_text;
  return (card.card_faces ?? [])
    .map((f) => f.oracle_text ?? '')
    .filter(Boolean)
    .join('\n//\n');
}

function effectiveManaCost(card: TemplateCard): string {
  return card.mana_cost || card.card_faces?.[0]?.mana_cost || '';
}

function effectiveColors(card: TemplateCard): Set<string> {
  if (card.colors) return new Set(card.colors.map((c) => c.toLowerCase()));
  const out = new Set<string>();
  for (const f of card.card_faces ?? []) for (const c of f.colors ?? []) out.add(c.toLowerCase());
  return out;
}

function effectivePower(card: TemplateCard): string | undefined {
  return card.power ?? card.card_faces?.[0]?.power;
}

function effectiveToughness(card: TemplateCard): string | undefined {
  return card.toughness ?? card.card_faces?.[0]?.toughness;
}

function parsePT(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compareNum(actual: number, op: CmpOp, expected: number): boolean {
  switch (op) {
    case '=':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
  }
}

function countSymbols(symbols: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of symbols) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}

function sameMultiset(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function containsMultiset(have: Map<string, number>, need: Map<string, number>): boolean {
  for (const [k, v] of need) if ((have.get(k) ?? 0) < v) return false;
  return true;
}

function evalIs(card: TemplateCard, value: string): Tri {
  const typeLine = effectiveTypeLine(card).toLowerCase();
  switch (value) {
    case 'permanent':
      return /(creature|artifact|enchantment|land|planeswalker|battle)/.test(typeLine);
    case 'creature':
      return /creature/.test(typeLine);
    case 'spell':
      // Real Scryfall semantics: anything not a land (a "spell" is cast).
      return !/land/.test(typeLine);
    case 'commander':
      return (
        /legendary/.test(typeLine) &&
        (/creature/.test(typeLine) ||
          effectiveOracleText(card).toLowerCase().includes('can be your commander'))
      );
    case 'dfc':
      return (
        card.layout === 'transform' ||
        card.layout === 'modal_dfc' ||
        card.layout === 'meld' ||
        card.layout === 'reversible_card'
      );
    case 'tdfc':
      return card.layout === 'transform';
    case 'mdfc':
      return card.layout === 'modal_dfc';
    case 'flip':
      return card.layout === 'flip';
    case 'hybrid':
      return /\{[^}]*\/[^}]*\}/.test(effectiveManaCost(card));
    default:
      return null;
  }
}

function evalClause(clause: Clause, card: TemplateCard, tags: OracleTagLookup): Tri {
  switch (clause.c) {
    case 'unsupported':
      return null;
    case 'name':
      return card.name.toLowerCase() === clause.value;
    case 'oracle': {
      // `~` in a template's oracle-text search stands for the card's own name.
      const needle = clause.value.split('~').join(card.name.toLowerCase());
      return effectiveOracleText(card).toLowerCase().includes(needle);
    }
    case 'oracleRegex':
      return clause.re.test(effectiveOracleText(card));
    case 'type':
      return effectiveTypeLine(card).toLowerCase().includes(clause.value);
    case 'keyword':
      return (card.keywords ?? []).some((k) => k.toLowerCase() === clause.value);
    case 'otag':
      if (!tags.isKnownTag(clause.value)) return null;
      return tags.hasTag(card.name, clause.value);
    case 'manaExact':
      return sameMultiset(
        countSymbols(extractSymbols(effectiveManaCost(card))),
        countSymbols(clause.symbols)
      );
    case 'manaContains':
      return containsMultiset(
        countSymbols(extractSymbols(effectiveManaCost(card))),
        countSymbols(clause.symbols)
      );
    case 'mv':
      return compareNum(card.cmc ?? 0, clause.op, clause.value);
    case 'is':
      return evalIs(card, clause.value);
    case 'color': {
      const colors = effectiveColors(card);
      if (clause.colorless) return colors.size === 0;
      if (clause.op === 'eq') {
        if (colors.size !== clause.value.size) return false;
        for (const c of clause.value) if (!colors.has(c)) return false;
        return true;
      }
      for (const c of clause.value) if (!colors.has(c)) return false;
      return true;
    }
    case 'pow': {
      const p = parsePT(effectivePower(card));
      return p === null ? null : compareNum(p, clause.op, clause.value);
    }
    case 'tou': {
      const t = parsePT(effectiveToughness(card));
      return t === null ? null : compareNum(t, clause.op, clause.value);
    }
  }
}

/** Three-valued (Kleene) evaluation: a definite false/true dominates its
 *  group; otherwise any `null` operand makes the group's answer `null`. */
function evalNode(node: Node, card: TemplateCard, tags: OracleTagLookup): Tri {
  if (node.t === 'clause') {
    const r = evalClause(node.clause, card, tags);
    if (r === null) return null;
    return node.neg ? !r : r;
  }
  let sawNull = false;
  if (node.t === 'and') {
    for (const n of node.nodes) {
      const r = evalNode(n, card, tags);
      if (r === false) return false;
      if (r === null) sawNull = true;
    }
    return sawNull ? null : true;
  }
  for (const n of node.nodes) {
    const r = evalNode(n, card, tags);
    if (r === true) return true;
    if (r === null) sawNull = true;
  }
  return sawNull ? null : false;
}

/**
 * Does `card` match a Spellbook template's `scryfallQuery`? `true`/`false`
 * when decidable, `null` when the query (or an unparseable card field, e.g.
 * `power: "*"`) isn't. A null/empty `query` (the template has none —
 * ~16% of the corpus) is always null: nothing to check against.
 */
export function evaluateTemplate(
  query: string | null | undefined,
  card: TemplateCard,
  tags: OracleTagLookup
): boolean | null {
  if (!query) return null;
  return evalNode(parseTemplateQuery(query), card, tags);
}

// ── Combo-level resolution ───────────────────────────────────────────────────

/** Assign each template a DISTINCT satisfying card (small N — a handful of
 *  candidates per template at most — so plain backtracking is plenty). */
function assignDistinct(candidateLists: TemplateCard[][]): (TemplateCard | null)[] | null {
  const n = candidateLists.length;
  const assigned: (TemplateCard | null)[] = new Array(n).fill(null);
  const used = new Set<string>();
  const order = candidateLists
    .map((_, i) => i)
    .sort((a, b) => candidateLists[a].length - candidateLists[b].length);

  function backtrack(pos: number): boolean {
    if (pos === n) return true;
    const idx = order[pos];
    for (const cand of candidateLists[idx]) {
      if (used.has(cand.name)) continue;
      used.add(cand.name);
      assigned[idx] = cand;
      if (backtrack(pos + 1)) return true;
      used.delete(cand.name);
      assigned[idx] = null;
    }
    return false;
  }

  return backtrack(0) ? assigned : null;
}

export interface TemplateResolution {
  /** True only when EVERY template has a distinct satisfying deck card. */
  satisfied: boolean;
  /** Parallel to the input `templateQueries`: the deck card name that
   *  satisfies each template, or null when unresolved. */
  satisfyingCards: (string | null)[];
}

/**
 * Resolves a combo's unnamed-card ("template") requirements against a deck's
 * card list. A card counts only when it (a) matches the template's query and
 * (b) isn't already one of the combo's own named pieces — and when a combo
 * needs more than one template, each gets a DIFFERENT deck card.
 *
 * `templateQueries === null`/`undefined` is NEVER trivially satisfied — pass
 * an explicit `[]` to say "this combo has zero templates" (satisfied). Null
 * means "no query data", which a comboId carrying Spellbook's `--` suffix
 * could reach either because it genuinely has none, or because the ingest
 * that wrote this row predates `templateQueries` — the caller can't tell
 * those apart, so the conservative answer is "not resolved".
 */
export function resolveComboTemplates(
  templateQueries: readonly (string | null)[] | null | undefined,
  namedPieces: readonly string[],
  deckCards: readonly TemplateCard[],
  tags: OracleTagLookup
): TemplateResolution {
  if (templateQueries === null || templateQueries === undefined) {
    // No query data at all: could genuinely be "no templates" (the vast
    // majority of combos — irrelevant, since `needsUnnamedCard` only reads
    // this for a comboId carrying Spellbook's `--` suffix) or stale ingest
    // data where `templates` (names) is populated but `templateQueries`
    // isn't yet. Either way we can't confirm a match, so stay unresolved —
    // conservative, matching the pre-resolution default.
    return { satisfied: false, satisfyingCards: [] };
  }
  if (templateQueries.length === 0) {
    return { satisfied: true, satisfyingCards: [] };
  }
  const named = new Set(namedPieces);
  const candidates = deckCards.filter((c) => !named.has(c.name));
  const perTemplate = templateQueries.map((q) =>
    q == null ? [] : candidates.filter((c) => evaluateTemplate(q, c, tags) === true)
  );
  if (perTemplate.some((list) => list.length === 0)) {
    return { satisfied: false, satisfyingCards: templateQueries.map(() => null) };
  }
  const assignment = assignDistinct(perTemplate);
  return {
    satisfied: assignment !== null,
    satisfyingCards: assignment
      ? assignment.map((c) => c?.name ?? null)
      : templateQueries.map(() => null),
  };
}
