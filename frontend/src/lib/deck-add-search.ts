/**
 * Query engine for the deck editor's add-cards panel (E126).
 *
 * One search box, two modes, decided per keystroke:
 *  - plain text → punctuation-agnostic name match PLUS oracle-text match,
 *    with name hits ranked first (so "draw" surfaces Divination by its rules
 *    text without burying "Drawn from Dreams").
 *  - Scryfall-style syntax (`o:`, `t:`, `otag:`, `cmc<=2`, `r:rare`, `-`, `OR`)
 *    → the shared offline query interpreter, run against the collection via a
 *    thin EnrichedCard adapter. `keyword:` clauses rewrite to oracle-text
 *    matches because collection rows don't carry a keywords array.
 *
 * Pure and unit-tested; the panel supplies the (optional) oracle-tag lookup.
 */
import {
  matchesQuery,
  parseQuery,
  queryUsesOtag,
  type ParsedQuery,
  type QueryCard,
} from './offline/scryfall-query';
import { normalizeForSearch } from './normalize-search';
import type { EnrichedCard } from '../types';

/** Does the query use operator syntax (vs a plain name/text search)? */
export function hasQuerySyntax(query: string): boolean {
  // `key:` / `key=` / `key<n` operators, `!"exact name"`, or a top-level OR.
  return /(^|\s)-?[a-z]+[:=<>]\S/i.test(query) || /(^|\s)!\S/.test(query) || /\sOR\s/.test(query);
}

export interface CollectionMatch {
  hit: boolean;
  /** Plain-text mode only: the query matched the card NAME (ranks first). */
  nameHit: boolean;
}

export interface CollectionSearch {
  kind: 'empty' | 'name' | 'syntax';
  /** True when the query has an `otag:` clause — the caller should load the tag snapshot. */
  usesTags: boolean;
  match(card: EnrichedCard): CollectionMatch;
}

const MATCH = { hit: true, nameHit: false } as const;
const MISS = { hit: false, nameHit: false } as const;

function toQueryCard(c: EnrichedCard, tagsFor?: (name: string) => string[]): QueryCard {
  return {
    name: c.name,
    cmc: c.cmc ?? 0,
    typeLine: c.typeLine ?? '',
    oracleText: c.oracleText,
    colors: c.colors ?? [],
    colorIdentity: c.colorIdentity ?? [],
    legalities: c.legalities ?? {},
    layout: c.layout,
    rarity: c.rarity,
    tags: tagsFor ? tagsFor(c.name) : undefined,
  };
}

/**
 * Build a matcher for the collection tab. `tagsFor` is the oracle-tag lookup
 * (pass once the snapshot is loaded); without it `otag:` clauses degrade to
 * match-anything rather than zeroing results.
 */
export function buildCollectionSearch(
  query: string,
  tagsFor?: (name: string) => string[]
): CollectionSearch {
  const q = query.trim();
  if (!q) {
    return { kind: 'empty', usesTags: false, match: () => MATCH };
  }
  if (hasQuerySyntax(q)) {
    const parsed = parseQuery(q);
    // Collection rows carry no keywords array — approximate `keyword:` via
    // oracle text (printed keywords appear in the rules text).
    const rewritten: ParsedQuery = {
      groups: parsed.groups.map((g) =>
        g.map((c) => (c.kind === 'keyword' ? { ...c, kind: 'oracle' as const } : c))
      ),
    };
    return {
      kind: 'syntax',
      usesTags: queryUsesOtag(parsed),
      match: (card) => (matchesQuery(toQueryCard(card, tagsFor), rewritten) ? MATCH : MISS),
    };
  }
  const nq = normalizeForSearch(q);
  const lq = q.toLowerCase();
  return {
    kind: 'name',
    usesTags: false,
    match: (card) => {
      if (normalizeForSearch(card.name).includes(nq)) return { hit: true, nameHit: true };
      if ((card.oracleText ?? '').toLowerCase().includes(lq)) return MATCH;
      return MISS;
    },
  };
}

// ── Result sorting (shared by the Collection and Scryfall tabs) ────────────

export type AddSort = 'default' | 'name' | 'edhrec' | 'cmc' | 'price';

export interface SortableResult {
  name: string;
  /** Plain-text name hit — ranks first under the default sort. */
  nameHit?: boolean;
  cmc?: number;
  /** USD price (collection: purchase price; Scryfall: prices.usd). */
  price?: number;
  /** EDHREC inclusion % for this commander, when known (gap analysis). */
  inclusion?: number;
  /** Global EDHREC rank (1 = most played) — fallback fit signal. */
  edhrecRank?: number;
}

const BIG = Number.MAX_SAFE_INTEGER;

/**
 * Comparator for an add-panel sort. `default` means "best match": name hits
 * first, then alphabetical (the Scryfall tab keeps server relevance order
 * instead of applying this). `edhrec` ranks commander-specific inclusion %
 * above the global-rank fallback so deck-fit signal always wins.
 */
export function compareResults(a: SortableResult, b: SortableResult, sort: AddSort): number {
  const alpha = () => a.name.localeCompare(b.name);
  switch (sort) {
    case 'name':
      return alpha();
    case 'cmc':
      return (a.cmc ?? BIG) - (b.cmc ?? BIG) || alpha();
    case 'price':
      // Descending, unknown-price last (mirrors Scryfall's usd sort).
      return (b.price ?? -1) - (a.price ?? -1) || alpha();
    case 'edhrec': {
      const ak = a.inclusion !== undefined ? -1 : 1;
      const bk = b.inclusion !== undefined ? -1 : 1;
      if (ak !== bk) return ak - bk;
      if (ak === -1) return (b.inclusion ?? 0) - (a.inclusion ?? 0) || alpha();
      return (a.edhrecRank ?? BIG) - (b.edhrecRank ?? BIG) || alpha();
    }
    default: {
      const an = a.nameHit ? 0 : 1;
      const bn = b.nameHit ? 0 : 1;
      return an - bn || alpha();
    }
  }
}
