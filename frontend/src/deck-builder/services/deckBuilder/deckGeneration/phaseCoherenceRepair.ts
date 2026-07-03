import { logger } from '@/lib/logger';
import type {
  CoherenceRepair,
  DeckCategory,
  DetectedCombo,
  MaxRarity,
  ScryfallCard,
} from '@/deck-builder/types';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/card-text';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { stampRoleSubtypes } from '../categorize';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import {
  constrainsToCollection,
  notInCollection,
  exceedsMaxPrice,
  exceedsMaxRarity,
  exceedsCmcCap,
  notOnArena,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  fitsColorIdentity,
} from '../deckFilters';
import { calculateCardPriority } from '../cardPicking';
import type { BudgetTracker } from '../budgetTracker';
import type { BracketGuard } from '../bracketGuard';
import { auditDeckCoherence } from '../coherenceAudit';
import { unsupportedPayoffAxes } from '../synergyDependency';
import { analyzeDeckSynergy, isLoadBearing } from '@/deck-builder/services/synergy/deckSynergy';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { buildManabaseSummary } from '../manabaseMath';

// ── Coherence Repair (E78 phase 3) ──
// The read-only audit at the very end of generation can only *report* dead
// payoffs, unjustified slots, and land-sanity problems. This pass runs the same
// detection while the deck can still be mutated — after the fixup pass, before
// bracket convergence — and repairs a bounded number of warn-severity findings,
// so convergence, scoring, and the final audit all see the repaired list and
// the final report shows only what repair couldn't fix.
//
// Moves:
//  - dead-payoff on an axis the deck is invested in → add an enabler (cut the
//    weakest unprotected card) rather than cutting the payoff (packageBoost
//    direction).
//  - other dead-payoff / unjustified-slot warns → cut the flagged card, add the
//    best gated EDHREC-pool candidate (inclusion > 0 ⇒ the replacement is
//    justified by the audit's own ladder).
//  - land-sanity findings carrying a basicFixColor (dead fetches, colorless
//    utility lands while a color is short) → swap the land for that basic.
//
// Every replacement honors the full pick-time gate set (the #967 FillHardGates
// lesson): salt, game-changer cap, bracket ceiling, color identity, rarity,
// budget, CMC cap, Arena, the synergy-dependency guard, and collection mode.
// Protections (never cut): must-includes, combo pieces, lift-protected cards
// (≥2 seeds — the #968 rule), game changers, and load-bearing engine cards.

export const MAX_COHERENCE_SWAPS = 3;

export interface CoherenceRepairContext {
  /** name → ScryfallCard map built during generation (for swap-in lookups). */
  scryfallCardMap: Map<string, ScryfallCard>;
  /** Complete/partial combos detected so far (combo pieces are protected). */
  detectedCombos: DetectedCombo[] | undefined;
  /** Cards the user pinned — never cut (lower-cased). */
  mustIncludeNames: Set<string>;
  /** Generation-wide synergy-dependency guard for replacements. */
  cardAllowed?: (card: ScryfallCard) => boolean;
  /** Lowercased name → lift co-play seeds (from the generation lift index). */
  liftedByOf: (lowerName: string) => string[] | undefined;
  // Hard gates, shared refs with the picking phases (counts accumulate).
  isSaltBlocked?: (name: string) => boolean;
  bracketGuard?: BracketGuard;
  gameChangerCount: { value: number };
  maxGameChangers: number;
  budgetTracker: BudgetTracker | null;
  maxCardPrice: number | null;
  maxRarity: MaxRarity;
  maxCmc: number | null;
  arenaOnly: boolean;
  currency: 'USD' | 'EUR';
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  /** Basic-land card lookup, injected so tests never touch the network. */
  getBasicLand: (name: string) => Promise<ScryfallCard | null>;
}

export interface CoherenceRepairResult {
  repairs: CoherenceRepair[];
}

const BASIC_BY_COLOR: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

