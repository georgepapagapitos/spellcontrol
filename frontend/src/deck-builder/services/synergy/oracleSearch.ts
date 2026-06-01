/**
 * Scryfall oracle-search candidate sourcing — the genuinely-off-meta half of
 * the suggester's input. The off-meta suggester (suggest.ts) promises cards
 * "the crowd hasn't aggregated", but its only candidate pool used to be the
 * EDHREC long tail — which is, by definition, crowd-aggregated. This module
 * closes that gap: per synergy *need*, it builds a broad Scryfall oracle query
 * (a recall net — `classifyCard` enforces precision downstream) and, given the
 * hits, keeps only cards EDHREC never surfaced for this commander.
 *
 * The pure pieces live here (query map + off-meta selection/dedup); the live
 * `searchCards` call stays in the orchestrator. Isomorphic, zero side effects.
 */
import type { CardLike } from './text';
import type { AxisKey } from './axes';
import type { SynergyNeed, SynergyCandidate, AxisSide } from './suggest';

/**
 * Per-axis, per-side Scryfall oracle queries. Deliberately *broad* — recall
 * nets, not precise filters: every hit is re-classified by `classifyCard` in
 * the suggester, so a query only needs to cast a wide-enough net over the right
 * templating. `searchCards` wraps this in parens and appends the deck's color
 * filter + `f:commander`, so OR clauses and `keyword:`/`o:`/`t:` operators are
 * all safe here. `null` = no reliable text query for that side (skip it).
 */
const AXIS_QUERIES: Record<AxisKey, Record<AxisSide, string | null>> = {
  tokens: {
    producer: 'o:"create" o:"creature token"',
    payoff:
      '(o:"whenever a creature enters" or o:"creatures you control get" or o:"populate" or keyword:convoke)',
  },
  counters: {
    producer: 'o:"+1/+1 counter"',
    payoff: '(o:"for each +1/+1 counter" or o:"twice that many")',
  },
  sacrifice: {
    producer: 'o:"sacrifice a creature"',
    payoff: '(o:"a creature you control dies" or o:"another creature you control dies")',
  },
  lifegain: {
    producer: '(keyword:lifelink or o:"you gain" o:life)',
    payoff: 'o:"whenever you gain life"',
  },
  landfall: {
    producer: '(o:"additional land" or o:"put" o:"land" o:"onto the battlefield")',
    payoff: '(keyword:landfall or o:"whenever a land enters")',
  },
  graveyard: {
    producer: '(keyword:mill or o:"into your graveyard" or keyword:surveil)',
    payoff:
      '(o:"from your graveyard" or o:"creature card in a graveyard" or keyword:flashback or keyword:escape)',
  },
  artifacts: {
    producer: '(o:"artifact token" or o:treasure or keyword:fabricate)',
    payoff:
      '(o:"whenever an artifact" or o:"for each artifact you control" or keyword:affinity or keyword:metalcraft)',
  },
  equipment: {
    producer: 't:equipment',
    payoff: '(o:"equipment you control" or o:"whenever an equipment" or o:"equipment card")',
  },
  spellslinger: {
    producer:
      '(o:"instant and sorcery spells you cast cost" or o:"copy target instant or sorcery")',
    payoff: '(keyword:magecraft or keyword:prowess or o:"whenever you cast an instant or sorcery")',
  },
  enchantress: {
    producer:
      '(o:"enchantment spells you cast cost" or o:"return target enchantment card" or o:"search your library for an enchantment")',
    payoff: '(keyword:constellation or o:"whenever you cast an enchantment")',
  },
  superfriends: {
    producer: '(t:planeswalker or keyword:proliferate or o:"planeswalker card")',
    payoff:
      '(o:"planeswalker you control" or o:"for each planeswalker" or o:"loyalty abilities" or o:"planeswalker spell")',
  },
  tribal: {
    producer: '(o:"choose a creature type" or keyword:changeling or o:"every creature type")',
    payoff: '(o:"of the chosen type" or o:"shares a creature type" or o:"creature type with it")',
  },
};

/** The Scryfall oracle query for one need, or null if no reliable query exists. */
export function axisSearchQuery(axis: AxisKey, side: AxisSide): string | null {
  return AXIS_QUERIES[axis]?.[side] ?? null;
}

/** A need paired with the raw Scryfall hits its query returned. */
export interface OracleNeedResult {
  need: SynergyNeed;
  cards: CardLike[];
}

export interface SelectOracleOptions {
  /** `cardName(lowercased) → EDHREC inclusion %` for this commander. */
  edhrecInclusion: Map<string, number>;
  /** Lowercased names already in the deck (commanders included). */
  inDeck: Set<string>;
  /** Max kept per need. */
  perNeed?: number;
  /** Max kept overall (across all needs). */
  maxTotal?: number;
  /**
   * A card is "off-meta" if EDHREC never surfaced it for this commander *or*
   * surfaced it below this inclusion %. The EDHREC candidate source already
   * covers the [2, 35] window, so the default (2) makes this source strictly
   * additive — it fills the sub-2% / never-aggregated gap the crowd missed.
   */
  offMetaFloor?: number;
}

const DEFAULT_PER_NEED = 6;
const DEFAULT_MAX_TOTAL = 24;
const DEFAULT_OFFMETA_FLOOR = 2;

/**
 * From the raw per-need Scryfall hits, keep only genuinely off-meta cards: not
 * in the deck, not consensus for this commander (absent from EDHREC's list, or
 * below the off-meta floor), deduped across needs. Returned as candidates with
 * `inclusion` left undefined so the suggester treats them as off-meta backfill
 * (they bypass its inclusion window and rank behind validated EDHREC fills).
 */
export function selectOracleCandidates(
  results: OracleNeedResult[],
  opts: SelectOracleOptions
): SynergyCandidate[] {
  const perNeed = opts.perNeed ?? DEFAULT_PER_NEED;
  const maxTotal = opts.maxTotal ?? DEFAULT_MAX_TOTAL;
  const floor = opts.offMetaFloor ?? DEFAULT_OFFMETA_FLOOR;

  const used = new Set<string>();
  const out: SynergyCandidate[] = [];

  for (const { cards } of results) {
    if (out.length >= maxTotal) break;
    let kept = 0;
    for (const card of cards) {
      if (out.length >= maxTotal || kept >= perNeed) break;
      const lower = card.name.toLowerCase();
      if (used.has(lower) || opts.inDeck.has(lower)) continue;
      const incl = opts.edhrecInclusion.get(lower);
      // Off-meta iff EDHREC never aggregated it here, or did so below the floor.
      if (incl != null && incl >= floor) continue;
      used.add(lower);
      out.push({ card });
      kept++;
    }
  }
  return out;
}
