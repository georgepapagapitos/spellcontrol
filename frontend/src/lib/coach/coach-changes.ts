/**
 * Assemble every Coach engine's output into one flat `Change` list, filtered
 * against the live deck. The Coach feed ranks and renders this list; the
 * upgrade planner spends a budget over the same list, so the two can never
 * disagree about what a deck could use.
 */
import {
  fromGapCard,
  fromOptimizeCard,
  fromSynergySuggestion,
  fromSubstituteRow,
  fromBracketFitMove,
  fromCostSwapRow,
  fromComboCompletion,
  fromLandUpgradeMove,
  fromCrossDeckMove,
  mergeMisfitCuts,
  mergeImprove,
  type Change,
  type ChangeOwnership,
} from './deck-change';
import type { CrossDeckMove } from './cross-deck-moves';
import { wouldBeSuggestedBack } from './coach-protections';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { CostPlan, CostSwapRow } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { BracketFitPlan } from '@/deck-builder/services/deckBuilder/bracketFit';
import type { LandUpgradeMove } from '@/deck-builder/services/deckBuilder/landUpgrades';
import type { MisfitSummary } from '@/deck-builder/services/deckBuilder/cardFit';
import type { ComboMatch } from '@/types/combos';
import { comboEndsGame } from '@/deck-builder/services/winConditions/detect';
import type { DeckPayoffs } from '@/deck-builder/services/winConditions/comboPayoffs';

/**
 * The gap staples worth an owned substitute: role-bearing, not owned (an owned
 * staple is simply added), and in a role the deck is short on. A substitute in
 * a role already at its target was a lateral swap between two owned cards off
 * the commander's page, and the next pass traded it straight back (T171 lane M
 * measured 0.80 of the collection panel's applied moves reversed).
 */
export function staplesToSubstitute<T extends GapAnalysisCard>(
  gaps: readonly T[],
  ownedNames: ReadonlySet<string>,
  roleCounts: Record<string, number>,
  roleTargets: Record<string, number>
): T[] {
  return gaps.filter((g) => {
    if (!g.role || ownedNames.has(g.name)) return false;
    const target = roleTargets[g.role];
    return target === undefined || (roleCounts[g.role] ?? 0) < target;
  });
}

/**
 * The one-away combos worth the Next-best-move hero: the missing piece is a
 * card this commander's decks play (on its EDHREC page), most played first.
 * A combo that only needs a generic card (Hullbreaker Horror with the Sol Ring
 * every deck runs) led the hero for Atraxa, Muldrotha and Yuriko alike, and
 * the next pass flagged the card it added (T171 lane M: 38 of the 74 off-plan
 * moves left). `pieces` is the analysis' `suggestionCards`.
 */
export function onPlanCombos(
  combos: ComboMatch[] | undefined,
  pieces: Readonly<Record<string, { inclusion?: number }>> | undefined
): ComboMatch[] | undefined {
  if (!combos) return combos;
  const pieceInclusion = (m: ComboMatch): number => {
    const missing = m.combo.cards.filter((c) => m.missingOracleIds.includes(c.oracleId));
    return Math.min(...missing.map((c) => pieces?.[c.cardName]?.inclusion ?? 0));
  };
  return combos
    .map((m) => ({ m, inclusion: pieceInclusion(m) }))
    .filter((x) => x.inclusion > 0)
    .sort((a, b) => b.inclusion - a.inclusion)
    .map((x) => x.m);
}

/**
 * The one-away combos that open a line the deck doesn't already assemble. A
 * Spellbook line has variants that swap one piece for another (Demonic
 * Consultation + Laboratory Maniac, Demonic Consultation + Thassa's Oracle):
 * with one variant whole, the other is one card away but adds nothing, and
 * "Completes Demonic Consultation" for it was false (T171, E567 gate). A line
 * with no recorded result is kept.
 */
export function newLineCombos(
  combos: { oneAway?: ComboMatch[]; inDeck?: readonly ComboMatch[] } | null | undefined
): ComboMatch[] {
  const { oneAway, inDeck } = combos ?? {};
  const assembled = new Set(
    (inDeck ?? []).flatMap((m) => m.combo.produces.map((p) => p.toLowerCase()))
  );
  return (oneAway ?? []).filter(
    (m) =>
      m.combo.produces.length === 0 || m.combo.produces.some((p) => !assembled.has(p.toLowerCase()))
  );
}

export interface CoachChangeSources {
  gaps: GapAnalysisCard[];
  optimize?: OptimizeSwaps;
  /** E222: cardFit misfits — merged into the optimizer's cut rows. */
  misfits?: MisfitSummary[];
  synergy: SynergySuggestion[];
  substitutes: SubstituteRow[];
  costPlan?: CostPlan;
  bracketFit?: BracketFitPlan;
  landUpgrades?: LandUpgradeMove[];
  oneAwayCombos?: ComboMatch[];
  /** What the deck's own cards convert into a win (`deckComboPayoffs`, E578). */
  deckPayoffs?: DeckPayoffs;
  /** E90: owned copies idle in a sibling deck. */
  crossDeckMoves?: CrossDeckMove[];
}

/**
 * `deckNames` is the lowercased live mainboard. The persisted analyses don't
 * recompute on an apply, so this is what drops an applied row (and brings an
 * undone one back): adds need their card absent, cuts need it present, swaps
 * need the outgoing card present and the incoming card absent.
 *
 * `settingsFit` drops a move that breaks the deck's saved settings (price cap,
 * budget, rarity, collection strategy, Game Changer limit): see
 * deck-settings-fit.ts. Absent for a deck with nothing to respect.
 * `readdFits` is the same check for a caller that applies it later itself
 * (CoachFeed counts what the settings hide); it defaults to `settingsFit`.
 */
