/**
 * Substitute ranking v2 on the three suggestion surfaces (E517):
 *
 *  - the Coach collection lane's owned alternatives: `ownedAlternativesReranker`
 *    re-orders the candidates `buildSubstitutionOptions` already gated (same
 *    role gate, identity, ownership, land rule), so only the ORDER and the
 *    reasons change;
 *  - the card preview's "Swap this card": `rankSwapAlternatives` orders the
 *    same-role staples by how well each replaces the card being looked at,
 *    owned first as before;
 *  - the card preview's "Similar cards": `rankSimilarCards` scores the pool
 *    the strip already sourced.
 *
 * Each returns null when v2 can't rank (the facts aren't loaded, or the card
 * being replaced isn't in the snapshot), and the caller keeps its v1 order.
 * Deck generation never comes through here: it keeps the validated greedy
 * `buildSubstitutionPlan`.
 */
import { axisKeys, sharedAxisNames } from '@/lib/coach/axis-overlap';
import { withinColorIdentity } from '@/lib/coach/card-matching';
import { ownershipRank, type ChangeOwnership } from '@/lib/coach/deck-change';
import type { SimilarCandidate, SimilarInput } from '@/lib/coach/similar-cards';
import type { WhyFactor } from '@/lib/coach/why-factors';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import { getCardFacts } from '../cardFacts';
import { ROLE_TO_TAGGER, countsAsRole, type CardFacts } from '../cardFacts/schema';
import type { OptionsReranker } from '../deckBuilder/substituteFinder';
import type { DeckProfile } from './deckContext';
import { primaryRole, type SubstituteRole } from './features';
import { RUNTIME_SOURCES, deckProfileFor, substituteRankingReady } from './index';
import { SIMILAR_FLOOR, scoreSubstitute, type SubstituteScore } from './ranker';
import { substituteFactors, type FactorOptions } from './reasons';

/** The tagger roles' plain fact-role counterparts. */
const TAGGER_DEFAULT: Record<string, SubstituteRole> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'boardwipe',
  cardDraw: 'cardDraw',
};

/**
 * The fact role a tagger role means for THIS card: Counterspell's "removal"
 * slot is the counterspell role, Demonic Tutor's "cardDraw" slot is tutor.
 * The card's own strongest counted role that maps onto the tagger role wins.
 */
export function roleForTaggerRole(
  q: CardFacts,
  taggerRole: string | null | undefined
): SubstituteRole | null {
  if (!taggerRole) return primaryRole(q);
  let best: { role: SubstituteRole; s: number } | null = null;
  for (const r of q.roles) {
    if (!countsAsRole(r) || ROLE_TO_TAGGER[r.role].roleKey !== taggerRole) continue;
    const s = q.strengths[r.role] ?? 0;
    if (!best || s > best.s) best = { role: r.role, s };
  }
  return best?.role ?? TAGGER_DEFAULT[taggerRole] ?? primaryRole(q);
}

/** Pros first, then the other list, then the cons: the strongest reason leads. */
function mergeFactors(v2: readonly WhyFactor[], v1: readonly WhyFactor[] = []): WhyFactor[] {
  return [...v2.filter((f) => f.tone === 'pro'), ...v1, ...v2.filter((f) => f.tone !== 'pro')];
}

interface Scored<T> {
  item: T;
  index: number;
  facts: CardFacts | undefined;
  s: SubstituteScore | null;
}

function scoreAll<T>(
  q: CardFacts,
  items: readonly T[],
  nameOf: (item: T) => string | { name: string; oracle_id?: string },
  role: SubstituteRole | null,
  deck: DeckProfile
): Scored<T>[] {
  return items.map((item, index) => {
    const facts = getCardFacts(nameOf(item));
    const s = facts ? scoreSubstitute(q, facts, RUNTIME_SOURCES, { role, deck }) : null;
    return { item, index, facts, s };
  });
}
const scoreOf = (x: Scored<unknown>) => x.s?.score ?? -Infinity;

// ── Coach collection lane ──────────────────────────────────────────────────

/**
 * The v2 re-ranker `buildSubstitutionOptions` takes, for a deck. Null when the
 * facts aren't loaded.
 */
