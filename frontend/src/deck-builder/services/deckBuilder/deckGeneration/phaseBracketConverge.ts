import { logger } from '@/lib/logger';
import type { DeckCategory, DetectedCombo, EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/card-text';
import {
  getCardRole,
  isExtraTurn,
  isProtectionPiece,
  isFreeInteraction,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { stampRoleSubtypes, routeCardByType } from '../categorize';
import {
  constrainsToCollection,
  notInCollection,
  exceedsMaxPrice,
  isOwnedBudgetExempt,
} from '../deckFilters';
import { calculateCardPriority } from '../cardPicking';
import type { BudgetTracker } from '../budgetTracker';
import {
  estimateBracket,
  isFastMana,
  isMassLandDenialFloor,
  isStaxPiece,
  isTutor,
} from '../bracketEstimator';
import { computeDownshiftPlan, computeUpshiftPlan } from '../bracketFit';

// ── Bracket Convergence ──
// T43's pick-time BracketGuard caps the estimator's HARD-floor signals (game
// changers, mass land denial, extra turns, stax) so a targeted deck doesn't
// overshoot by construction. But the estimator's SOFT score (fast mana, tutors,
// low average CMC, interaction density) can still push `floor → floor+1`
// (bracketEstimator soft bump), and the guard never caps that — so a deck
// targeting Bracket 2 with enough fast mana/tutors silently lands at an
// *estimated* Bracket 3. That's the E59 / T42-RC1 overshoot.
//
// This post-generation pass closes the loop using the SAME engine the Tune
// "Bracket Fit" coach uses: it re-runs the real `estimateBracket`, and when the
// deck is above target, reuses `computeDownshiftPlan` to get the verified,
// priority-ordered set of cards to cut, then applies each cut as a 1-for-1 swap
// for a soft-NEUTRAL filler (never a fast-mana/tutor/floor card), so the deck
// stays 100 cards and the soft score can only drop. Because the convergence
// check is the production estimator itself, it cannot drift from what the user
// later sees in the report. Re-estimates after every swap (minimal cuts) and
// re-plans each round so a residual is always re-attacked.
//
// Both directions are handled: an overshooting deck is clamped DOWN (the "asked
// casual, got tuned" complaint), and an under-target deck is pushed UP by
// swapping its weakest cards for the Game Changers the target bracket pool offers
// — the hard floor signal `estimateBracket` actually counts (1 GC → Bracket 3,
// more → 4). The "strong-card pool" the UP case needs is still live in
// `state.edhrecData` at converge time; only GCs present in `scryfallCardMap`
// (fetched during generation) can be added, so a low target whose pool has no
// game changers simply no-ops.
// ponytail: UP adds Game Changers only — the deterministic estimator lever. Soft
// fills (high-inclusion engines) rarely cross a bracket boundary and would churn
// the deck for no gain; combo-completion adds need oneAwayCombos, not computed at
// generation time. Wire gapAnalysis/oneAwayCombos through if either is ever worth
// the extra churn-guarding.
// ponytail: Bracket 1 (Exhibition) is by design undetectable from card content
// (the estimator never emits 1), so a target of 1 converges to the same in-band
// result as target 2 — the lowest the estimator can verify.

const MAX_CONVERGE_ROUNDS = 3;

export interface BracketConvergeContext {
  /** name → ScryfallCard map built during generation (for swap-in lookups). */
  scryfallCardMap: Map<string, ScryfallCard>;
  /** Complete/partial combos detected so far (drives the estimator combo floor). */
  detectedCombos: DetectedCombo[] | undefined;
  /** Cards the user pinned — never cut to hit a bracket (lower-cased). */
  mustIncludeNames: Set<string>;
  /** Optional generation-wide card eligibility guard for filler swaps. */
  cardAllowed?: (card: ScryfallCard) => boolean;
  /** Live role targets, for cut-side role-floor protection (UP push). */
  roleTargets?: Record<RoleKey, number> | null;
  /** Same budget gate every other generation-tail pass enforces (E79) — so
   *  neither direction of convergence can itself blow the deck budget.
   *  All default to "no budget constraint" so existing callers/tests are
   *  unaffected. */
  budgetTracker?: BudgetTracker | null;
  maxCardPrice?: number | null;
  currency?: 'USD' | 'EUR';
  ignoreOwnedBudget?: boolean;
}

export interface BracketConvergeResult {
  /** Number of cards swapped out to lower the bracket. */
  applied: number;
  /** Estimated bracket after convergence (descriptive). */
  finalBracket: number | null;
}

/** True when `name` would re-trigger any estimator signal we're lowering. */
function isPowerSignal(name: string, gameChangerNames: Set<string>): boolean {
  return (
    gameChangerNames.has(name) ||
    isMassLandDenialFloor(name) ||
    isExtraTurn(name) ||
    isStaxPiece(name) ||
    isFastMana(name) ||
    isTutor(name)
  );
}

export function applyBracketConvergence(
  state: GenerationState,
  ctx: BracketConvergeContext
): BracketConvergeResult {
  const target = state.cfg.targetBracket;
  // No target, or 'all' (already normalized to undefined) → nothing to converge.
  if (target === undefined || target === 'all') return { applied: 0, finalBracket: null };

  // Need the EDHREC pool to source soft-neutral replacements; without it we
  // can't keep the deck at 100 cards while cutting, so leave it untouched (the
  // pick-time guard already did its best). Offline / Scryfall-only modes.
  const pool = state.edhrecData?.cardlists.allNonLand;
  if (!pool || pool.length === 0) {
    logger.debug('[DeckGen] Bracket converge: no EDHREC pool — skipped (offline)');
    return { applied: 0, finalBracket: null };
  }

  const {
    scryfallCardMap,
    mustIncludeNames,
    budgetTracker = null,
    maxCardPrice = null,
    currency = 'USD',
    ignoreOwnedBudget = false,
  } = ctx;
  const { commander, partnerCommander } = state.context;
  const ownedOnly = constrainsToCollection(state.cfg.collectionStrategy);
  const collectionNames = state.context.collectionNames;

  // Commander names are always in the deck for estimation but never cuttable.
  const commanderNames: string[] = [];
  if (commander) commanderNames.push(commander.name);
  if (partnerCommander) commanderNames.push(partnerCommander.name);

  const isProtected = (card: ScryfallCard): boolean =>
    mustIncludeNames.has(card.name.toLowerCase()) ||
    state.comboCardNames.has(card.name) ||
    commanderNames.includes(card.name) ||
    isProtectionPiece(card) ||
    isFreeInteraction(card);

  const inclusionMap: Record<string, number> = {};
  for (const c of pool) inclusionMap[c.name] = c.inclusion ?? 0;

  // All mainboard card names (commanders appended for an accurate estimate).
  const mainboardNames = (): string[] => {
    const names: string[] = [];
    for (const cards of Object.values(state.categories)) {
      for (const card of cards) names.push(card.name);
    }
    return names;
  };

  // Recompute combo completeness against the live deck so the estimator's combo
  // floor falls as soon as we break a combo (it keys off the isComplete flag).
  const liveCombos = (deckNames: Set<string>): DetectedCombo[] | undefined => {
    if (!ctx.detectedCombos) return undefined;
    return ctx.detectedCombos.map((c) => ({
      ...c,
      isComplete: c.cards.every((piece) => deckNames.has(piece)),
    }));
  };

  const nonLandAvgCmc = (): number => {
    let sum = 0;
    let count = 0;
    for (const [cat, cards] of Object.entries(state.categories) as [
      DeckCategory,
      ScryfallCard[],
    ][]) {
      if (cat === 'lands') continue;
      for (const card of cards) {
        sum += card.cmc ?? 0;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  };

  const estimate = () => {
    const names = mainboardNames();
    for (const cn of commanderNames) names.push(cn);
    const deckNameSet = new Set<string>();
    for (const n of names) {
      deckNameSet.add(n);
      if (n.includes(' // ')) deckNameSet.add(frontFaceName(n));
    }
    return estimateBracket(
      names,
      liveCombos(deckNameSet),
      nonLandAvgCmc(),
      undefined,
      state.currentRoleCounts,
      state.gameChangerNames
    );
  };

  // Locate a card in categories by name (skips lands — cutting one would unbalance
  // the mana base; estimator floor cards are spells anyway).
  const findInDeck = (name: string): { card: ScryfallCard; category: DeckCategory } | null => {
    for (const [cat, cards] of Object.entries(state.categories) as [
      DeckCategory,
      ScryfallCard[],
    ][]) {
      if (cat === 'lands') continue;
      const card = cards.find((c) => c.name === name);
      if (card) return { card, category: cat };
    }
    return null;
  };

  const removeCard = (card: ScryfallCard, category: DeckCategory) => {
    state.categories[category] = state.categories[category].filter((c) => c !== card);
    state.usedNames.delete(card.name);
    if (card.name.includes(' // ')) state.usedNames.delete(frontFaceName(card.name));
    const role = getCardRole(card.name);
    if (role && state.currentRoleCounts[role] > 0) state.currentRoleCounts[role]--;
  };

  const addCard = (card: ScryfallCard) => {
    stampRoleSubtypes(card);
    const role = getCardRole(card.name);
    routeCardByType(card, state.categories);
    state.usedNames.add(card.name);
    if (card.name.includes(' // ')) state.usedNames.add(frontFaceName(card.name));
    if (role) state.currentRoleCounts[role] = (state.currentRoleCounts[role] ?? 0) + 1;
    // Every add here is a real deck addition (both the DOWN filler and the UP
    // incoming power card) — deduct so budget convergence (which runs right
    // after this phase) sees the live spend, not a stale pre-swap total (E79).
    if (!isOwnedBudgetExempt(card.name, collectionNames, ignoreOwnedBudget)) {
      budgetTracker?.deductCard(card);
    }
  };

  // Same budget gate every other generation-tail pass enforces — a filler or
  // UP-push add must not itself blow the deck budget (E79).
  const withinBudget = (name: string, card: ScryfallCard): boolean => {
    if (isOwnedBudgetExempt(name, collectionNames, ignoreOwnedBudget)) return true;
    const cap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
    return !exceedsMaxPrice(card, cap, currency);
  };

  // Best soft-neutral filler from the pool (prefer same role as the cut card to
  // preserve role balance). Never returns a power-signal card, so adding it can
  // only keep the bracket flat or lower it.
  const pickFiller = (cutRole: string | null): ScryfallCard | null => {
    const eligible = (c: EDHRECCard): boolean =>
      !state.usedNames.has(c.name) &&
      !state.bannedCards.has(c.name) &&
      // Never swap in a tracked combo piece — it could complete a combo and
      // re-raise the very floor we're lowering.
      !state.comboCardNames.has(c.name) &&
      scryfallCardMap.has(c.name) &&
      !isPowerSignal(c.name, state.gameChangerNames) &&
      (!ctx.cardAllowed || ctx.cardAllowed(scryfallCardMap.get(c.name)!)) &&
      (!ownedOnly || !notInCollection(c.name, collectionNames)) &&
      withinBudget(c.name, scryfallCardMap.get(c.name)!);

    const ranked = pool
      .filter(eligible)
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
    if (ranked.length === 0) return null;

    if (cutRole) {
      const sameRole = ranked.find((c) => getCardRole(c.name) === cutRole);
      if (sameRole) return scryfallCardMap.get(sameRole.name) ?? null;
    }
    return scryfallCardMap.get(ranked[0].name) ?? null;
  };

  // Priority lookup mirroring bracketFit.ts's buildPriorityLookup: prefer the
  // pool's real calculateCardPriority formula, fall back to raw inclusion.
  const priorityByName = new Map<string, EDHRECCard>();
  for (const c of pool) priorityByName.set(c.name, c);
  const priorityFor = (name: string): number => {
    const pooled = priorityByName.get(name);
    return pooled ? calculateCardPriority(pooled) : (inclusionMap[name] ?? 0);
  };

  // A card is "floor-safe" to cut only if its role (if tracked) is currently
  // above its target — cutting it can't push that role below target.
  const isFloorSafe = (name: string): boolean => {
    const roleTargets = ctx.roleTargets;
    if (!roleTargets) return true;
    const role = getCardRole(name);
    if (!role) return true;
    const target = roleTargets[role];
    if (target == null) return true;
    return (state.currentRoleCounts[role] ?? 0) > target;
  };

  // Weakest cuttable in-deck card to make room when powering UP: lowest
  // calculateCardPriority, role-floor-safe candidates preferred over
  // floor-violating ones (same tiering as bracketFit.ts's upshift cut pool),
  // never a protected, power-signal, or land card (cutting a power card would
  // fight the very bracket we're trying to raise).
  const pickCut = (): { card: ScryfallCard; category: DeckCategory } | null => {
    const candidates: { card: ScryfallCard; category: DeckCategory }[] = [];
    for (const [cat, cards] of Object.entries(state.categories) as [
      DeckCategory,
      ScryfallCard[],
    ][]) {
      if (cat === 'lands') continue;
      for (const card of cards) {
        if (isProtected(card)) continue;
        if (isPowerSignal(card.name, state.gameChangerNames)) continue;
        candidates.push({ card, category: cat });
      }
    }
    if (candidates.length === 0) return null;

    const byPriorityAsc = (a: { card: ScryfallCard }, b: { card: ScryfallCard }): number =>
      priorityFor(a.card.name) - priorityFor(b.card.name);
    const safe = candidates.filter((c) => isFloorSafe(c.card.name)).sort(byPriorityAsc);
    const atFloor = candidates.filter((c) => !isFloorSafe(c.card.name)).sort(byPriorityAsc);
    const pick = safe[0] ?? atFloor[0];
    return pick ? { card: pick.card, category: pick.category } : null;
  };

  let applied = 0;
  let est = estimate();

  for (let round = 0; round < MAX_CONVERGE_ROUNDS && est.bracket > target; round++) {
    const plan = computeDownshiftPlan(
      {
        estimation: est,
        gameChangerNames: state.gameChangerNames,
        allCardNames: (() => {
          const names = mainboardNames();
          for (const cn of commanderNames) names.push(cn);
          return names;
        })(),
        detectedCombos: ctx.detectedCombos ?? [],
        averageCmc: nonLandAvgCmc(),
        roleCounts: state.currentRoleCounts,
        targetPool: state.edhrecData,
        cardInclusionMap: inclusionMap,
        // Force-included staples (Sol Ring/Arcane Signet) read inclusion 0
        // against a lower-bracket pool that never listed them — without this,
        // the combo-piece victim sort would cut the staple to break a combo
        // instead of its actual niche partner (E-bracket-combo-staple-victim).
        stapleNames: (() => {
          const names = new Set<string>();
          for (const cards of Object.values(state.categories)) {
            for (const card of cards) if (card.isStapleRock) names.add(card.name);
          }
          return names;
        })(),
        oneAwayCombos: [],
        gapAnalysis: [],
        commanderNames,
        deckFull: true,
      },
      target
    );

    let progressed = false;
    for (const move of plan.moves) {
      if (est.bracket <= target) break;
      const loc = findInDeck(move.name);
      if (!loc) continue; // a land or already gone
      if (isProtected(loc.card)) continue;
      const filler = pickFiller(getCardRole(move.name));
      if (!filler) continue; // can't keep 100 cards safely — leave the offender

      removeCard(loc.card, loc.category);
      addCard(filler);
      applied++;
      progressed = true;
      logger.debug(
        `[DeckGen] Bracket converge: cut ${move.name} (${move.signal}) → added ${filler.name}`
      );
      est = estimate();
    }

    if (!progressed) break; // every remaining offender is protected/unreplaceable
  }

  // Under target → push UP. Reuse the same Bracket-Fit upshift planner the Tune
  // coach uses to pick which power cards to add, then apply each as a 1-for-1
  // swap (weakest in-deck card out) so the deck stays 100. Re-estimate after each
  // swap and re-plan per round, mirroring the DOWN loop above. DOWN and UP are
  // mutually exclusive — only the side matching `est.bracket` vs `target` runs.
  for (let round = 0; round < MAX_CONVERGE_ROUNDS && est.bracket < target; round++) {
    const plan = computeUpshiftPlan(
      {
        estimation: est,
        gameChangerNames: state.gameChangerNames,
        allCardNames: (() => {
          const names = mainboardNames();
          for (const cn of commanderNames) names.push(cn);
          return names;
        })(),
        detectedCombos: ctx.detectedCombos ?? [],
        averageCmc: nonLandAvgCmc(),
        roleCounts: state.currentRoleCounts,
        targetPool: state.edhrecData ?? null,
        cardInclusionMap: inclusionMap,
        oneAwayCombos: [], // combo-completion adds deferred (not computed at gen time)
        gapAnalysis: [], // GC-only — soft fills rarely cross a bracket boundary
        commanderNames,
        deckFull: false, // we pick our own cut via pickCut(), so keep adds pure
      },
      target
    );

    let progressed = false;
    for (const move of plan.moves) {
      if (est.bracket >= target) break;
      const inName = move.name; // deckFull:false → pure 'add', name is the incoming card
      if (state.usedNames.has(inName)) continue; // already in the deck
      if (state.bannedCards.has(inName)) continue;
      const incoming = scryfallCardMap.get(inName);
      if (!incoming) continue; // no Scryfall data fetched → can't materialize the card
      if (ownedOnly && notInCollection(inName, collectionNames)) continue;
      if (!withinBudget(inName, incoming)) continue; // pushing UP can't itself blow the budget
      const cut = pickCut();
      if (!cut) break; // nothing safe to cut — can't add without overshooting 100

      removeCard(cut.card, cut.category);
      addCard(incoming);
      applied++;
      progressed = true;
      logger.debug(`[DeckGen] Bracket converge UP: cut ${cut.card.name} → added ${inName}`);
      est = estimate();
    }

    if (!progressed) break; // no addable power cards left in the pool
  }

  if (applied > 0) {
    logger.debug(
      `[DeckGen] Bracket converge: ${applied} swap(s), bracket ${est.bracket} (target ${target})`
    );
  }

  return { applied, finalBracket: est.bracket };
}
