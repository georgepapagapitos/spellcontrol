import { logger } from '@/lib/logger';
import type { DeckCategory, LiftPackagePick, ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
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
 *  identity, legality, rarity, Arena-only, CMC cap, or the per-card budget
 *  cap. Returns the reason it was rejected, or undefined if it survives. */
function rejectionReason(card: ScryfallCard, state: GenerationState): FilterReason | undefined {
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
  return undefined;
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
export async function liftPicksPhase(state: GenerationState): Promise<LiftPicksResult | undefined> {
  if (!state.edhrecData) return undefined;

  try {
    const nonLandCards = (Object.keys(state.categories) as DeckCategory[])
      .filter((cat) => cat !== 'lands')
      .flatMap((cat) => state.categories[cat]);

    const seeds = collectSeeds(state, nonLandCards);
    if (seeds.length === 0) return undefined;

    const seedPools = await ensureLiftPools(state, seeds);
    if (seedPools.size === 0) return undefined;

    const excludeNames = new Set<string>(state.usedNames);
    for (const name of state.bannedCards) excludeNames.add(name);

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
    };
    const survivors: LiftCandidate[] = [];
    for (const candidate of topCandidates) {
      const card = cardMap.get(candidate.name);
      if (!card) continue; // unresolvable — drop silently, not a constraint rejection
      const reason = rejectionReason(card, state);
      if (reason) {
        filterCounts[reason]++;
        continue;
      }
      survivors.push(candidate);
    }

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

    logger.debug(
      `[DeckGen] Lift picks: ${packagePicks.length} suggested from ${seedPools.size} seeds`
    );

    return { packagePicks, liftPicksNote };
  } catch (error) {
    logger.error('[DeckGen] Lift picks phase failed:', error);
    return undefined;
  }
}
