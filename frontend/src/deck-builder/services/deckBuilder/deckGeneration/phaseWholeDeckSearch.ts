// E513: the whole-deck search as a generation phase, behind
// `customization.wholeDeckSearch` (default off: the phase isn't loaded).
//
// Runs once, after the last phase that changes the deck (the post-refresh
// bracket reconvergence) and BEFORE the build report is assembled, so every
// count, combo list, provenance line and disclosure after it is the
// generator's own, computed for the final list. The search itself
// (deckObjective/optimizer.ts) makes at most a few 1:1 swaps within a slot
// class (a spell for a spell, a land for a land: no land into a spell slot,
// E485) and 2:2 combo seatings, each inside its trust region, and says why.
//
// The candidates are every card this generation fetched (the EDHREC pool and,
// in collection mode, the owned pool) that clears the gates the pick-time
// path enforces and the objective doesn't know about: the phases' own vetoes
// (state.bannedCards, so a card a repair cut for a reason that still holds
// isn't swapped back), the salt cap, the synergy-dependency gate and the CMC
// cap. The objective checks the rest (identity, legality, bans, rarity,
// price and budget, Arena, the owned-card rules, bracket ceilings and the
// combo floor) on every move.
import type { DetectedCombo, Pacing, ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { routeCardByType, stampRoleSubtypes } from '../categorize';
import { countedRoleOf } from '../commanderDeckAnalysis';
import { exceedsCmcCap } from '../deckFilters';
import { createObjectiveContext } from '../deckObjective';
import { optimizeDeck, type AppliedSwap } from '../deckObjective/optimizer';
import { edhrecRowsFrom } from '../deckObjective/panelDump';
import { markBanned, type GenerationState } from './state';

/** What the phase needs besides the state (commanders, customization, colour
 *  identity and the owned names come from state.context). */
export interface WholeDeckSearchInput {
  roleTargets: Record<string, number> | null;
  pacing?: Pacing;
  detectedCombos: DetectedCombo[] | undefined;
  scryfallCardMap: ReadonlyMap<string, ScryfallCard>;
  isSaltBlocked?: (name: string) => boolean;
  cardAllowed?: (card: ScryfallCard) => boolean;
  maxCmc: number | null;
}

/** One swap as the build report records a swap: what left, what came in, and why. */
export interface WholeDeckSwapRecord {
  cut: string;
  added: string;
  reason: string;
}

export interface WholeDeckSearchResult {
  swaps: WholeDeckSwapRecord[];
  /** One line for the report; undefined when the search changed nothing. */
  note: string | undefined;
}

/** The swap's reasons as the report states them: its biggest three, in words. */
function reasonLine(s: AppliedSwap): string {
  const top = s.reasons
    .slice(0, 3)
    .map((r) => `${r.name}: ${r.note}`)
    .join('; ');
  return `${s.in.join(' + ')} for ${s.out.join(' + ')}${s.kind === 'repair' ? ' (to keep a build rule)' : ''}. ${top}.`;
}

export function wholeDeckSearchPhase(
  state: GenerationState,
  input: WholeDeckSearchInput
): WholeDeckSearchResult {
  const {
    commander,
    partnerCommander,
    customization: cz,
    colorIdentity,
    collectionNames,
  } = state.context;
  if (!state.edhrecData || !commander) return { swaps: [], note: undefined };
  const commanders = [commander, partnerCommander].filter((c): c is ScryfallCard => c != null);
  const seed = { commanders, cards: Object.values(state.categories).flat() };
  const rows = edhrecRowsFrom(state.edhrecData);
  const globalRank = new Map<string, number>();
  for (const name of rows.keys()) {
    const rank = input.scryfallCardMap.get(name)?.edhrec_rank;
    if (rank) globalRank.set(name, rank);
  }
  const ctx = createObjectiveContext({
    colorIdentity,
    customization: cz,
    edhrec: rows,
    roleTargets: input.roleTargets ?? {},
    roleOf: countedRoleOf,
    pacing: input.pacing,
    combos: input.detectedCombos ?? [],
    liftPools: state.liftSeedPools,
    globalRank,
    ownedNames: cz.collectionMode && collectionNames ? collectionNames : undefined,
    gameChangerNames: state.gameChangerNames,
  });
  const candidates = [...input.scryfallCardMap.values()].filter(
    (c) =>
      !state.bannedCards.has(c.name) &&
      !input.isSaltBlocked?.(c.name) &&
      (input.cardAllowed?.(c) ?? true) &&
      !exceedsCmcCap(c, input.maxCmc)
  );
  // The generator's own protections: must-includes (the customization's are
  // the search's too), a partial build's owned quota.
  const locks = seed.cards
    .filter((c) => c.isMustInclude || state.cfg.ownedQuotaProtects?.(c.name))
    .map((c) => c.name);
  const result = optimizeDeck(seed, candidates, ctx, { locks });

  const records: WholeDeckSwapRecord[] = [];
  for (const s of result.swaps) {
    s.out.forEach((outName, j) => {
      const inCard = result.deck.cards.find((c) => c.name === s.in[j]);
      if (!inCard) return;
      removeFromDeck(state, outName);
      addToDeck(state, inCard);
      records.push({ cut: outName, added: inCard.name, reason: reasonLine(s) });
    });
  }
  const note =
    records.length === 0
      ? undefined
      : `A whole-deck search made ${result.swaps.length} swap${result.swaps.length === 1 ? '' : 's'} after the build: ${result.swaps
          .map((s) => `${s.in.join(' + ')} for ${s.out.join(' + ')}`)
          .join('; ')}.`;
  return { swaps: records, note };
}

function removeFromDeck(state: GenerationState, name: string): void {
  for (const cards of Object.values(state.categories)) {
    const i = cards.findIndex((c) => c.name === name);
    if (i < 0) continue;
    const [card] = cards.splice(i, 1);
    state.usedNames.delete(card.name);
    if (card.name.includes(' // ')) state.usedNames.delete(frontFaceName(card.name));
    const role = getCardRole(card.name);
    if (role && state.currentRoleCounts[role] > 0) state.currentRoleCounts[role]--;
    if (card.isGameChanger || state.gameChangerNames.has(card.name)) {
      state.gameChangerCount.value = Math.max(0, state.gameChangerCount.value - 1);
    }
    // Nothing after this phase re-picks, but the veto keeps the record true.
    markBanned(state, card.name);
    return;
  }
}

function addToDeck(state: GenerationState, card: ScryfallCard): void {
  stampRoleSubtypes(card);
  if (state.gameChangerNames.has(card.name)) {
    card.isGameChanger = true;
    state.gameChangerCount.value++;
  }
  routeCardByType(card, state.categories);
  state.usedNames.add(card.name);
  if (card.name.includes(' // ')) state.usedNames.add(frontFaceName(card.name));
  const role = getCardRole(card.name);
  if (role) state.currentRoleCounts[role] = (state.currentRoleCounts[role] ?? 0) + 1;
}
