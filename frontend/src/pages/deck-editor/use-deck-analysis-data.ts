import { useDeferredValue, useMemo } from 'react';
import { useDecksStore, type Deck } from '@/store/decks';
import { useBuildTimeNudge } from '@/lib/coach/use-build-time-nudge';
import { buildNextBestMoves } from '@/deck-builder/services/deckBuilder/nextBestMove';
import { fromGapCard, type ChangeOwnership } from '@/lib/coach/deck-change';
import type { GapAnalysisCard } from '@/deck-builder/types';
import { useReplaceCuts } from '@/lib/coach/replace-cuts';
import { onPlanCombos } from '@/lib/coach/coach-changes';
import { combosThatFit, gapsThatFit, useCoachSettings } from '@/lib/coach/deck-settings-fit';
import { analyzeDeck } from '@/lib/deck-analysis/deck-analysis';
import { useTaggerReady } from '@/lib/cards/use-tagger-ready';
import { findCrossDeckMoves } from '@/lib/coach/cross-deck-moves';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { useDeckCombos } from '@/lib/deck-analysis/use-deck-combos';
import { useCommanderBracketAnalysis } from '@/lib/deck-analysis/use-commander-bracket-analysis';
import { buildUpgradePlanTools } from '@/lib/coach/upgrade-plan-tools';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { NO_DECKS } from './deck-editor-helpers';
import { useSuggestGroups } from './use-suggest-groups';
import type { ComboMatchResponse } from '@/types/combos';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { AllocationInfo } from '@/lib/collection/allocations';
import type { DeckFormatConfig } from '@/deck-builder/types';

