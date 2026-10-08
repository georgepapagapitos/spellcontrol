// E513: the whole-deck search as a generation phase. On unless
// `customization.wholeDeckSearch` is false (wholeDeckSearchStep.ts decides).
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
import { cardIneligibility, checkConstraints } from '../deckObjective/constraints';
import { isBasicLand, isLandCard } from '../deckObjective/context';
import { MAX_SWAPS, repairSlotOf, type AppliedSwap } from '../deckObjective/optimizer';
import { optimizeDeckAsync } from '../deckObjective/optimizerAsync';
import { discover, type DiscoveryPick } from '../deckObjective/discovery';
import { countRoles } from '../deckObjective/trustRegion';
import type { ObjectiveContext, ObjectiveDeck } from '../deckObjective/types';
import { edhrecRowsFrom } from '../deckObjective/panelDump';
import { markBanned, type GenerationState } from './state';
import {
  SEARCH_PROGRESS_MESSAGE,
  SEARCH_PROGRESS_PERCENT,
  SEARCH_PROGRESS_SPAN,
} from './searchProgress';
import { plainDisclosure, swapSentences } from './swapCopy';

/**
 * Cap on the search's WORK time (the waits that let the page paint don't
 * count, so a busy phone isn't cut short by its own yields). The slowest deck
 * of the standard panel needs about 10 s of work on a desktop, so this never
 * bites there; a phone several times slower is stopped at the cap with the
 * swaps it has, each valid on its own and disclosed as usual.
 */

/**
 * The E515 discovery slot is on unless a build says false (default since its
 * pairwise gate passed: 4 improved, 0 regressed over 59 decks, 2026-10-07).
 */
export function discoveryEnabled(customization: { discoveryPicks?: boolean }): boolean {
  return customization.discoveryPicks !== false;
}

export const SEARCH_TIME_BUDGET_MS = 15_000;

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
  /** Overrides SEARCH_TIME_BUDGET_MS (tests). */
  timeBudgetMs?: number;
}

/** One swap as the build report records a swap: what left, what came in, and why. */
export interface WholeDeckSwapRecord {
  cut: string;
  added: string;
  reason: string;
  /** E515: the link that earned a discovery pick its slot; absent on a search swap. */
  discovery?: string;
}

export interface WholeDeckSearchResult {
  swaps: WholeDeckSwapRecord[];
  /** One line for the report; undefined when the search changed nothing. */
  note: string | undefined;
  /** Why the search ended; 'time' means it hit SEARCH_TIME_BUDGET_MS. */
  stoppedBy?: string;
}

/**
 * The swap's reasons as the report states them (swapCopy.ts): why the card
 * that came in, then why the one that left was the weaker pick. The heading
 * above them already says which is which.
 */
export function reasonLine(s: AppliedSwap): string {
  const { why, weaker } = swapSentences(s);
  const outside = s.disclosure
    ? ` Outside the usual limits, because ${plainDisclosure(s.disclosure)}.`
    : '';
  return `${[why, weaker].filter(Boolean).join(' ')}${outside}`;
}

