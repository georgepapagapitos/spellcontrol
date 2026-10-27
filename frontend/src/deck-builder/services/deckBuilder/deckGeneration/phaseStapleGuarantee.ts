// E1043: the staple rocks, guaranteed on the finished deck. stapleManaRocksPhase
// seats them mid-build against the per-card pacing cap, and on a total budget
// that cap can fall under Sol Ring's price before the phase runs: at $25, 6 of
// 10 commanders shipped without Sol Ring and no note said so. Moving the seat
// earlier changed every later pass's path and failed the ship gate on decks
// that already had Sol Ring, so this runs LAST (after the whole-deck search)
// and changes one card: the staple in, the weakest card out, disclosed.
//
// Only the user's own limits keep a staple out here: format legality, the max
// card price, rarity/CMC/Arena caps, collection mode, and a total budget the
// rock would take more than STAPLE_MAX_BUDGET_SHARE of.
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { getByCardName } from '@/lib/cards/card-text';
import type {
  CoherenceRepair,
  DeckCategory,
  DetectedCombo,
  ScryfallCard,
} from '@/deck-builder/types';
import {
  constrainsToCollection,
  exceedsCmcCap,
  exceedsMaxPrice,
  exceedsMaxRarity,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notInCollection,
  notLegalForFormat,
  notOnArena,
} from '../deckFilters';
import { categorizeCards, stampRoleSubtypes } from '../categorize';
import type { BudgetTracker } from '../budgetTracker';
import { evictionKeeper } from './evictionKeeper';
import { refreshComboCompleteness } from './phaseDetectCombos';
import { STAPLE_ROCKS, STAPLE_ROCK_NAMES } from './phaseStapleManaRocks';
import { markBanned, markUsed, protectedMustIncludeNames, type GenerationState } from './state';

/** A staple rock is guaranteed on a total budget when it costs at most this share of it. */
export const STAPLE_MAX_BUDGET_SHARE = 0.2;

/** The generator's hook: run the guarantee, disclose its swaps with the
 *  coherence repairs, and return the combo list refreshed for the swap. */
export async function guaranteeStaples(
  state: GenerationState,
  budgetTracker: BudgetTracker | null,
  detectedCombos: DetectedCombo[] | undefined,
  repairs: CoherenceRepair[]
): Promise<DetectedCombo[] | undefined> {
  const swaps = await stapleGuaranteePhase(state, budgetTracker);
  if (swaps.length === 0) return detectedCombos;
  repairs.push(...swaps);
  return refreshComboCompleteness(detectedCombos, state);
}

export async function stapleGuaranteePhase(
  state: GenerationState,
  budgetTracker: BudgetTracker | null
): Promise<CoherenceRepair[]> {
  const { cfg, context, categories, usedNames } = state;
  if (cfg.format !== 99 || !state.edhrecData) return [];
  const repairs: CoherenceRepair[] = [];
  const inclusion = new Map<string, number>();
  for (const c of state.edhrecData.cardlists.allNonLand) inclusion.set(c.name, c.inclusion);
  const mustInclude = protectedMustIncludeNames(state);

  for (const staple of STAPLE_ROCKS) {
    if (context.colorIdentity.length < staple.minColors) continue;
    if (usedNames.has(staple.name) || state.bannedCards.has(staple.name)) continue;
    if (
      constrainsToCollection(cfg.collectionStrategy) &&
      notInCollection(staple.name, context.collectionNames)
    )
      continue;
    let card: ScryfallCard;
    try {
      card = await getCardByName(staple.name, cfg.arenaOnly);
    } catch {
      continue; // stapleManaRocksPhase already logged a fetch failure
    }
    if (notLegalForFormat(card, cfg.mtgFormat) || notOnArena(card, cfg.arenaOnly)) continue;
    if (exceedsCmcCap(card, cfg.maxCmc)) continue;
    if (
      !isOwnedRarityExempt(staple.name, context.collectionNames, cfg.ignoreOwnedRarity) &&
      exceedsMaxRarity(card, cfg.maxRarity)
    )
      continue;
    if (!isOwnedBudgetExempt(staple.name, context.collectionNames, cfg.ignoreOwnedBudget)) {
      const budgetCap =
        cfg.deckBudget != null ? cfg.deckBudget * STAPLE_MAX_BUDGET_SHARE : Infinity;
      if (exceedsMaxPrice(card, Math.min(cfg.maxCardPrice ?? Infinity, budgetCap), cfg.currency))
        continue;
    }

    const victim = weakestNonland(state, inclusion, mustInclude);
    if (!victim) continue;
    categories[victim.category] = categories[victim.category].filter((c) => c !== victim.card);
    usedNames.delete(victim.card.name);
    const cutRole = getCardRole(victim.card.name);
    if (cutRole && state.currentRoleCounts[cutRole] > 0) state.currentRoleCounts[cutRole]--;
    markBanned(state, victim.card.name);

    card.isStapleRock = true;
    markUsed(state, card.name);
    categorizeCards([card], categories);
    const role = getCardRole(card.name);
    if (role) {
      state.currentRoleCounts[role]++;
      card.deckRole = role;
      stampRoleSubtypes(card);
    }
    if (!isOwnedBudgetExempt(card.name, context.collectionNames, cfg.ignoreOwnedBudget)) {
      budgetTracker?.deductCard(card);
    }
    repairs.push({
      cut: victim.card.name,
      added: card.name,
      reason: `Swapped ${victim.card.name} for ${card.name}, a staple rock nearly every Commander deck runs.`,
    });
  }
  return repairs;
}

/** The lowest-inclusion nonland card nothing protects, a ramp card first so
 *  the rock takes a ramp slot. */
function weakestNonland(
  state: GenerationState,
  inclusion: ReadonlyMap<string, number>,
  mustInclude: ReadonlySet<string>
): { card: ScryfallCard; category: DeckCategory } | null {
  const keeps = evictionKeeper(state);
  let best: { card: ScryfallCard; category: DeckCategory; ramp: boolean; incl: number } | null =
    null;
  for (const category of Object.keys(state.categories) as DeckCategory[]) {
    if (category === 'lands') continue;
    for (const card of state.categories[category]) {
      if (mustInclude.has(card.name.toLowerCase()) || STAPLE_ROCK_NAMES.has(card.name)) continue;
      if (state.cfg.ownedQuotaProtects?.(card.name)) continue;
      if (keeps(card)) continue;
      const ramp = getCardRole(card.name) === 'ramp';
      const incl = getByCardName(inclusion, card.name) ?? 0;
      if (!best || (ramp && !best.ramp) || (ramp === best.ramp && incl < best.incl)) {
        best = { card, category, ramp, incl };
      }
    }
  }
  return best ? { card: best.card, category: best.category } : null;
}
