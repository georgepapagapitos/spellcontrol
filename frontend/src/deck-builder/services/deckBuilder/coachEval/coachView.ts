/**
 * The Coach tab as the deck page assembles it, minus React (E538).
 *
 * `pages/DeckEditorPage.tsx` wires every Coach engine into the feed inside
 * `useMemo`s: the persisted analysis (`analyzeCommanderDeck`), the live role
 * counts, the owned-substitute plan, the land re-analysis, the ownership
 * filter on the budget lane, the Next-best-move hero, and the add-cards
 * suggestion rows. This module repeats that wiring call for call so the
 * evaluation harness measures what a user sees, not a proxy for it. The
 * engines are the product's own; only the glue is restated here, and each
 * block names the page code it mirrors.
 *
 * Known departures, each because the harness has no browser or backend:
 *  - ownership is by name (the page's is allocation-aware per copy);
 *  - combos come from the commander's EDHREC combo list, not the Commander
 *    Spellbook matcher (`combosFromEdhrec`);
 *  - no cross-deck moves (one deck, no sibling decks) and no AI "agrees".
 */
import type {
  EDHRECCombo,
  GapAnalysisCard,
  HiddenGemRow,
  ScryfallCard,
} from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import type { CommanderDeckAnalysisResult } from '../commanderDeckAnalysis';
import { computeRoleCounts } from '../commanderDeckAnalysis';
import { buildNextBestMoves, type NextBestMove } from '../nextBestMove';
import { computeLandUpgrades } from '../landUpgrades';
import { filterCostPlanByOwnership } from '../costAnalyzer';
import { buildSubstitutionOptions, type SubstituteCandidate } from '../substituteFinder';
import { ownedAlternativesReranker } from '@/deck-builder/services/substitutes/surfaces';
import { buildCoachChanges } from '@/lib/coach/coach-changes';
import { rankCoachMoves, diversifyRankedMoves, type RankedMove } from '@/lib/coach/coach-rank';
import type { ChangeOwnership } from '@/lib/coach/deck-change';
import { buildSuggestionRows, type SuggestionRows } from '@/lib/coach/deck-suggestions';
import { analyzeDeck } from '@/lib/deck-analysis/deck-analysis';
import { frontFaceName } from '@/lib/cards/card-text';

/** Commander decks are 100 cards counting the command zone (DECK_FORMAT_CONFIGS). */
export const COMMANDER_DECK_TARGET = 100;

export interface CoachViewInputs {
  commander: ScryfallCard;
  partner: ScryfallCard | null;
  /** The mainboard, one entry per copy, commanders excluded. */
  cards: ScryfallCard[];
  analysis: CommanderDeckAnalysisResult;
  /** Owned card names (exact). Empty for a deck with no collection. */
  ownedNames: ReadonlySet<string>;
  /** The owned pool the substitute finder ranks (one entry per name). */
  ownedPool: readonly SubstituteCandidate[];
  /** Owned lands as full cards (the page maps its collection copies). */
  ownedLands: readonly ScryfallCard[];
  /** The page's fetched on-color duals (`fetchFixingLands`). */
  fixingLands: readonly ScryfallCard[];
  combos: { inDeck: ComboMatch[]; oneAway: ComboMatch[] };
  /** The feed's "Owned only" toggle. */
  ownedOnly: boolean;
  /** Whether substitute ranking v2 has its card facts (the Coach tab loads them). */
  substitutesReady: boolean;
}

export interface CoachView {
  /** The Next-best-move hero, top 3, in the order shown. */
  nbm: NextBestMove[];
  /** Every ranked move after the feed's add dedupe and combo diversity pass. */
  ranked: RankedMove[];
  /** The "All" chip: adds and swaps, in rank order, after the Owned-only filter. */
  feed: RankedMove[];
  /** The "Cuts" chip: cut rows in rank order. */
  cuts: RankedMove[];
  /** The add-cards panel's suggestion rows (staples, combos, hidden gems). */
  suggestions: SuggestionRows;
  hiddenGems: HiddenGemRow[];
  roleCounts: Record<string, number>;
}

/** Name → ownership, the page's `ownershipFor` without per-copy allocation. */
export function ownershipByName(
  ownedNames: ReadonlySet<string>
): (name: string) => ChangeOwnership {
  const lower = new Set([...ownedNames].map((n) => n.toLowerCase()));
  return (name) => {
    const key = name.toLowerCase();
    if (lower.has(key)) return 'owned';
    if (name.includes(' // ') && lower.has(frontFaceName(name).toLowerCase())) return 'owned';
    return 'unowned';
  };
}

/**
 * The commander's EDHREC combo list as the Coach's two combo inputs: the
 * combos the deck completes (commanders count as deck cards, as in the page's
 * mainboard view) and the ones exactly one card short. The EDHREC card id is
 * not an oracle id, so the card name stands in for it on both sides.
 */
export function combosFromEdhrec(
  combos: readonly EDHRECCombo[],
  deckNames: readonly string[]
): { inDeck: ComboMatch[]; oneAway: ComboMatch[] } {
  const have = new Set<string>();
  for (const n of deckNames) {
    have.add(n);
    if (n.includes(' // ')) have.add(frontFaceName(n));
  }
  const inDeck: ComboMatch[] = [];
  const oneAway: ComboMatch[] = [];
  for (const c of combos) {
    const names = c.cards.map((x) => x.name);
    const missing = names.filter((n) => !have.has(n));
    if (missing.length > 1) continue;
    const match: ComboMatch = {
      combo: {
        id: c.comboId,
        identity: '',
        produces: c.results,
        prerequisites: null,
        description: null,
        manaNeeded: null,
        popularity: c.deckCount,
        cardCount: c.cardCount,
        bracket: c.bracket,
        bracketTag: c.bracketTag ?? null,
        cards: names.map((n) => ({ oracleId: n, cardName: n, quantity: 1 })),
      },
      presentOracleIds: names.filter((n) => have.has(n)),
      missingOracleIds: missing,
    };
    (missing.length === 0 ? inDeck : oneAway).push(match);
  }
  const byPopularity = (a: ComboMatch, b: ComboMatch) => b.combo.popularity - a.combo.popularity;
  return { inDeck: inDeck.sort(byPopularity), oneAway: oneAway.sort(byPopularity) };
}

