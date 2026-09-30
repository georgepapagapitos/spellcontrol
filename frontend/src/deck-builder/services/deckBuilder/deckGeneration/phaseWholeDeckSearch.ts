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
// When the finished list breaks an owned-card rule (an unowned card in an
// owned-only build, a partial build under its owned share), the repair has
// to bring in an owned card, and the fetched cards hold few of them: the
// EDHREC page offered an owned-only Lathril 20 eligible cards, most already
// seated, so Swiftfoot Boots and Lightning Greaves stayed with nothing owned
// to replace them. So the rest of the collection that fits the deck is
// resolved first, as the partial fill's third tier does, and the search
// picks the least damaging owned card for the slot, one of the same role
// first. Those cards have no page evidence for this commander, so they come
// in only as repairs, never to improve (Soul Net took an owned-only Isshin's
// Blasphemous Act slot that way).
import type { DetectedCombo, Pacing, ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { routeCardByType, stampRoleSubtypes } from '../categorize';
import { countedRoleOf } from '../commanderDeckAnalysis';
import { exceedsCmcCap } from '../deckFilters';
import { createObjectiveContext } from '../deckObjective';
import { cardIneligibility, checkConstraints } from '../deckObjective/constraints';
import { isLandCard } from '../deckObjective/context';
import { optimizeDeck, repairSlotOf, type AppliedSwap } from '../deckObjective/optimizer';
import type { ObjectiveContext, ObjectiveDeck } from '../deckObjective/types';
import { edhrecRowsFrom } from '../deckObjective/panelDump';
import { markBanned, type GenerationState } from './state';

/** The constraint checks only an owned card can repair. */
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
  const repairOnly = await ownedRepairCandidates(state, seed, ctx, input, candidates, passesGates);
  candidates.push(...repairOnly.values());
  // The generator's own protections: must-includes (the customization's are
  // the search's too), a partial build's owned quota.
  const locks = seed.cards
    .filter((c) => c.isMustInclude || state.cfg.ownedQuotaProtects?.(c.name))
    .map((c) => c.name);
  const result = optimizeDeck(seed, candidates, ctx, {
    locks,
    repairOnly: new Set(repairOnly.keys()),
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

/** Owned replacements per slot a repair needs, and for any slot: enough to
 *  choose from, few enough that the search stays quick. */
const OWNED_PER_SLOT = 12;
const OWNED_ANY_SLOT = 24;

/**
 * The owned cards a repair may bring in, by name: none unless the list breaks
 * an owned-card rule. The collection's fitting cards are resolved, and kept
 * are the most-played (EDHREC rank) of each slot the cards to replace fill
 * (their counted role, a protection piece, a land) plus the most-played of
 * any slot.
 */
async function ownedRepairCandidates(
  state: GenerationState,
  seed: ObjectiveDeck,
  ctx: ObjectiveContext,
  input: WholeDeckSearchInput,
  fetchedAlready: readonly ScryfallCard[],
  passesGates: (c: ScryfallCard) => boolean
): Promise<Map<string, ScryfallCard>> {
  const out = new Map<string, ScryfallCard>();
  const owned = ctx.ownedNames;
  const broken = checkConstraints(seed, ctx).filter((v) => OWNED_RULES.has(v.check));
  if (!input.resolveOwned || !owned || broken.length === 0) return out;
  const { colorIdentity, collectionPool } = state.context;
  const known = new Set([...fetchedAlready, ...seed.cards].map((c) => c.name));
  const rest = (collectionPool ?? []).filter(
    (c) =>
      !known.has(c.name) &&
      !state.bannedCards.has(c.name) &&
      c.colorIdentity.every((x) => colorIdentity.includes(x))
  );
  if (rest.length === 0) return out;
  // The cards a repair takes out: the unowned ones a violation names, or,
  // under an owned share, every unowned spell.
  const named = new Set(broken.flatMap((v) => v.cards));
  const shareBroken = broken.some((v) => v.check === 'owned-share');
  const isOwned = (c: ScryfallCard) => owned.has(c.name) || owned.has(frontFaceName(c.name));
  const toReplace = seed.cards.filter(
    (c) => named.has(c.name) || (shareBroken && !isLandCard(c) && !isOwned(c))
  );
  const slotKey = (c: ScryfallCard) =>
    isLandCard(c) ? 'land' : (repairSlotOf(c, ctx, countedRoleOf) ?? 'any');
  const needed = new Set(toReplace.map(slotKey));

  const fetched = await input.resolveOwned(rest.map((c) => c.name));
  const fits = [...new Set(fetched.values())]
    .filter((c) => !known.has(c.name) && passesGates(c) && !cardIneligibility(c, ctx))
    .sort((a, b) => (a.edhrec_rank ?? Infinity) - (b.edhrec_rank ?? Infinity));
  const perSlot = new Map<string, number>();
  let anySlot = 0;
  for (const c of fits) {
    const k = slotKey(c);
    const n = perSlot.get(k) ?? 0;
    const keepForSlot = needed.has(k) && n < OWNED_PER_SLOT;
    const keepForAny = k !== 'land' && anySlot < OWNED_ANY_SLOT;
    if (!keepForSlot && !keepForAny) continue;
    if (keepForSlot) perSlot.set(k, n + 1);
    else anySlot++;
    out.set(c.name, c);
  }
  return out;
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