export function useDeckAnalysisData({
  deck,
  mainboardComboData,
  comboData,
  commanderColorIdentity,
  collectionCards,
  printingAllocationMap,
  formatConfig,
  planOpen,
  ownedNames,
  mainboardLimit,
  ownershipFor,
  ownedOnly,
}: {
  deck: Deck;
  mainboardComboData: ComboMatchResponse | null;
  comboData: ReturnType<typeof useDeckCombos>;
  commanderColorIdentity: string[];
  collectionCards: EnrichedCard[];
  printingAllocationMap: Map<string, AllocationInfo>;
  formatConfig: DeckFormatConfig | null;
  planOpen: boolean;
  ownedNames: Set<string>;
  mainboardLimit: number;
  ownershipFor: (name: string) => ChangeOwnership;
  ownedOnly: boolean;
}) {
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const decks = useDecksStore((s) => s.decks);

  // Keep grade/bracket live for any commander deck as its cards change —
  // generated and manual alike (the user's bracketOverride layers on top).
  // E162: also surfaces 'error' (EDHREC unreachable / commander not indexed /
  // stalled fetch) + retry() so a permanently failed first analysis doesn't
  // read as an endless skeleton — see analysisState below.
  // Coach shows only moves the deck's saved settings allow (price, budget, rarity, …).
  const coachSettings = useCoachSettings(deck, ownedNames, mainboardLimit);
  // The analysis' "cards to consider" fits those settings before its top-30 cut.
  const gapFit = useMemo(() => {
    const fit = coachSettings.fit;
    return fit
      ? (gap: GapAnalysisCard) => fit(fromGapCard(gap, ownershipFor(gap.name)))
      : undefined;
  }, [coachSettings.fit, ownershipFor]);
  const bracketAnalysis = useCommanderBracketAnalysis({
    deck,
    comboData: mainboardComboData,
    combosLoading: comboData.loading,
    mainboardSize: deck ? DECK_FORMAT_CONFIGS[deck.format].mainboardSize : undefined,
    hasCommander: deck ? DECK_FORMAT_CONFIGS[deck.format].hasCommander : false,
    colorIdentity: commanderColorIdentity,
    updateDeck,
    // The user's target bracket drives the Bracket Fit plan; folding it into the
    // hook recomputes the plan when the target changes, not only when cards do.
    bracketOverride: deck?.bracketOverride,
    gapFit,
  });

  // Build-time coach nudge (E169 Half B) — surfaces at most one combo/
  // win-condition/bracket signal inside the add-cards sheet the instant a
  // mainboard add produces one. See use-build-time-nudge.ts for the guard.
  const buildTimeNudge = useBuildTimeNudge({
    deckId: deck?.id,
    deck,
    comboData: mainboardComboData,
    mainboardTarget: deck ? DECK_FORMAT_CONFIGS[deck.format].mainboardSize : undefined,
  });

  const taggerReady = useTaggerReady();
  const suggestGroups = useSuggestGroups(deck ?? undefined, taggerReady);

  // E90 "Your decks" Coach rows: owned copies idle in a sibling deck that would
  // feed an engine here, each paired with an owned patch for the deck it
  // leaves. taggerReady is a recompute trigger (the replacement search reads
  // the tagger's roles), not read directly.
  // The scan classifies every card of every deck (1.1 s at 4x CPU on 33 decks)
  // and none of it is on screen at first paint, so it reads a deferred copy of
  // the deck list: the first render scans nothing, the real scan runs in a
  // background render after the page commits, and a deck edit's own render
  // never waits on it (E412).
  const crossDeckDecks = useDeferredValue(decks, NO_DECKS);
  const crossDeckMoves = useMemo(
    () =>
      deck && DECK_FORMAT_CONFIGS[deck.format].hasCommander
        ? findCrossDeckMoves(crossDeckDecks, collectionCards, printingAllocationMap, {
            toDeckId: deck.id,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taggerReady is a recompute trigger, not read directly
    [deck, crossDeckDecks, collectionCards, printingAllocationMap, taggerReady]
  );

  // Curve-derived land-count advice for the hero — the lands RoleHealth from
  // the same analyzeDeck the Analysis panel renders, so badge and hero agree
  // on both the number and when it applies (Karsten gate lives in there).
  const landAdvice = useMemo(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander) return undefined;
    const lands = analyzeDeck(
      {
        format: deck.format,
        commander: deck.commander,
        partnerCommander: deck.partnerCommander,
        mainboard: deck.cards,
      },
      taggerReady
    ).roles.find((r) => r.key === 'lands');
    return lands?.suggested != null
      ? { count: lands.count, suggested: lands.suggested }
      : undefined;
  }, [deck, taggerReady]);

  // The deck's live role counts: the same count DeckDisplay shows in the
  // role chips, the Roles panel and the checks (mainboard, one role per card).
  // A generated deck's stored `roleCounts` is a generation-time snapshot that
  // never moves after an edit, and a manual deck has none (the coach used to
  // see every role at 0 there), so it only stands in until the tagger loads.
  const liveRoleCounts = useMemo(
    () =>
      deck && taggerReady
        ? computeRoleCounts(deck.cards.map((c) => c.card)).roleCounts
        : deck?.roleCounts,
    [deck, taggerReady]
  );

  // E458: the upgrade plan's bracket side. Built only while the plan is open:
  // it runs the estimator, which a closed sheet has no use for.
  const planAvailable = !!deck?.commander && !!formatConfig?.hasCommander;
  const upgradePlanTools = useMemo(() => {
    if (!planOpen || !deck?.commander || !DECK_FORMAT_CONFIGS[deck.format].hasCommander) {
      return null;
    }
    return buildUpgradePlanTools({
      deckCards: deck.cards.map((c) => c.card),
      commanderNames: [deck.commander.name, deck.partnerCommander?.name].filter(
        (n): n is string => !!n
      ),
      combos: mainboardComboData,
      roleCounts: liveRoleCounts ?? {},
      // Before the first analysis lands the sheet shows its loading state, so
      // this fallback is never read as the deck's bracket.
      estimate: deck.bracketEstimation?.bracket ?? 2,
      stated: deck.bracketOverride,
      cardInclusionMap: deck.cardInclusionMap,
    });
  }, [planOpen, deck, mainboardComboData, liveRoleCounts]);

  const replaceCuts = useReplaceCuts(
    deck,
    mainboardComboData,
    coachSettings.cutFits,
    mainboardLimit
  );
  // "Next best move": the highest-leverage change, from the PlanScore, role gaps and near-miss combos.
  const nextBestMoves = useMemo(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander) return [];
    const roleCounts = liveRoleCounts ?? {};
    return buildNextBestMoves({
      planScore: deck.planScore,
      roleCounts,
      roleTargets: deck.roleTargets ?? {},
      gapAnalysis: gapsThatFit(deck.gapAnalysis, coachSettings.fit, ownershipFor),
      // Count the commander zone too (incl. a partner) so the total matches
      // the Deck tab's header and the 100-card (deckSize) target — commanders
      // live in their own fields, not in deck.cards.
      cardCount: deck.cards.length + (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0),
      deckTarget: DECK_FORMAT_CONFIGS[deck.format].deckSize,
      oneAwayCombos: onPlanCombos(
        combosThatFit(mainboardComboData?.oneAway, coachSettings.fit, ownershipFor),
        deck.suggestionCards
      ),
      deckPayoffs: coachSettings.deckPayoffs,
      ownedNames,
      winConditions: deck.winConditions,
      bracketFitHasMoves: (deck.bracketFit?.moves.length ?? 0) > 0,
      ownedOnly,
      landAdvice,
    });
  }, [
    deck,
    liveRoleCounts,
    mainboardComboData,
    ownedNames,
    ownedOnly,
    landAdvice,
    coachSettings,
    ownershipFor,
  ]);

  // UX-310: whether the async commander-deck analysis is still in its first
  // run. `gradeBracketSignature` is only set after a successful analysis
  // completes, so its absence means no result has landed yet. Non-commander
  // decks or decks without a commander skip analysis entirely → 'ready'.
  // E162: once a signature has EVER persisted, a later background re-analysis
  // failing is deliberately silent (stale-but-fine result stays on screen —
  // see the hook's own docs) — 'error' only applies before the FIRST success,
  // which is the case that used to skeleton forever with no way out.
  const analysisState = useMemo<'pending' | 'ready' | 'error'>(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander || !deck.commander) return 'ready';
    if (deck.gradeBracketSignature) return 'ready';
    return bracketAnalysis.status === 'error' ? 'error' : 'pending';
  }, [deck, bracketAnalysis.status]);

  // Session-scoped reveal key for score animations. Non-null only when analysis
  // is ready and the deck has a gradeBracketSignature. The module-level registry
  // in use-animated-number ensures the reveal fires exactly once per key (even
  // across tab switches and remounts) — no latch state needed here.
  const scoreRevealKey = useMemo<string | null>(() => {
    if (!deck) return null;
    if (analysisState !== 'ready') return null;
    if (!deck.gradeBracketSignature) return null;
    return `${deck.id}:${deck.gradeBracketSignature}`;
  }, [deck, analysisState]);

  return {
    liveRoleCounts,
    taggerReady,
    buildTimeNudge,
    analysisState,
    bracketAnalysis,
    replaceCuts,
    crossDeckMoves,
    suggestGroups,
    scoreRevealKey,
    coachSettings,
    planAvailable,
    upgradePlanTools,
    nextBestMoves,
  };
}