/** Assemble the Coach tab for one deck, exactly as DeckEditorPage does. */
export function buildCoachView(input: CoachViewInputs): CoachView {
  const { analysis, cards, commander, partner, ownedNames } = input;
  const ownershipFor = ownershipByName(ownedNames);
  const identity = [
    ...new Set([...(commander.color_identity ?? []), ...(partner?.color_identity ?? [])]),
  ];

  // DeckEditorPage `liveRoleCounts`: the mainboard, one role per card.
  const roleCounts = computeRoleCounts(cards).roleCounts;
  const deckSize = cards.length + 1 + (partner ? 1 : 0);
  const deckNames = new Set(cards.map((c) => c.name.toLowerCase()));

  // DeckEditorPage `substitutionPlan`: missing role-bearing staples the user
  // doesn't own, each filled from the owned pool.
  const gaps: GapAnalysisCard[] = analysis.gapAnalysis ?? [];
  const missingStaples = gaps.filter((g) => g.role && !ownedNames.has(g.name));
  const exactDeckNames = new Set(cards.map((c) => c.name));
  const substitutes =
    missingStaples.length > 0 && input.ownedPool.length > 0
      ? buildSubstitutionOptions(missingStaples, input.ownedPool, exactDeckNames, identity, {
          inclusionByName: new Map(Object.entries(analysis.cardInclusionMap ?? {})),
          rerank: input.substitutesReady ? ownedAlternativesReranker([...exactDeckNames]) : null,
        }).rows
      : [];

  // DeckEditorPage `effectiveCostPlan`: no cheaper-swap row for a card the
  // user owns and can field.
  const costPlan = analysis.costPlan
    ? filterCostPlanByOwnership(analysis.costPlan, (name) => ownershipFor(name) === 'owned')
    : undefined;

  // DeckEditorPage `landUpgrades`: owned unused lands + fetched duals.
  const seen = new Set<string>();
  const candidateLands: ScryfallCard[] = [];
  for (const c of [...input.ownedLands, ...input.fixingLands]) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    candidateLands.push(c);
  }
  const landUpgrades =
    identity.length > 0
      ? computeLandUpgrades(cards, new Set(identity), candidateLands, new Set(ownedNames))
      : [];

  // CoachFeed `allChanges` → `ranked` (rank, dedupe adds by name, diversify).
  const changes = buildCoachChanges(
    {
      gaps,
      optimize: analysis.optimizeSwaps,
      misfits: analysis.misfits,
      synergy: analysis.synergyAnalysis?.suggestions ?? [],
      substitutes,
      costPlan,
      bracketFit: analysis.bracketFit ?? undefined,
      landUpgrades,
      oneAwayCombos: input.combos.oneAway,
      crossDeckMoves: [],
    },
    ownershipFor,
    deckNames
  );
  const all = rankCoachMoves(changes, {
    planScore: analysis.planScore,
    roleCounts,
    roleTargets: analysis.roleTargets ?? {},
    deckSize,
    deckTarget: COMMANDER_DECK_TARGET,
    bracketOverridePresent: false,
    ownedNames: new Set(ownedNames),
  });
  const seenAdds = new Set<string>();
  const ranked = diversifyRankedMoves(
    all.filter((m) => {
      if (m.change.type !== 'add') return true;
      const key = m.change.name.toLowerCase();
      if (seenAdds.has(key)) return false;
      seenAdds.add(key);
      return true;
    })
  );
  const feed = ranked.filter(
    (r) => r.change.type !== 'cut' && (!input.ownedOnly || r.change.ownership === 'owned')
  );
  const cuts = ranked.filter((r) => r.change.type === 'cut');

  // DeckEditorPage `landAdvice` + `nextBestMoves`.
  const lands = analyzeDeck(
    {
      format: 'commander',
      commander,
      partnerCommander: partner,
      mainboard: cards.map((card, i) => ({ slotId: String(i), card })),
    },
    true
  ).roles.find((r) => r.key === 'lands');
  const nbm = buildNextBestMoves({
    planScore: analysis.planScore,
    roleCounts,
    roleTargets: analysis.roleTargets ?? {},
    gapAnalysis: analysis.gapAnalysis,
    cardCount: deckSize,
    deckTarget: COMMANDER_DECK_TARGET,
    oneAwayCombos: input.combos.oneAway,
    ownedNames: new Set(ownedNames),
    winConditions: analysis.winConditions,
    bracketFitHasMoves: (analysis.bracketFit?.moves.length ?? 0) > 0,
    ownedOnly: input.ownedOnly,
    landAdvice:
      lands?.suggested != null ? { count: lands.count, suggested: lands.suggested } : undefined,
  });

  // CardSearchPanel `SuggestionsResults`, every availability toggle on.
  const suggestions = buildSuggestionRows(analysis.gapAnalysis, input.combos.oneAway, {
    ownershipFor,
    query: '',
    inDeck: deckNames,
    show: { owned: true, inOtherDeck: true, inCube: true, unowned: true },
    hiddenGems: analysis.hiddenGems ?? [],
  });

  return {
    nbm,
    ranked,
    feed,
    cuts,
    suggestions,
    hiddenGems: analysis.hiddenGems ?? [],
    roleCounts,
  };
}