export function ownedAlternativesReranker(deckNames: readonly string[]): OptionsReranker | null {
  if (!substituteRankingReady()) return null;
  const deck = deckProfileFor(deckNames);
  return {
    rank(missing: GapAnalysisCard, names: readonly string[]) {
      const q = getCardFacts(missing.name);
      if (!q) return null;
      const role = roleForTaggerRole(q, missing.role);
      const scored = scoreAll(q, names, (n) => n, role, deck);
      scored.sort((a, b) => scoreOf(b) - scoreOf(a) || a.index - b.index);
      const byName = new Map(scored.map((x) => [x.item, x]));
      const opts: FactorOptions = { mana: 'gaps', edhrec: false };
      return {
        order: scored.map((x) => x.item),
        factorsFor: (name, v1) => {
          const x = byName.get(name);
          return x?.facts && x.s
            ? mergeFactors(substituteFactors(q, x.facts, x.s, opts), v1)
            : [...(v1 ?? [])];
        },
      };
    },
  };
}

// ── Swap this card ─────────────────────────────────────────────────────────

interface SwapLike {
  name: string;
  ownership?: ChangeOwnership;
  inclusion?: number;
  whyFactors?: WhyFactor[];
}

/**
 * Same-role alternatives for the card being looked at, owned first, then by
 * how well each replaces it, then EDHREC inclusion. Null → keep v1's order.
 */
export function rankSwapAlternatives<T extends SwapLike>(
  focused: string,
  taggerRole: string | null,
  alternatives: readonly T[],
  deckNames: readonly string[]
): T[] | null {
  if (!substituteRankingReady()) return null;
  const q = getCardFacts(focused);
  if (!q) return null;
  const role = roleForTaggerRole(q, taggerRole);
  const scored = scoreAll(q, alternatives, (a) => a.name, role, deckProfileFor(deckNames, focused));
  scored.sort(
    (a, b) =>
      ownershipRank(a.item.ownership) - ownershipRank(b.item.ownership) ||
      scoreOf(b) - scoreOf(a) ||
      (b.item.inclusion ?? -1) - (a.item.inclusion ?? -1) ||
      a.index - b.index
  );
  const opts: FactorOptions = { mana: 'all', edhrec: true };
  return scored.map(({ item, facts, s }) =>
    facts && s
      ? { ...item, whyFactors: mergeFactors(substituteFactors(q, facts, s, opts), item.whyFactors) }
      : item
  );
}

// ── Similar cards ──────────────────────────────────────────────────────────

/** A Similar cards row ranked by v2: `score` orders rows and means nothing on its own. */
export interface RankedSimilar extends SimilarCandidate {
  whyFactors?: WhyFactor[];
}

const isLand = (typeLine: string | undefined) => /\bLand\b/.test(typeLine ?? '');

/**
 * The strip's rows by v2, from the pool it already sourced: owned first (as
 * v1), then by score; a card under SIMILAR_FLOOR doesn't replace the target
 * well enough to show. Lands only stand in for lands, as in the finder.
 */
export function rankSimilarCards(
  target: ScryfallCard,
  pool: readonly SimilarInput[],
  opts: { identity?: string[]; maxResults?: number; deckNames: readonly string[] }
): RankedSimilar[] | null {
  if (!substituteRankingReady()) return null;
  const q = getCardFacts(target);
  if (!q) return null;
  const seen = new Set<string>([target.name.toLowerCase()]);
  const eligible = pool.filter((cand) => {
    const key = cand.card.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    if (opts.identity?.length && !withinColorIdentity(cand.card, opts.identity)) return false;
    return isLand(cand.card.type_line) === isLand(target.type_line);
  });
  const deck = deckProfileFor(opts.deckNames, target.name);
  const scored = scoreAll(q, eligible, (c) => c.card, primaryRole(q), deck)
    .filter((x) => x.s && x.s.score >= SIMILAR_FLOOR)
    .sort(
      (a, b) =>
        ownershipRank(a.item.ownership) - ownershipRank(b.item.ownership) ||
        scoreOf(b) - scoreOf(a) ||
        (b.item.inclusion ?? -1) - (a.item.inclusion ?? -1) ||
        a.item.card.name.localeCompare(b.item.card.name)
    )
    .slice(0, opts.maxResults ?? 6);
  const targetAxes = axisKeys(target);
  const factorOpts: FactorOptions = { mana: 'all', edhrec: true };
  return scored.map(({ item, facts, s }) => ({
    name: item.card.name,
    card: item.card,
    score: s!.score,
    ownership: item.ownership,
    freeCount: item.freeCount,
    inclusion: item.inclusion,
    sharedAxes: sharedAxisNames(targetAxes, axisKeys(item.card)),
    whyFactors: substituteFactors(q, facts!, s!, factorOpts),
  }));
}