export async function applyCoherenceRepair(
  state: GenerationState,
  ctx: CoherenceRepairContext
): Promise<CoherenceRepairResult> {
  const repairs: CoherenceRepair[] = [];
  // Land repairs (basic swaps) need no pool, but spell replacements do; without
  // EDHREC data the audit still reports at the end — this pass just can't act.
  const pool = state.edhrecData?.cardlists.allNonLand;
  if (!pool || pool.length === 0) return { repairs };

  const { commander, partnerCommander } = state.context;
  const commanders = [commander, partnerCommander].filter((c): c is ScryfallCard => c != null);
  const colorIdentity = state.context.colorIdentity;
  const ownedOnly = constrainsToCollection(state.cfg.collectionStrategy);
  const collectionNames = state.context.collectionNames;

  const nonLands = (): ScryfallCard[] =>
    (Object.entries(state.categories) as [DeckCategory, ScryfallCard[]][])
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);

  // EDHREC inclusion for the audit's justification ladder — same source the
  // post-convergence deckScorePhase reads, available here without running it.
  const inclusionMap: Record<string, number> = {};
  for (const c of pool) inclusionMap[c.name] = c.inclusion ?? 0;

  const current = nonLands();
  const liftedByMap: Record<string, string[]> = {};
  for (const c of current) {
    const seeds = ctx.liftedByOf(c.name.toLowerCase());
    if (seeds) liftedByMap[c.name.toLowerCase()] = seeds;
  }

  const findings = auditDeckCoherence({
    nonLandCards: current,
    commanders,
    cardInclusionMap: inclusionMap,
    liftedByMap,
    detectedCombos: ctx.detectedCombos,
    roleOf: getCardRole,
    lands: state.categories.lands,
    manabase: buildManabaseSummary(state.categories.lands, current, new Set(colorIdentity)),
  });
  if (findings.length === 0) return { repairs };

  const deckSynergy = analyzeDeckSynergy([...commanders, ...current]);
  const completeComboNames = new Set<string>();
  for (const combo of ctx.detectedCombos ?? []) {
    if (!combo.isComplete) continue;
    for (const n of combo.cards) completeComboNames.add(n);
  }

  const isProtected = (card: ScryfallCard): boolean =>
    !!card.isMustInclude ||
    ctx.mustIncludeNames.has(card.name.toLowerCase()) ||
    state.comboCardNames.has(card.name) ||
    completeComboNames.has(card.name) ||
    completeComboNames.has(frontFaceName(card.name)) ||
    (liftedByMap[card.name.toLowerCase()]?.length ?? 0) >= 2 ||
    state.gameChangerNames.has(card.name) ||
    isLoadBearing(card, deckSynergy);

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
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
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

  // Best pool candidate clearing EVERY hard gate the pick-time path enforces.
  const findCandidate = (pred?: (card: ScryfallCard) => boolean): ScryfallCard | null => {
    const ranked = [...pool]
      .filter(
        (c) =>
          !state.usedNames.has(c.name) &&
          !state.bannedCards.has(c.name) &&
          ctx.scryfallCardMap.has(c.name) &&
          !ctx.isSaltBlocked?.(c.name) &&
          (!ownedOnly || !notInCollection(c.name, collectionNames))
      )
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
    for (const c of ranked) {
      const card = ctx.scryfallCardMap.get(c.name)!;
      if (pred && !pred(card)) continue;
      if (ctx.cardAllowed && !ctx.cardAllowed(card)) continue;
      if (!fitsColorIdentity(card, colorIdentity)) continue;
      const isGC = state.gameChangerNames.has(c.name);
      if (isGC && ctx.gameChangerCount.value >= ctx.maxGameChangers) continue;
      if (ctx.bracketGuard?.exceedsCeiling(c.name)) continue;
      if (!isOwnedBudgetExempt(c.name, collectionNames, ctx.ignoreOwnedBudget)) {
        const cap = ctx.budgetTracker?.getEffectiveCap(ctx.maxCardPrice) ?? ctx.maxCardPrice;
        if (exceedsMaxPrice(card, cap, ctx.currency)) continue;
      }
      if (!isOwnedRarityExempt(c.name, collectionNames, ctx.ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, ctx.maxRarity)) continue;
      }
      if (exceedsCmcCap(card, ctx.maxCmc)) continue;
      if (notOnArena(card, ctx.arenaOnly)) continue;
      return card;
    }
    return null;
  };

  // Gate bookkeeping on an accepted add — mirrors pickFromPrefetched.
  const commitAdd = (card: ScryfallCard) => {
    if (state.gameChangerNames.has(card.name)) {
      card.isGameChanger = true;
      ctx.gameChangerCount.value++;
    }
    ctx.bracketGuard?.record(card.name);
    if (!isOwnedBudgetExempt(card.name, collectionNames, ctx.ignoreOwnedBudget)) {
      ctx.budgetTracker?.deductCard(card);
    }
    addCard(card);
  };

  // Weakest unprotected nonland (lowest inclusion) — room for an enabler add.
  const weakestCut = (
    exclude: Set<string>
  ): { card: ScryfallCard; category: DeckCategory } | null => {
    let best: { card: ScryfallCard; category: DeckCategory; incl: number } | null = null;
    for (const [cat, cards] of Object.entries(state.categories) as [
      DeckCategory,
      ScryfallCard[],
    ][]) {
      if (cat === 'lands') continue;
      for (const card of cards) {
        if (exclude.has(card.name) || isProtected(card)) continue;
        const incl = inclusionMap[card.name] ?? 0;
        if (!best || incl < best.incl) best = { card, category: cat, incl };
      }
    }
    return best ? { card: best.card, category: best.category } : null;
  };

  let swaps = 0;
  // Warn findings first — info land findings (colorless utility) use leftover budget.
  const actionable = findings
    .filter((f) => f.card && f.kind !== 'lopsided-engine')
    .sort((a, b) => (a.severity === 'warn' ? 0 : 1) - (b.severity === 'warn' ? 0 : 1));

  for (const f of actionable) {
    if (swaps >= MAX_COHERENCE_SWAPS) break;

    if (f.kind === 'land-sanity') {
      if (!f.basicFixColor) continue; // typal findings are report-only
      const basicName = BASIC_BY_COLOR[f.basicFixColor];
      if (!basicName) continue;
      const idx = state.categories.lands.findIndex((l) => l.name === f.card);
      if (idx < 0 || state.categories.lands[idx].isMustInclude) continue;
      const basic = await ctx.getBasicLand(basicName);
      if (!basic) continue;
      const cut = state.categories.lands[idx];
      state.categories.lands[idx] = { ...basic };
      state.usedNames.delete(cut.name);
      state.usedNames.add(basic.name);
      repairs.push({ cut: cut.name, added: basicName, reason: f.message });
      swaps++;
      continue;
    }

    if (f.severity !== 'warn') continue;
    const loc = findInDeck(f.card!);
    if (!loc) continue;

    if (f.kind === 'dead-payoff') {
      const deadAxes = unsupportedPayoffAxes(
        loc.card,
        [...commanders, ...nonLands()],
        commanders.length
      );
      const investedAxis = deadAxes.find((a) => deckSynergy.invested.includes(a));
      if (investedAxis) {
        // The deck IS built around this axis (so the payoff stays) — the engine
        // is just under-fed. Feed it: cut the weakest card for an enabler.
        const enabler = findCandidate((card) =>
          classifyCard(card).producers.some((p) => p.axis === investedAxis)
        );
        const cut = enabler ? weakestCut(new Set([f.card!, enabler.name])) : null;
        if (enabler && cut) {
          removeCard(cut.card, cut.category);
          commitAdd(enabler);
          repairs.push({
            cut: cut.card.name,
            added: enabler.name,
            reason: `${f.card}: ${f.message} Fed the engine instead of cutting the payoff.`,
          });
          swaps++;
        }
        continue;
      }
    }

    if (isProtected(loc.card)) continue;
    const replacement = findCandidate();
    if (!replacement) continue;
    removeCard(loc.card, loc.category);
    commitAdd(replacement);
    repairs.push({ cut: loc.card.name, added: replacement.name, reason: f.message });
    swaps++;
  }

  if (swaps > 0) {
    logger.debug(
      `[DeckGen] Coherence repair: ${swaps} swap(s) — ${repairs
        .map((r) => `${r.cut} → ${r.added}`)
        .join('; ')}`
    );
  }
  return { repairs };
}
