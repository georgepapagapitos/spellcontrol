/**
 * Scryfall-syntax search over a FRIEND's collection (E237).
 *
 * The engine already exists — `offline/scryfall-query.ts` is a full
 * client-side interpreter, and `deck-add-search.ts` is the same adapter shape
 * for `EnrichedCard`. This module is the `FriendCard` adapter, and its whole
 * job is the *degrade contract*: a friend payload is deliberately thin
 * (oracle-level public fields only, no oracle text), so some clauses cannot be
 * answered here and must not pretend otherwise.
 *
 * Three behaviours, and the difference matters:
 *
 *  - **Answerable** — `t:`, `c:`, `ci:`, `cmc`, `r:`, `is:`, `otag:`, plain
 *    names. `otag:` works because `tagsFor` is keyed by card NAME, which the
 *    payload has.
 *  - **Stripped and reported** — `o:`, `keyword:`, `f:`/`banned:`. These read
 *    fields the payload doesn't carry, and the raw engine would return FALSE
 *    for every card: a search for `o:draw` would render as "your friend owns
 *    none of these", which is a lie. We drop the clause, keep the rest of the
 *    query working, and hand the caller `ignored` so the UI can say so.
 *  - **Already safe** — `rarity:` (pre-enrichment payloads) and `unknown:`
 *    degrade to match-anything inside the engine itself.
 *
 * `ci:` is the reason the enrichment in `friends.ts` exists at all: the engine
 * matches `op:'subset'` by checking every colour ON THE CARD against the
 * needle, so an absent identity (empty set) vacuously matched EVERY query.
 * A friend browser that answers "what fits my Atraxa deck" with the entire
 * collection is worse than one that can't answer at all.
 */
import {
  matchesQuery,
  parseQuery,
  queryUsesOtag,
  type ParsedQuery,
  type QueryCard,
} from './offline/scryfall-query';
import { hasQuerySyntax } from './deck-add-search';
import type { FriendCard } from './cube/pool';

/** Clause kinds a friend payload cannot answer, with the label the UI shows. */
const UNANSWERABLE: Record<string, string> = {
  oracle: 'o:',
  keyword: 'keyword:',
  format: 'f:',
  banned: 'banned:',
};

export interface FriendSearch {
  kind: 'empty' | 'name' | 'syntax';
  /** True when a clause needs the oracle-tag snapshot loaded. */
  usesTags: boolean;
  /** Clause labels dropped as unanswerable — render these, don't swallow them. */
  ignored: string[];
  match: (card: FriendCard) => boolean;
}

function toQueryCard(card: FriendCard, tagsFor?: (name: string) => string[]): QueryCard {
  return {
    name: card.name,
    cmc: card.cmc,
    typeLine: card.typeLine,
    // No oracleText by design — the payload doesn't carry it, and `o:` clauses
    // are stripped before matching rather than silently missing everything.
    colors: card.colors,
    // Absent identity falls back to `colors`: a card's identity is a superset
    // of its cost colours, so this is the closest honest approximation for a
    // payload cached before the enrichment shipped. It is NOT `[]`, which the
    // engine would read as colourless and match against everything.
    colorIdentity: card.colorIdentity ?? card.colors,
    legalities: {},
    rarity: card.rarity,
    tags: tagsFor ? tagsFor(card.name) : undefined,
  };
}

/** Drop clauses the payload can't answer; report their labels. */
function stripUnanswerable(parsed: ParsedQuery): { query: ParsedQuery; ignored: string[] } {
  const ignored = new Set<string>();
  const groups = parsed.groups.map((group) =>
    group.filter((clause) => {
      const label = UNANSWERABLE[clause.kind];
      if (label === undefined) return true;
      ignored.add(label);
      return false;
    })
  );
  return { query: { groups }, ignored: [...ignored] };
}

/**
 * Build a matcher over a friend's collection. `tagsFor` is the oracle-tag
 * lookup; without it `otag:` degrades to match-anything inside the engine.
 *
 * Plain text stays a NAME substring match — unlike the owned-collection search
 * it cannot also scan oracle text, so an unmatched plain word means the name
 * genuinely doesn't contain it.
 */
export function buildFriendSearch(
  query: string,
  tagsFor?: (name: string) => string[]
): FriendSearch {
  const q = query.trim();
  if (!q) return { kind: 'empty', usesTags: false, ignored: [], match: () => true };

  if (hasQuerySyntax(q)) {
    const parsed = parseQuery(q);
    const { query: usable, ignored } = stripUnanswerable(parsed);
    // Every clause was unanswerable — matching an empty query would return the
    // WHOLE collection, which reads as a successful search. Return nothing and
    // let the caller show `ignored` as the reason.
    const allDropped = usable.groups.every((g) => g.length === 0);
    return {
      kind: 'syntax',
      usesTags: queryUsesOtag(usable),
      ignored,
      match: allDropped ? () => false : (card) => matchesQuery(toQueryCard(card, tagsFor), usable),
    };
  }

  const lower = q.toLowerCase();
  return {
    kind: 'name',
    usesTags: false,
    ignored: [],
    match: (card) => card.name.toLowerCase().includes(lower),
  };
}