export function buildCoachChanges(
  src: CoachChangeSources,
  resolveOwnership: (name: string) => ChangeOwnership,
  deckNames: Set<string>,
  settingsFit?: (change: Change) => boolean,
  readdFits: ((change: Change) => boolean) | undefined = settingsFit
): Change[] {
  const adds: Change[] = [
    ...src.gaps.map((g) => fromGapCard(g, resolveOwnership(g.name))),
    ...(src.optimize?.additions ?? []).map((o) =>
      fromOptimizeCard(o, 'add', resolveOwnership(o.name))
    ),
    ...src.synergy.map((s) => fromSynergySuggestion(s, resolveOwnership(s.cardName))),
    ...src.substitutes.map(fromSubstituteRow),
  ];

  const allCostRows = [...(src.costPlan?.spellRows ?? []), ...(src.costPlan?.landRows ?? [])];
  // A budget swap is worth its cost in power only when the deck can't afford
  // the card it replaces: the deck's settings would hide that card's re-add.
  // Otherwise (no budget, or room left in it) only a drop-in stays, and never
  // one that trades away a card Coach would suggest adding straight back (a
  // card played here at least as much as the least-played missing staple).
  // Undead Warchief went out for Great Fierce Bee in a Zombies Gisa with no
  // budget, and the next pass suggested the Warchief back (T171 re-gate).
  const affordable = (row: CostSwapRow): boolean =>
    !readdFits ||
    readdFits(
      fromGapCard(
        {
          name: row.currentName,
          inclusion: row.currentInclusion,
          price: String(row.currentPrice),
        } as GapAnalysisCard,
        resolveOwnership(row.currentName)
      )
    );
  const worthIt = (row: CostSwapRow): boolean =>
    !affordable(row) ||
    (row.confidence === 'drop-in' && !wouldBeSuggestedBack(row.currentInclusion, src.gaps));
  const costChanges: Change[] = allCostRows
    .filter(worthIt)
    .map((row) => fromCostSwapRow(row, resolveOwnership(row.suggestionName)));

  const bracketChanges: Change[] = (src.bracketFit?.moves ?? []).map((m) => {
    if (m.type === 'swap' && m.inName) {
      return fromBracketFitMove(m, resolveOwnership(m.inName));
    }
    return fromBracketFitMove(m, m.type === 'cut' ? undefined : resolveOwnership(m.name));
  });

  // A completion earns the combos lane only when the loop wins the game (the
  // deck's own payoff shows up as its own Spellbook combo). A loop that only
  // makes mana or draws is no free win: the card competes on its ordinary fit
  // through the other lanes (E437, Hullbreaker Horror + Sol Ring).
  const comboChanges: Change[] = (src.oneAwayCombos ?? [])
    .filter((match) => match.missingOracleIds.length === 1)
    .filter((match) => comboEndsGame(match.combo.produces, src.deckPayoffs))
    .map((match) => {
      const missingId = match.missingOracleIds[0];
      const missingCard = match.combo.cards.find((c) => c.oracleId === missingId);
      if (!missingCard) return null;
      return fromComboCompletion(
        match,
        missingCard.cardName,
        resolveOwnership(missingCard.cardName)
      );
    })
    .filter((c): c is Change => c !== null);

  // Merge add-type changes (dedup by name, keep higher-signal row).
  const mergedAdds = mergeImprove(adds);

  // Swaps/cuts from cost + bracket-fit + lands (have specific target slots, skip
  // dedup), plus the optimizer's cut rows (ownership-blind: the card is already
  // in the deck), enriched with the cardFit misfits (E222).
  const landChanges: Change[] = (src.landUpgrades ?? []).map((m) =>
    fromLandUpgradeMove(m, resolveOwnership(m.inName))
  );
  const optimizeCuts = mergeMisfitCuts(
    (src.optimize?.removals ?? []).map((o) => fromOptimizeCard(o, 'cut')),
    src.misfits ?? []
  );
  const swapsAndCuts = [
    ...costChanges,
    ...bracketChanges.filter((c) => c.type === 'swap' || c.type === 'cut'),
    ...landChanges,
    ...optimizeCuts,
  ];
  const bracketAdds = bracketChanges.filter((c) => c.type === 'add');

  // A card another lane would add from scratch, when it already sits idle in a
  // sibling deck, shows once: as the move, which brings the physical copy and
  // patches the deck it leaves. The plain add would list it unowned.
  const moveChanges = (src.crossDeckMoves ?? []).map(fromCrossDeckMove);
  const moved = new Set(moveChanges.map((c) => c.name.toLowerCase()));
  const notMoved = (c: Change) => c.type !== 'add' || !moved.has(c.name.toLowerCase());

  const inDeck = (n: string) => deckNames.has(n.toLowerCase());
  return [
    ...moveChanges,
    ...[...mergedAdds, ...bracketAdds, ...comboChanges].filter(notMoved),
    ...swapsAndCuts,
  ]
    .filter((c) => {
      if (c.type === 'add') return !inDeck(c.name);
      if (c.type === 'cut') return inDeck(c.name);
      return c.inName ? inDeck(c.inName) && !inDeck(c.name) : false;
    })
    .filter((c) => !settingsFit || settingsFit(c));
}