/** A discovery pick's reason: its link first, then what it replaced and why that was filler. */
function discoveryReason(p: DiscoveryPick): string {
  const played =
    p.inclusion === null
      ? 'is not on the commander page'
      : `is in ${Math.round(p.inclusion)}% of the page's decks`;
  return `Discovery pick: ${p.label}. It ${played} but ranks ${p.rank ?? 'unranked'} on EDHREC overall, and the deck scores no worse with it. ${p.cut.name} was filler.`;
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
  // A face-name collision the generator shipped is left alone too (a SOFT
  // invariant it already reports); a move may only not add one.
  // An ownership rule the generator shipped relaxed, and disclosed (the
  // collectionRelaxedNames of an owned-only build, the gap under a partial
  // share), is left as it is: the search is never stricter than the generator.
  // Its improving swaps still run, and may not make the shortfall worse.
  const leave = new Set(
    checkConstraints(seed, ctx)
      .filter((v) => OWNED_RULES.has(v.check) || v.check === 'face-name-collision')
      .map((v) => v.check)
  );
  const offPage = await ownedExtraCandidates(
    state,
    seed,
    ctx,
    input,
    candidates,
    passesGates,
    leave
  );
  // The discovery slot (E515) draws from the cards this generation fetched,
  // not from the owned cards fetched only to repair a rule.
  const discoveryPool = [...candidates];
  candidates.push(...offPage.values());
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
  // Waits for the page every few dozen ms of work and reports how far along it
  // is, from the step's own percent toward (not to) the next milestone.
  let shown = SEARCH_PROGRESS_PERCENT;
  const result = await optimizeDeckAsync(
    seed,
    candidates,
    ctx,
    {
      locks,
      leave,
      offPageOwned: new Set(offPage.keys()),
      landUpgrades: !!ctx.ownedNames,
      trust: { roleCeilings },
      timeBudgetMs: input.timeBudgetMs ?? SEARCH_TIME_BUDGET_MS,
    },
    (beat) => {
      const done = Math.max(beat.evaluations / beat.maxEvaluations, beat.swaps / MAX_SWAPS);
      const pct =
        SEARCH_PROGRESS_PERCENT +
        Math.min(SEARCH_PROGRESS_SPAN, Math.floor(done * SEARCH_PROGRESS_SPAN));
      if (pct > shown) {
        shown = pct;
        state.context.onProgress?.(SEARCH_PROGRESS_MESSAGE, pct);
      }
    }
  );

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
  // E515: the discovery slot, after the search, on the list it left.
  let discoveryNote = '';
  if (discoveryEnabled(cz)) {
    const found = discover(result.deck, discoveryPool, ctx, {
      locks,
      trust: { roleCeilings },
      exclude: new Set(result.swaps.flatMap((s) => s.out)),
    });
    for (const p of found.picks) {
      removeFromDeck(state, p.cut.name);
      addToDeck(state, p.card);
      records.push({
        cut: p.cut.name,
        added: p.card.name,
        reason: discoveryReason(p),
        discovery: p.label,
      });
    }
    if (found.picks.length > 0)
      discoveryNote = `${result.swaps.length > 0 ? ' ' : ''}Discovery picks: ${found.picks.map((p) => `${p.card.name} for ${p.cut.name} (${p.label})`).join('; ')}.`;
  }
  const searchNote =
    result.swaps.length === 0
      ? ''
      : `After the build, a check of the whole list made ${result.swaps.length} swap${result.swaps.length === 1 ? '' : 's'}: ${result.swaps
          .map((s) => `${s.in.join(' + ')} for ${s.out.join(' + ')}`)
          .join(
            '; '
          )}.${result.stoppedBy === 'time' ? ' It stopped at its time limit, so it may have missed some.' : ''}`;
  const note = records.length === 0 ? undefined : `${searchNote}${discoveryNote}`.trim();
  return { swaps: records, note, stoppedBy: result.stoppedBy };
}

/** Owned replacements per slot a repair needs, and for any slot: enough to
 *  choose from, few enough that the search stays quick. */
const OWNED_PER_SLOT = 12;
const OWNED_ANY_SLOT = 24;
/** Owned nonbasic lands kept, the most played first. */
const OWNED_LANDS = 30;

/**
 * The owned cards the page doesn't rank, by name, that the search may seat
 * (E509). Lands are always resolved in a collection build: the generator meets
 * a land only through the page's land list, so an owned dual or utility land is
 * otherwise out of reach (the most played OWNED_LANDS are kept). Spells are
 * resolved only while the list breaks a rule the search repairs (an ownership
 * rule the generator left relaxed is not one, but a Game Changer ceiling in an
 * owned-only build is, and its replacement has to be owned): the most played
 * (EDHREC rank) of each slot the cards to replace fill (their counted role, a
 * protection piece), plus the most played of any slot.
 */
export async function ownedExtraCandidates(
  state: GenerationState,
  seed: ObjectiveDeck,
  ctx: ObjectiveContext,
  input: WholeDeckSearchInput,
  fetchedAlready: readonly ScryfallCard[],
  passesGates: (c: ScryfallCard) => boolean,
  leave: ReadonlySet<string>
): Promise<Map<string, ScryfallCard>> {
  const out = new Map<string, ScryfallCard>();
  const owned = ctx.ownedNames;
  if (!input.resolveOwned || !owned) return out;
  const broken = checkConstraints(seed, ctx).filter((v) => !leave.has(v.check));
  const { colorIdentity, collectionPool } = state.context;
  const known = new Set([...fetchedAlready, ...seed.cards].map((c) => c.name));
  // A land by its front face, as the search reads it (an MDFC spell is a spell).
  const isLandEntry = (c: { typeLine?: string }) =>
    /\bLand\b/.test((c.typeLine ?? '').split(' // ')[0]);
  const rest = (collectionPool ?? []).filter(
    (c) =>
      !known.has(c.name) &&
      !state.bannedCards.has(c.name) &&
      c.colorIdentity.every((x) => colorIdentity.includes(x)) &&
      (broken.length > 0 || isLandEntry(c))
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
    .sort(
      (a, b) =>
        (a.edhrec_rank ?? Infinity) - (b.edhrec_rank ?? Infinity) || (a.name < b.name ? -1 : 1)
    );
  const perSlot = new Map<string, number>();
  let anySlot = 0;
  let lands = 0;
  for (const c of fits) {
    if (isLandCard(c)) {
      if (isBasicLand(c) || lands >= OWNED_LANDS) continue;
      lands++;
      out.set(c.name, c);
      continue;
    }
    const k = slotKey(c);
    const n = perSlot.get(k) ?? 0;
    const keepForSlot = needed.has(k) && n < OWNED_PER_SLOT;
    const keepForAny = anySlot < OWNED_ANY_SLOT;
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
