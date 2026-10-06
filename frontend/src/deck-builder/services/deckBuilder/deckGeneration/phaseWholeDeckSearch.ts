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
// The candidates are every card this generation fetched (the EDHREC pool,
// the fills and the owned cards it resolved) that clears the gates the
// pick-time path enforces and the objective doesn't know about: the phases' own vetoes
// (state.bannedCards, so a card a repair cut for a reason that still holds
// isn't swapped back), the salt cap, the synergy-dependency gate and the CMC
// cap. The objective checks the rest (identity, legality, bans, rarity,
// price and budget, Arena, the owned-card rules, bracket ceilings and the
// combo floor) on every move.
//
// An owned-card rule the generator shipped relaxed and disclosed (an unowned
// card in an owned-only build, a partial build under its share) is left as it
// is: the search is never stricter than the generator (E513 round 3).
import type { DetectedCombo, Pacing, ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { routeCardByType, stampRoleSubtypes } from '../categorize';
import { countedRoleOf } from '../commanderDeckAnalysis';
import { exceedsCmcCap } from '../deckFilters';
import { createObjectiveContext } from '../deckObjective';
import { checkConstraints } from '../deckObjective/constraints';
import { optimizeDeck, type AppliedSwap } from '../deckObjective/optimizer';
import { countRoles } from '../deckObjective/trustRegion';
import { edhrecRowsFrom } from '../deckObjective/panelDump';
import { markBanned, type GenerationState } from './state';

/** The ownership checks. */
const OWNED_RULES = new Set(['collection', 'owned-share']);

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
  /** Owned cards by collection name (the generator's resolveOwned). */
  resolveOwned?: (names: string[]) => Promise<Map<string, ScryfallCard>>;
  /** The cards the generator's role-surplus rebalance cut: the roles it trimmed stay trimmed. */
  surplusCuts?: readonly string[];
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

/**
 * The swap's reasons as the report states them: its biggest three, in words,
 * and always a case FOR each card that came in (its best gain, when it has
 * one): Vexing Puzzlebox and Rise of the Dark Realms were stated only by what
 * the cards they replaced had provided (E513 round 3).
 */
export function reasonLine(s: AppliedSwap): string {
  const top3 = s.reasons.slice(0, 3);
  const cases = s.in.flatMap((name) => {
    if (top3.some((r) => r.name === name && r.value > 0)) return [];
    const gain = s.reasons.find((r) => r.name === name && r.value > 0);
    return gain ? [gain] : [];
  });
  const shown = [...top3.slice(0, Math.max(0, 3 - cases.length)), ...cases];
  const top = shown.map((r) => `${r.name}: ${r.note}`).join('; ');
  const outside = s.disclosure ? ` Outside the usual limits, because ${s.disclosure}.` : '';
  return `${s.in.join(' + ')} for ${s.out.join(' + ')}${s.kind === 'repair' ? ' (to keep a build rule)' : ''}. ${top}.${outside}`;
}

export async function wholeDeckSearchPhase(
  state: GenerationState,
  input: WholeDeckSearchInput
): Promise<WholeDeckSearchResult> {
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
  const passesGates = (c: ScryfallCard) =>
    !state.bannedCards.has(c.name) &&
    !input.isSaltBlocked?.(c.name) &&
    (input.cardAllowed?.(c) ?? true) &&
    !exceedsCmcCap(c, input.maxCmc);
  const candidates = [...input.scryfallCardMap.values()].filter(passesGates);
  // An ownership rule the generator shipped relaxed, and disclosed (the
  // collectionRelaxedNames of an owned-only build, the gap under a partial
  // share), is left as it is: the search is never stricter than the generator.
  // Its improving swaps still run, and may not make the shortfall worse.
  const leave = new Set(
    checkConstraints(seed, ctx)
      .filter((v) => OWNED_RULES.has(v.check))
      .map((v) => v.check)
  );
  // The generator's own protections: must-includes (the customization's are
  // the search's too), a partial build's owned quota.
  const locks = seed.cards
    .filter((c) => c.isMustInclude || state.cfg.ownedQuotaProtects?.(c.name))
    .map((c) => c.name);
  // A role the rebalance trimmed (a disclosed conversion) is capped at the
  // count it left: the search may not fill it again.
  const seedRoles = countRoles(seed, countedRoleOf);
  const roleCeilings: Record<string, number> = {};
  for (const name of input.surplusCuts ?? []) {
    const role = countedRoleOf(input.scryfallCardMap.get(name) ?? ({ name } as ScryfallCard));
    if (role) roleCeilings[role] = seedRoles[role] ?? 0;
  }
  const result = optimizeDeck(seed, candidates, ctx, {
    locks,
    leave,
    trust: { roleCeilings },
  });

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
