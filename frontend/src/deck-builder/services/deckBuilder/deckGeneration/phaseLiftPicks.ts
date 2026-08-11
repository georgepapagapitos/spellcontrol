import { logger } from '@/lib/logger';
import type { DeckCategory, LiftPackagePick, ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames, upgradeCardPrintings } from '@/deck-builder/services/scryfall/client';
import { aggregateLiftCandidates, selectTopLiftPicks, type LiftCandidate } from '../liftSynergy';
import {
  fitsColorIdentity,
  notCommanderLegal,
  exceedsMaxRarity,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
  exceedsMaxPrice,
  isOwnedBudgetExempt,
} from '../deckFilters';
import type { GenerationState } from './state';
import { ensureLiftPools, MAX_LIFT_SEEDS } from './liftPools';
import { BracketGuard, bracketCeilings, ceilingsAreOpen } from '../bracketGuard';

const MAX_CANDIDATES = 24;
const MAX_PICKS = 4;

export interface LiftPicksResult {
  packagePicks: LiftPackagePick[];
  liftPicksNote?: string;
}

const FILTER_REASON_LABELS = {
  offColor: 'off-color',
  legal: 'not legal in Commander',
  rarity: 'over rarity cap',
  arena: 'not on Arena',
  cmc: 'over mana-value cap',
  budget: 'over budget cap',
  salt: 'over salt tolerance',
  filter: 'outside your card filters',
  bracket: 'over your target bracket',
} as const;

type FilterReason = keyof typeof FILTER_REASON_LABELS;

function buildDisclosureNote(counts: Record<FilterReason, number>): string | undefined {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return undefined;
  const [dominant] = (Object.entries(counts) as [FilterReason, number][]).sort(
    (a, b) => b[1] - a[1]
  );
  return `${total} higher-lift candidate${total === 1 ? '' : 's'} hidden: ${FILTER_REASON_LABELS[dominant[0]]}`;
}

/** Seed cards for the lift lookup: commander(s) first, then theme-synergy
 *  cards, then must-includes, then the rest of the deck in category order.
 *  Deduped, capped at MAX_LIFT_SEEDS (each seed costs one throttled EDHREC
 *  fetch — shared across the whole generation, see deckGeneration/liftPools). */
function collectSeeds(state: GenerationState, nonLandCards: ScryfallCard[]): string[] {
  const seeds: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined) => {
    if (!name || seen.has(name) || seeds.length >= MAX_LIFT_SEEDS) return;
    seen.add(name);
    seeds.push(name);
  };

  add(state.context.commander.name);
  add(state.context.partnerCommander?.name);
  for (const c of nonLandCards) if (c.isThemeSynergyCard) add(c.name);
  for (const name of state.mustIncludeNames) add(name);
  for (const c of nonLandCards) add(c.name);

  return seeds;
}

/** Hard-filters a lift candidate against every active generation constraint —
 *  the same gates the EDHREC-pool picking / Scryfall-fallback paths enforce
 *  (deckFilters.ts), so a "hidden synergy" suggestion can never bypass color
 *  identity, legality, rarity, Arena-only, CMC cap, the per-card budget cap,
 *  or the salt tolerance. (The user's Scryfall filter / alt-mode constraint
 *  is enforced separately via a strict printing upgrade in liftPicksPhase —
 *  it needs the whole batch, not one card.) Returns the reason it was
 *  rejected, or undefined if it survives. */
function rejectionReason(
  card: ScryfallCard,
  state: GenerationState,
  isSaltBlocked?: (name: string) => boolean,
  bracketGuard?: BracketGuard
): FilterReason | undefined {
  if (!fitsColorIdentity(card, state.context.colorIdentity)) return 'offColor';
  if (notCommanderLegal(card)) return 'legal';
  if (
    !isOwnedRarityExempt(card.name, state.context.collectionNames, state.cfg.ignoreOwnedRarity) &&
    exceedsMaxRarity(card, state.cfg.maxRarity)
  )
    return 'rarity';
  if (notOnArena(card, state.cfg.arenaOnly)) return 'arena';
  if (exceedsCmcCap(card, state.cfg.maxCmc)) return 'cmc';
  if (
    !isOwnedBudgetExempt(card.name, state.context.collectionNames, state.cfg.ignoreOwnedBudget) &&
    exceedsMaxPrice(card, state.cfg.maxCardPrice, state.cfg.currency)
  )
    return 'budget';
  if (isSaltBlocked?.(card.name)) return 'salt';
  // E104: the seating path (cardPicking/scryfallFill/auditAdd) never lets a
  // Game Changer/MLD/extra-turn/stax signal push a bracket-capped deck past
  // its ceiling — this advisory surface was the one add-adjacent path that
  // didn't check it, so it could advertise a pick the deck could never
  // actually run at the user's target bracket. Same BracketGuard, same
  // ceilings — no separate list.
  if (bracketGuard?.exceedsCeiling(card.name)) return 'bracket';
  return undefined;
}

