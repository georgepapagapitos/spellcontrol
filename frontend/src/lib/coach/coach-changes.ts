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
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { BracketFitPlan } from '@/deck-builder/services/deckBuilder/bracketFit';
import type { LandUpgradeMove } from '@/deck-builder/services/deckBuilder/landUpgrades';
import type { MisfitSummary } from '@/deck-builder/services/deckBuilder/cardFit';
import type { ComboMatch } from '@/types/combos';

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
  /** E90: owned copies idle in a sibling deck. */
  crossDeckMoves?: CrossDeckMove[];
}

/**
 * `deckNames` is the lowercased live mainboard. The persisted analyses don't
 * recompute on an apply, so this is what drops an applied row (and brings an
 * undone one back): adds need their card absent, cuts need it present, swaps
 * need the outgoing card present and the incoming card absent.
 */
export function buildCoachChanges(
  src: CoachChangeSources,
  resolveOwnership: (name: string) => ChangeOwnership,
  deckNames: Set<string>
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
  const costChanges: Change[] = allCostRows.map((row) =>
    fromCostSwapRow(row, resolveOwnership(row.suggestionName))
  );

  const bracketChanges: Change[] = (src.bracketFit?.moves ?? []).map((m) => {
    if (m.type === 'swap' && m.inName) {
      return fromBracketFitMove(m, resolveOwnership(m.inName));
    }
    return fromBracketFitMove(m, m.type === 'cut' ? undefined : resolveOwnership(m.name));
  });

  const comboChanges: Change[] = (src.oneAwayCombos ?? [])
    .filter((match) => match.missingOracleIds.length === 1)
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
  ].filter((c) => {
    if (c.type === 'add') return !inDeck(c.name);
    if (c.type === 'cut') return inDeck(c.name);
    return c.inName ? inDeck(c.inName) && !inDeck(c.name) : false;
  });
}
