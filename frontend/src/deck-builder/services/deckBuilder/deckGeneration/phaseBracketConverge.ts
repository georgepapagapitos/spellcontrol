import { logger } from '@/lib/logger';
import type { DeckCategory, DetectedCombo, EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/card-text';
import { getCardRole, isExtraTurn } from '@/deck-builder/services/tagger/client';
import { stampRoleSubtypes } from '../categorize';
import { constrainsToCollection, notInCollection } from '../deckFilters';
import { calculateCardPriority } from '../cardPicking';
import {
  estimateBracket,
  isFastMana,
  isMassLandDenialFloor,
  isStaxPiece,
  isTutor,
} from '../bracketEstimator';
import { computeDownshiftPlan } from '../bracketFit';

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
// ponytail: only clamps overshoot DOWN to the target (the "asked casual, got
// tuned" complaint). Pushing a too-weak deck UP to a high target fights the
// bracket pool filter and needs the strong-card pool back — deferred.
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

  const { scryfallCardMap, mustIncludeNames } = ctx;
  const { commander, partnerCommander } = state.context;
  const ownedOnly = constrainsToCollection(state.cfg.collectionStrategy);
  const collectionNames = state.context.collectionNames;

  // Commander names are always in the deck for estimation but never cuttable.
  const commanderNames: string[] = [];
  if (commander) commanderNames.push(commander.name);
  if (partnerCommander) commanderNames.push(partnerCommander.name);

  const isProtected = (name: string): boolean =>
    mustIncludeNames.has(name.toLowerCase()) ||
    state.comboCardNames.has(name) ||
    commanderNames.includes(name);

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
    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) state.categories.creatures.push(card);
    else if (role === 'boardwipe') state.categories.boardWipes.push(card);
    else if (role === 'removal') state.categories.singleRemoval.push(card);
    else if (role === 'ramp') state.categories.ramp.push(card);
    else if (role === 'cardDraw') state.categories.cardDraw.push(card);
    else state.categories.synergy.push(card);
    state.usedNames.add(card.name);
    if (card.name.includes(' // ')) state.usedNames.add(frontFaceName(card.name));
    if (role) state.currentRoleCounts[role] = (state.currentRoleCounts[role] ?? 0) + 1;
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
      (!ownedOnly || !notInCollection(c.name, collectionNames));

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
      if (isProtected(move.name)) continue;
      const loc = findInDeck(move.name);
      if (!loc) continue; // a land or already gone
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

  if (applied > 0) {
    logger.debug(
      `[DeckGen] Bracket converge: ${applied} swap(s), bracket ${est.bracket} (target ${target})`
    );
  }

  return { applied, finalBracket: est.bracket };
}