export interface LiftPicksOptions {
  /** The generation's EFFECTIVE Scryfall filter — the user's query plus any
   *  alt-mode constraint deckGenerator appended (historical year, permanents-
   *  only, otag/arttag). Enforced strictly on candidates so a package pick
   *  can never fall outside the pool's own filter. */
  effectiveScryfallQuery?: string;
  /** Salt hard gate built in deckGenerator (undefined = no cap active). */
  isSaltBlocked?: (name: string) => boolean;
  /** Extra names to exclude beyond the current `state.usedNames` — e.g. cards
   *  the late swap phases (combo audit, fixup, coherence repair, bracket
   *  convergence) cut this same generation. Without this, a card cut for
   *  being weak can immediately resurface as a "hidden synergy" suggestion. */
  extraExcludeNames?: Set<string>;
}

/**
 * Generation-time "hidden synergy" package picks: cards not in the EDHREC
 * pool for this commander but strongly co-played with cards already in the
 * deck, per EDHREC's per-card "lift" data (see liftSynergy.ts). Suggestions
 * only — never added to the deck, never influence themes. Constraints are
 * non-negotiable: every survivor still has to clear the same color-identity/
 * legality/rarity/Arena/CMC/budget gates as everything else in the deck.
 *
 * Soft-fails to no picks (network issues, no EDHREC data, nothing survives
 * the filters) — generation always continues.
 */
interface LiftResolution {
  /** Candidates that cleared every gate, in aggregateLiftCandidates order. */
  survivors: LiftCandidate[];
  cardMap: Map<string, ScryfallCard>;
  filterCounts: Record<FilterReason, number>;
}

/**
 * Shared front half of the lift pipeline: collect seeds from the deck as it
 * currently stands, fetch (or reuse) their EDHREC card-page co-play pools,
 * aggregate candidates, resolve real Scryfall cards, and run the full gate
 * gauntlet. Extracted so the SEATING caller (which inserts, and therefore has
 * to run before Bracket Convergence) and the SUGGESTION caller (which runs
 * last, after every mutating phase) share one implementation of "which
 * off-pool co-play candidates are legal in this deck".
 *
 * `ensureLiftPools` caches per generation, so the second caller re-uses the
 * first one's fetched pools — running both costs one set of EDHREC requests,
 * not two.
 */
async function resolveLiftCandidates(
  state: GenerationState,
  opts: LiftPicksOptions
): Promise<LiftResolution | undefined> {
  const nonLandCards = (Object.keys(state.categories) as DeckCategory[])
    .filter((cat) => cat !== 'lands')
    .flatMap((cat) => state.categories[cat]);

  // Same ceiling the seating path enforces (cardPicking/scryfallFill/
  // auditAdd), seeded with the deck as it actually shipped so a candidate
  // is only rejected if it would push a signal already at the ceiling over
  // the top — undefined (no-op) when no bracket is targeted or the target
  // is high enough that nothing binds.
  const bracketCeil = bracketCeilings(state.cfg.targetBracket);
  const bracketGuard = ceilingsAreOpen(bracketCeil)
    ? undefined
    : new BracketGuard(bracketCeil, state.gameChangerNames);
  if (bracketGuard) {
    for (const c of nonLandCards) bracketGuard.record(c.name);
  }

  const seeds = collectSeeds(state, nonLandCards);
  if (seeds.length === 0) return undefined;

  const seedPools = await ensureLiftPools(state, seeds);
  if (seedPools.size === 0) return undefined;

  const excludeNames = new Set<string>(state.usedNames);
  for (const name of state.bannedCards) excludeNames.add(name);
  for (const name of opts.extraExcludeNames ?? []) excludeNames.add(name);

  const candidates = aggregateLiftCandidates(seedPools, { excludeNames });
  if (candidates.length === 0) return undefined;

  const topCandidates = candidates.slice(0, MAX_CANDIDATES);
  const cardMap = await getCardsByNames(
    topCandidates.map((c) => c.name),
    undefined,
    state.cfg.preferredSet
  );

  const filterCounts: Record<FilterReason, number> = {
    offColor: 0,
    legal: 0,
    rarity: 0,
    arena: 0,
    cmc: 0,
    budget: 0,
    salt: 0,
    filter: 0,
    bracket: 0,
  };

  // Lift candidates come from EDHREC card pages, not the query-scoped pool,
  // so the user's Scryfall filter / alt-mode constraint has to be enforced
  // here explicitly. Same strict printing upgrade the EDHREC pool gets in
  // deckGenerator: cards with no printing matching the query are deleted.
  const effectiveQuery = opts.effectiveScryfallQuery?.trim() ?? '';
  if (effectiveQuery && cardMap.size > 0) {
    const before = cardMap.size;
    await upgradeCardPrintings(cardMap, effectiveQuery, true);
    filterCounts.filter += before - cardMap.size;
  }

  const survivors: LiftCandidate[] = [];
  for (const candidate of topCandidates) {
    const card = cardMap.get(candidate.name);
    if (!card) continue; // unresolvable — drop silently, not a constraint rejection
    const reason = rejectionReason(card, state, opts.isSaltBlocked, bracketGuard);
    if (reason) {
      filterCounts[reason]++;
      continue;
    }
    survivors.push(candidate);
  }

  return { survivors, cardMap, filterCounts };
}

export async function liftPicksPhase(
  state: GenerationState,
  opts: LiftPicksOptions = {}
): Promise<LiftPicksResult | undefined> {
  if (!state.edhrecData) return undefined;

  try {
    const resolved = await resolveLiftCandidates(state, opts);
    if (!resolved) return undefined;
    const { survivors, filterCounts } = resolved;

    // Only worth disclosing what the filters hid when picks actually surface —
    // an empty result with a lone "N hidden" footnote has nothing to anchor to.
    const picks = selectTopLiftPicks(survivors, { max: MAX_PICKS });
    if (picks.length === 0) return undefined;
    const liftPicksNote = buildDisclosureNote(filterCounts);

    const packagePicks: LiftPackagePick[] = picks.map((p) => ({
      name: p.candidate.name,
      kind: p.kind,
      liftedBy: p.liftedBy,
      lowSample: p.lowSample,
      owned: state.context.collectionNames?.has(p.candidate.name) ?? false,
    }));

    logger.debug(`[DeckGen] Lift picks: ${packagePicks.length} suggested`);

    return { packagePicks, liftPicksNote };
  } catch (error) {
    logger.error('[DeckGen] Lift picks phase failed:', error);
    return undefined;
  }
}

/** Hard cap on lift-seated cards per generation. Half of MAX_PICKS: seating
 *  MUTATES the deck (each seat evicts an incumbent), so it gets a tighter
 *  bound than the suggestion path, which costs the deck nothing. */
export const LIFT_SEAT_MAX = 2;

/** Dial stop at or above which lift seating engages ("Leaning theme" and
 *  "Theme"). Below it the pass is a structural no-op, so the 0.5 Balanced
 *  default — and every build that never touched the dial — is unchanged. */
export const LIFT_SEATING_MIN_BREW = 0.75;

export interface LiftSeatCandidate {
  card: ScryfallCard;
  /** Deck cards whose co-play pulled this candidate in — the disclosure's "why". */
  liftedBy: string[];
}

/**
 * Off-pool candidates for `applyFlagshipSeating`'s injected-candidate path,
 * best-first. Same resolver, same gates, same `selectTopLiftPicks` ranking the
 * suggestion path uses — the only added constraint is that thin-sample
 * candidates are refused a SEAT. A `lowSample` card is fine to propose (the
 * user judges it) but seating one silently swaps a real card out of the 99 on
 * evidence we already flagged as weak, so the bar is higher here.
 *
 * Returns [] on any soft failure — generation always continues.
 */
export async function liftSeatCandidates(
  state: GenerationState,
  opts: LiftPicksOptions = {}
): Promise<LiftSeatCandidate[]> {
  if (!state.edhrecData) return [];
  try {
    const resolved = await resolveLiftCandidates(state, opts);
    if (!resolved) return [];
    const { survivors, cardMap } = resolved;
    return selectTopLiftPicks(
      survivors.filter((c) => !c.lowSample),
      { max: LIFT_SEAT_MAX }
    )
      .map((p) => {
        const card = cardMap.get(p.candidate.name);
        return card ? { card, liftedBy: p.liftedBy } : undefined;
      })
      .filter((c): c is LiftSeatCandidate => !!c);
  } catch (error) {
    logger.error('[DeckGen] Lift seat candidates failed:', error);
    return [];
  }
}
