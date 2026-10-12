import { useDecksStore, effectiveBracket, type Deck } from '@/store/decks';
import { DeckDisplay } from '@/components/deck/DeckDisplay';
import { type DeckView } from '@/lib/deck-analysis/deck-view';
import {
  bracketReasons,
  bracketBorderline,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { type CardSearchPanelHandle } from '@/components/deck/CardSearchPanel';
import { DeckCombosPanel } from '@/components/deck/DeckCombosPanel';
import { DeckAnalysisPanel } from '@/components/deck/DeckAnalysisPanel';
import { DeckAiReview } from '@/components/deck/DeckAiReview';
import { DeckAiRefine } from '@/components/deck/DeckAiRefine';
import { AiSourcesControl } from '@/components/deck/AiSourcesControl';
import { PowerHero } from '@/components/deck/PowerHero';
import { TableRecordPanel } from '@/components/deck/TableRecordPanel';
import { BracketTableRead } from '@/components/deck/BracketTableRead';
import { CoachFeed } from '@/components/deck/CoachFeed';
import { EnginePanel } from '@/components/deck/EnginePanel';
import { WinConditionPanel } from '@/components/deck/WinConditionPanel';
import { toggleWinConTag } from '@/deck-builder/services/winConditions/winConTags';
import { type Change } from '@/lib/coach/deck-change';
import { winningCombos } from '@/lib/coach/coach-changes';
import { buildWinConditionSummary } from '@/lib/deck-analysis/win-condition-summary';
import { isValidCommander, isPdhCommanderEligible } from '@/lib/deck/commanders';
import { canHavePartner } from '@/deck-builder/lib/partnerUtils';
import type { ScryfallCard } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { deckEditActions } from './deck-page-chrome';
import type { DeckZone } from '@/store/decks';
import type { DeckFormatConfig } from '@/deck-builder/types';
import type { Dispatch, SetStateAction, RefObject, JSX } from 'react';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { BinderRef } from '@/lib/binder/use-binder-by-copy';
import type { ComboMatchResponse, ComboMatch } from '@/types/combos';
import type { LandUpgradeMove } from '@/deck-builder/services/deckBuilder/landUpgrades';
import type { ArrivalRow } from '@/lib/coach/new-arrivals';
import type { ChangeOwnership, LaneId } from '@/lib/coach/deck-change';
import type { ClockCard } from '@/lib/mana-sim/opening-hand-sim';
import type { DeckViewTab } from './deck-page-chrome';
import type { AiScope } from '@/lib/ai/ai-scope';
import type { RefineCard } from '@/lib/ai/ai-refine';
import type { DeckCombosPanelHandle } from '@/components/deck/DeckCombosPanel';
import type { SubstitutionPlan } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { CoachSettingsHooks } from '@/lib/coach/deck-settings-fit';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { CrossDeckMove } from '@/lib/coach/cross-deck-moves';
import type { ReplaceCuts } from '@/lib/coach/replace-cuts';
import type { UpgradePlanTools } from '@/lib/coach/upgrade-plan-tools';
import type { PlanStep } from '@/lib/coach/apply-upgrade-plan';
import type {
  NextBestMove,
  NextBestMoveFocus,
} from '@/deck-builder/services/deckBuilder/nextBestMove';
import type { AxisSummary } from '@/deck-builder/services/synergy/deckSynergy';
import type { useDeckCombos } from '@/lib/deck-analysis/use-deck-combos';

export function DeckEditorLayout({
  deck,
  handleRemoveCard,
  handleRemoveSideboardCard,
  handleRemoveConsideringCard,
  handleMoveToSideboard,
  handleMoveToMainboard,
  handleMoveToConsidering,
  handleMoveFromConsidering,
  handleSetQty,
  handleEditCard,
  handleSetCardTags,
  handleRenameDeckTag,
  handleRemoveDeckTag,
  handleBulkRemove,
  handleBulkMove,
  handleBulkEditTag,
  handleReorder,
  formatConfig,
  handleMakeCommanderClick,
  handleMakePartnerClick,
  canMakePartner,
  setShowCommanderPicker,
  cover,
  setShowPartnerPicker,
  setMoveCard,
  setReleaseCard,
  handleSetProxy,
  handleUseOwnCopy,
  collectionById,
  binderByCopyId,
  setShowAddPanel,
  searchPanelRef,
  handleAddEngineCard,
  isCommander,
  mainboardLimit,
  setShowFill,
  addingEngineNames,
  mainboardComboData,
  ownedOracleIdSet,
  landUpgrades,
  coachArrivals,
  arrivalsDeepLink,
  arrivalsSettled,
  existingCardCounts,
  ownershipFor,
  combosByOracle,
  bracketAnalysis,
  deckLibrary,
  exportOpen,
  setExportOpen,
  safeView,
  viewTabs,
  setShowTestHand,
  isDesktop,
  statSlot,
  setAppendOpen,
  setBulkEditOpen,
  setResyncOpen,
  hasCopyMismatches,
  handleMatchMyCopies,
  hasMissingSlots,
  handleCheapestPrintings,
  suggestGroups,
  handleToggleAddPanel,
  analysisState,
  scoreRevealKey,
  handleNavigateToTune,
  renderSwapSuggestions,
  renderSimilarCards,
  comboOwnedMissingCount,
  comboData,
  handleViewBracket,
  handleViewEngine,
  handleViewCombos,
  handleViewWinConditions,
  aiScope,
  collectionCards,
  setAiAgrees,
  refinePool,
  refineAlternatives,
  handleApplyCoachMove,
  handleApplyCostSwaps,
  combosRef,
  deckOracleIds,
  mainboardOracleIds,
  comboColorIdentity,
  substitutionPlan,
  coachSettings,
  effectiveCostPlan,
  crossDeckMoves,
  liveRoleCounts,
  ownedNames,
  deckCardNames,
  handleCoachPreviewFit,
  tuneFocusLane,
  clearTuneFocus,
  bracketFitSwapName,
  ownedOnly,
  handleOwnedOnlyChange,
  replaceCuts,
  aiAgrees,
  planAvailable,
  upgradePlanTools,
  planOpen,
  setPlanOpen,
  handleApplyPlan,
  nextBestMoves,
  handleNbmNavigate,
  axisSummaries,
  deckCards,
}: {
  deck: Deck;
  handleRemoveCard: (slotId: string) => void;
  handleRemoveSideboardCard: (slotId: string) => void;
  handleRemoveConsideringCard: (slotId: string) => void;
  handleMoveToSideboard: (slotIds: string[]) => void;
  handleMoveToMainboard: (slotIds: string[]) => void;
  handleMoveToConsidering: (slotIds: string[]) => void;
  handleMoveFromConsidering: (slotIds: string[]) => void;
  handleSetQty: (
    zone: DeckZone,
    card: ScryfallCard,
    qty: number,
    opts?: { relative?: boolean }
  ) => void;
  handleEditCard: (slotId: string, card: ScryfallCard) => void;
  handleSetCardTags: (zone: DeckZone, slotIds: string[], tags: string[]) => void;
  handleRenameDeckTag: (from: string, to: string) => void;
  handleRemoveDeckTag: (tag: string) => void;
  handleBulkRemove: (zone: DeckZone, slotIds: string[]) => void;
  handleBulkMove: (slotIds: string[], from: DeckZone, to: DeckZone) => void;
  handleBulkEditTag: (zone: DeckZone, slotIds: string[], tag: string, add: boolean) => void;
  handleReorder: (zone: DeckZone, slotIds: string[], sortIndex: number) => void;
  formatConfig: DeckFormatConfig | null;
  handleMakeCommanderClick: (slotId: string, card: ScryfallCard) => void;
  handleMakePartnerClick: (slotId: string, card: ScryfallCard) => void;
  canMakePartner: (card: ScryfallCard) => boolean;
  setShowCommanderPicker: Dispatch<SetStateAction<boolean>>;
  cover:
    | { chosen: string | null; current: string | null; set: (name: string | null) => void }
    | undefined;
  setShowPartnerPicker: Dispatch<SetStateAction<boolean>>;
  setMoveCard: Dispatch<SetStateAction<ScryfallCard | null>>;
  setReleaseCard: Dispatch<SetStateAction<ScryfallCard | null>>;
  handleSetProxy: (slotIds: string[], proxy: boolean) => void;
  handleUseOwnCopy: (card: ScryfallCard) => void;
  collectionById: Map<string, EnrichedCard> | undefined;
  binderByCopyId: Map<string, BinderRef[]>;
  setShowAddPanel: Dispatch<SetStateAction<boolean>>;
  searchPanelRef: RefObject<CardSearchPanelHandle | null>;
  handleAddEngineCard: (cardName: string) => Promise<void>;
  isCommander: boolean;
  mainboardLimit: number;
  setShowFill: Dispatch<SetStateAction<boolean>>;
  addingEngineNames: Set<string>;
  mainboardComboData: ComboMatchResponse | null;
  ownedOracleIdSet: Set<string>;
  landUpgrades: LandUpgradeMove[];
  coachArrivals: Partial<
    Record<
      | 'Land'
      | 'Creature'
      | 'Planeswalker'
      | 'Battle'
      | 'Sorcery'
      | 'Instant'
      | 'Artifact'
      | 'Enchantment',
      ArrivalRow[]
    >
  >;
  arrivalsDeepLink: boolean;
  arrivalsSettled: boolean;
  existingCardCounts: Map<string, number>;
  ownershipFor: (name: string) => ChangeOwnership;
  combosByOracle: Map<string, ComboMatch[]>;
  bracketAnalysis: {
    status: 'pending' | 'ready' | 'error';
    retry: () => void;
    missesCombos: boolean;
    edhrecMissing: boolean;
  };
  deckLibrary: ClockCard[];
  exportOpen: boolean;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  safeView: DeckView;
  viewTabs: DeckViewTab[];
  setShowTestHand: Dispatch<SetStateAction<boolean>>;
  isDesktop: boolean;
  statSlot: HTMLDivElement | null;
  setAppendOpen: Dispatch<SetStateAction<boolean>>;
  setBulkEditOpen: Dispatch<SetStateAction<boolean>>;
  setResyncOpen: Dispatch<SetStateAction<boolean>>;
  hasCopyMismatches: boolean;
  handleMatchMyCopies: () => Promise<void>;
  hasMissingSlots: boolean;
  handleCheapestPrintings: () => Promise<void>;
  suggestGroups: { pending: boolean; run: () => void } | undefined;
  handleToggleAddPanel: () => void;
  analysisState: 'error' | 'pending' | 'ready';
  scoreRevealKey: string | null;
  handleNavigateToTune: (lane: LaneId) => void;
  renderSwapSuggestions: (
    card: ScryfallCard,
    slotId: string,
    close: () => void
  ) => JSX.Element | null;
  renderSimilarCards: (card: ScryfallCard, slotId: string, close: () => void) => JSX.Element | null;
  comboOwnedMissingCount: number;
  comboData: ReturnType<typeof useDeckCombos>;
  handleViewBracket: () => void;
  handleViewEngine: () => void;
  handleViewCombos: () => void;
  handleViewWinConditions: () => void;
  aiScope: AiScope;
  collectionCards: EnrichedCard[];
  setAiAgrees: Dispatch<SetStateAction<ReadonlyMap<string, string> | null>>;
  refinePool: RefineCard[];
  refineAlternatives: Map<string, string[]>;
  handleApplyCoachMove: (change: Change) => Promise<void>;
  handleApplyCostSwaps: (
    swaps: Array<{ removeName: string; addName: string }>,
    kind?: 'budget' | 'bracket' | 'ai'
  ) => Promise<void>;
  combosRef: RefObject<DeckCombosPanelHandle | null>;
  deckOracleIds: string[];
  mainboardOracleIds: Set<string>;
  comboColorIdentity: string[] | undefined;
  substitutionPlan: SubstitutionPlan | null;
  coachSettings: CoachSettingsHooks;
  effectiveCostPlan: CostPlan | null;
  crossDeckMoves: CrossDeckMove[];
  liveRoleCounts: Record<string, number> | undefined;
  ownedNames: Set<string>;
  deckCardNames: Set<string>;
  handleCoachPreviewFit: (change: Change) => Promise<void>;
  tuneFocusLane: LaneId | null;
  clearTuneFocus: () => void;
  bracketFitSwapName: string | null;
  ownedOnly: boolean;
  handleOwnedOnlyChange: (next: boolean) => void;
  replaceCuts: ReplaceCuts;
  aiAgrees: ReadonlyMap<string, string> | null;
  planAvailable: boolean;
  upgradePlanTools: UpgradePlanTools | null;
  planOpen: boolean;
  setPlanOpen: Dispatch<SetStateAction<boolean>>;
  handleApplyPlan: (steps: PlanStep[], toCopy: boolean) => Promise<void>;
  nextBestMoves: NextBestMove[];
  handleNbmNavigate: (next: DeckView, focus?: NextBestMoveFocus) => void;
  axisSummaries: AxisSummary[] | undefined;
  deckCards: ScryfallCard[];
}) {
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const markArrivalsReviewed = useDecksStore((s) => s.markArrivalsReviewed);
  const addCard = useDecksStore((s) => s.addCard);
  const decks = useDecksStore((s) => s.decks);
  return (
    <>
      <div className="deck-editor-layout">
        <div className="deck-editor-main">
          <DeckDisplay
            title={deck.name}
            deckId={deck.id}
            format={deck.format}
            commander={deck.commander}
            partnerCommander={deck.partnerCommander}
            selectedThemes={deck.generationContext?.selectedThemes}
            commanderAllocatedCopyId={deck.commanderAllocatedCopyId}
            partnerCommanderAllocatedCopyId={deck.partnerCommanderAllocatedCopyId}
            // The deck's own slots, never rebuilt field by field: a copy that
            // listed fields dropped `proxy` and `sortIndex` on the way.
            cards={deck.cards}
            sideboard={deck.sideboard}
            considering={deck.considering ?? []}
            onRemoveCard={handleRemoveCard}
            onRemoveSideboardCard={handleRemoveSideboardCard}
            onRemoveConsideringCard={handleRemoveConsideringCard}
            onMoveToSideboard={handleMoveToSideboard}
            onMoveToMainboard={handleMoveToMainboard}
            onMoveToConsidering={handleMoveToConsidering}
            onMoveFromConsidering={handleMoveFromConsidering}
            onSetQty={handleSetQty}
            onEditCard={handleEditCard}
            onSetCardTags={handleSetCardTags}
            onRenameDeckTag={handleRenameDeckTag}
            onRemoveDeckTag={handleRemoveDeckTag}
            onBulkRemove={handleBulkRemove}
            onBulkMove={handleBulkMove}
            onBulkEditTag={handleBulkEditTag}
            onReorder={handleReorder}
            onMakeCommander={formatConfig?.hasCommander ? handleMakeCommanderClick : undefined}
            canMakeCommander={
              formatConfig?.hasCommander
                ? deck.format === 'paupercommander'
                  ? isPdhCommanderEligible
                  : isValidCommander
                : undefined
            }
            onMakePartner={
              formatConfig?.hasCommander && deck.commander ? handleMakePartnerClick : undefined
            }
            canMakePartner={
              formatConfig?.hasCommander && deck.commander ? canMakePartner : undefined
            }
            onChangeCommander={
              formatConfig?.hasCommander && deck.commander
                ? () => setShowCommanderPicker(true)
                : undefined
            }
            cover={cover}
            onEditPartner={
              formatConfig?.hasCommander && deck.commander && canHavePartner(deck.commander)
                ? () => setShowPartnerPicker(true)
                : undefined
            }
            onMoveToAnotherDeck={decks.length > 1 ? setMoveCard : undefined}
            onReleaseCopy={setReleaseCard}
            onSetProxy={handleSetProxy}
            onUseOwnCopy={handleUseOwnCopy}
            collectionByCopyId={collectionById}
            binderByCopyId={binderByCopyId}
            onAddFromSearch={(q) => {
              setShowAddPanel(true);
              window.requestAnimationFrame(() => searchPanelRef.current?.seed(q));
            }}
            roleCounts={deck.roleCounts}
            roleTargets={deck.roleTargets}
            categoryTargets={deck.categoryTargets}
            buildReport={deck.buildReport}
            onAddSuggestedCard={handleAddEngineCard}
            {...(isCommander &&
              deck.commander &&
              deck.cards.length < mainboardLimit && {
                openSlots: mainboardLimit - deck.cards.length,
                onFill: () => setShowFill(true),
              })}
            addingSuggestedCardNames={addingEngineNames}
            oneAwayCombos={mainboardComboData?.oneAway}
            ownedOracleIds={ownedOracleIdSet}
            landUpgradeCount={landUpgrades.length}
            arrivalsByType={coachArrivals}
            autoOpenArrivals={arrivalsDeepLink && arrivalsSettled}
            existingCardCounts={existingCardCounts}
            ownershipFor={ownershipFor}
            onMarkArrivalsReviewed={() => markArrivalsReviewed(deck.id)}
            cardInclusionMap={deck.cardInclusionMap}
            combosByOracle={combosByOracle}
            rampSubtypeCounts={deck.rampSubtypeCounts}
            removalSubtypeCounts={deck.removalSubtypeCounts}
            boardwipeSubtypeCounts={deck.boardwipeSubtypeCounts}
            cardDrawSubtypeCounts={deck.cardDrawSubtypeCounts}
            bracketEstimation={deck.bracketEstimation}
            bracketOverride={deck.bracketOverride}
            bracketMissesCombos={bracketAnalysis.missesCombos}
            onSetBracketOverride={(b) => updateDeck(deck.id, { bracketOverride: b })}
            clockLibrary={deckLibrary}
            bracketTableSlot={<BracketTableRead deckId={deck.id} />}
            archetypeOverride={deck.archetypeOverride}
            onSetArchetypeOverride={(a) => updateDeck(deck.id, { archetypeOverride: a })}
            deckGrade={deck.deckGrade}
            planScore={deck.planScore}
            edhrecNumDecks={deck.edhrecNumDecks}
            averageSalt={deck.averageSalt}
            saltiestCards={deck.saltiestCards}
            exportOpen={exportOpen}
            onExportOpenChange={setExportOpen}
            activeView={safeView}
            tabbed={viewTabs.length > 1}
            onShowTestHand={() => setShowTestHand(true)}
            statStripSlot={isDesktop ? statSlot : null}
            deckActionsInHeader
            editActions={deckEditActions({
              paste: () => setAppendOpen(true),
              bulkEdit: () => setBulkEditOpen(true),
              resync: () => setResyncOpen(true),
              matchCopies: hasCopyMismatches ? () => void handleMatchMyCopies() : undefined,
              cheapestPrintings: hasMissingSlots ? () => void handleCheapestPrintings() : undefined,
            })}
            suggestGroups={suggestGroups}
            onAddCards={handleToggleAddPanel}
            onChooseCommander={
              formatConfig?.hasCommander ? () => setShowCommanderPicker(true) : undefined
            }
            analysisState={analysisState}
            scoreRevealKey={scoreRevealKey}
            onNavigateToTune={
              // Only wire the deep-link when analysis has run — until then the
              // Tune lanes don't exist yet, so a deep-link would land on nothing.
              analysisState === 'ready' ? handleNavigateToTune : undefined
            }
            onRetryAnalysis={
              analysisState === 'error' || bracketAnalysis.edhrecMissing
                ? bracketAnalysis.retry
                : undefined
            }
            edhrecMissing={bracketAnalysis.edhrecMissing}
            renderSwapSuggestions={renderSwapSuggestions}
            renderSimilarCards={renderSimilarCards}
            powerHeroSlot={
              formatConfig?.hasCommander ? (
                <PowerHero
                  bracket={effectiveBracket(deck) ?? null}
                  bracketOverridden={deck.bracketOverride != null}
                  bracketEstimate={deck.bracketEstimation?.bracket ?? null}
                  revealKey={scoreRevealKey}
                  bracketReasons={
                    deck.bracketEstimation ? bracketReasons(deck.bracketEstimation) : []
                  }
                  bracketBorderline={
                    deck.bracketEstimation ? bracketBorderline(deck.bracketEstimation) : null
                  }
                  engineLabel={deck.synergyAnalysis?.axes[0]?.label}
                  engineProducers={deck.synergyAnalysis?.axes[0]?.producers}
                  enginePayoffs={deck.synergyAnalysis?.axes[0]?.payoffs}
                  engineLopsided={(deck.synergyAnalysis?.warnings.length ?? 0) > 0}
                  comboInDeck={mainboardComboData?.inDeck.length ?? 0}
                  comboOneAway={mainboardComboData?.oneAway.length ?? 0}
                  comboOwnedMissing={comboOwnedMissingCount}
                  combosLoading={!!formatConfig?.hasCommander && comboData.loading}
                  bracketMissesCombos={bracketAnalysis.missesCombos}
                  combosError={comboData.error}
                  onRetryCombos={comboData.refetch}
                  bracketPending={analysisState === 'pending'}
                  // Link a pillar to its panel only when that panel actually renders below.
                  onViewBracket={
                    deck.bracketEstimation || deck.bracketOverride != null
                      ? handleViewBracket
                      : undefined
                  }
                  onViewEngine={
                    deck.synergyAnalysis &&
                    (deck.synergyAnalysis.warnings.length > 0 ||
                      deck.synergyAnalysis.axes.length > 0)
                      ? handleViewEngine
                      : undefined
                  }
                  onViewCombos={handleViewCombos}
                  winConditionSummary={buildWinConditionSummary(
                    deck.winConditions,
                    bracketAnalysis.missesCombos
                  )}
                  winConditionWarn={
                    deck.winConditions?.noClearWinCondition && !bracketAnalysis.missesCombos
                  }
                  onViewWinConditions={deck.winConditions ? handleViewWinConditions : undefined}
                  // UX-313: target bracket control in the PowerHero
                  bracketOverride={deck.bracketOverride}
                  onSetBracketOverride={(b) => updateDeck(deck.id, { bracketOverride: b })}
                />
              ) : undefined
            }
            tableRecordSlot={<TableRecordPanel deckId={deck.id} />}
            aiReviewSlot={
              formatConfig?.hasCommander && deck.commander ? (
                <>
                  <AiSourcesControl
                    value={aiScope}
                    onChange={(scope) => updateDeck(deck.id, { aiScope: scope })}
                    collectionEmpty={collectionCards.length === 0}
                  />
                  <DeckAiReview
                    deckId={deck.id}
                    scope={aiScope}
                    format={deck.format}
                    commander={deck.commander}
                    partnerCommander={deck.partnerCommander ?? null}
                    mainboard={deck.cards.map((c) => ({ slotId: c.slotId, card: c.card }))}
                    bracketTarget={deck.bracketOverride ?? null}
                    bracketEstimate={deck.bracketEstimation?.bracket ?? null}
                  />
                  <DeckAiRefine
                    key={deck.id}
                    variant="coach"
                    onReading={setAiAgrees}
                    deckId={deck.id}
                    format={deck.format}
                    commander={deck.commander}
                    partnerCommander={deck.partnerCommander ?? null}
                    mainboard={deck.cards.map((c) => ({ slotId: c.slotId, card: c.card }))}
                    pool={refinePool}
                    scope={aiScope}
                    alternatives={refineAlternatives}
                    bracketTarget={deck.bracketOverride ?? null}
                    bracketEstimate={deck.bracketEstimation?.bracket ?? null}
                    onApplyMove={handleApplyCoachMove}
                    onApplyAll={(swaps) => handleApplyCostSwaps(swaps, 'ai')}
                  />
                </>
              ) : undefined
            }
            combosSlot={
              formatConfig?.hasCommander ? (
                <DeckCombosPanel
                  ref={combosRef}
                  deckId={deck.id}
                  deckOracleIds={deckOracleIds}
                  mainboardOracleIds={mainboardOracleIds}
                  format={deck.format}
                  colorIdentity={comboColorIdentity}
                  combos={comboData}
                  onAdd={(card, allocatedCopyId) => addCard(deck.id, card, allocatedCopyId)}
                />
              ) : undefined
            }
            coachFeedSlot={
              formatConfig?.hasCommander && !deck.commander ? (
                // Coach reads a deck against its commander; with none yet its
                // feed would be empty and its "looks tuned" line untrue (E465).
                <EmptyState
                  tagline="Choose a commander to get Coach suggestions."
                  actions={
                    <Button
                      variant="primary"
                      className="empty-state-action"
                      onClick={() => setShowCommanderPicker(true)}
                    >
                      Choose a commander
                    </Button>
                  }
                />
              ) : formatConfig?.hasCommander ? (
                <CoachFeed
                  gaps={deck.gapAnalysis ?? []}
                  optimize={deck.optimizeSwaps}
                  misfits={deck.misfits}
                  synergy={deck.synergyAnalysis?.suggestions ?? []}
                  substitutes={substitutionPlan?.rows ?? []}
                  costPlan={(coachSettings.savesMoney && effectiveCostPlan) || undefined}
                  bracketFit={deck.bracketFit ?? undefined}
                  landUpgrades={landUpgrades}
                  oneAwayCombos={winningCombos(mainboardComboData, coachSettings.deckPayoffs)}
                  crossDeckMoves={crossDeckMoves}
                  planScore={deck.planScore}
                  roleCounts={liveRoleCounts ?? {}}
                  roleTargets={deck.roleTargets ?? {}}
                  deckSize={
                    deck.cards.length + (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0)
                  }
                  deckTarget={DECK_FORMAT_CONFIGS[deck.format].deckSize}
                  bracketOverridePresent={deck.bracketOverride != null}
                  resolveOwnership={ownershipFor}
                  ownedNames={ownedNames}
                  deckNames={deckCardNames}
                  onApplyMove={handleApplyCoachMove}
                  onApplyAllDropIns={handleApplyCostSwaps}
                  onConvergeBracket={(swaps) => handleApplyCostSwaps(swaps, 'bracket')}
                  onPreviewFit={(change) => void handleCoachPreviewFit(change)}
                  initialFilter={tuneFocusLane ?? undefined}
                  onFilterHandled={clearTuneFocus}
                  analysisState={analysisState}
                  onRetryAnalysis={
                    analysisState === 'error' || bracketAnalysis.edhrecMissing
                      ? bracketAnalysis.retry
                      : undefined
                  }
                  edhrecMissing={bracketAnalysis.edhrecMissing}
                  commanderName={deck.commander?.name}
                  busyNames={
                    bracketFitSwapName
                      ? new Set([...addingEngineNames, bracketFitSwapName])
                      : addingEngineNames
                  }
                  browser={
                    <DeckAnalysisPanel
                      deckId={deck.id}
                      format={deck.format}
                      commander={deck.commander}
                      partnerCommander={deck.partnerCommander}
                      mainboard={deck.cards.map((c) => ({ slotId: c.slotId, card: c.card }))}
                      onAdd={(card, allocatedCopyId) => addCard(deck.id, card, allocatedCopyId)}
                    />
                  }
                  ownedOnly={ownedOnly}
                  onOwnedOnlyChange={handleOwnedOnlyChange}
                  settingsBreak={coachSettings.check}
                  hasReplaceCut={replaceCuts.hasCut}
                  hasProtectedCut={replaceCuts.hasProtectedCut}
                  cutSwaps={{ deck, combos: mainboardComboData, owned: collectionCards }}
                  targetBracket={coachSettings.targetBracket}
                  aiAgrees={aiAgrees ?? undefined}
                  upgradePlan={
                    planAvailable
                      ? {
                          deckId: deck.id,
                          tools: upgradePlanTools,
                          open: planOpen,
                          onOpenChange: setPlanOpen,
                          onApply: handleApplyPlan,
                        }
                      : undefined
                  }
                  nextBestMoves={nextBestMoves}
                  combosLoading={!!formatConfig?.hasCommander && comboData.loading}
                  onNbmNavigate={handleNbmNavigate}
                  onNbmApply={handleAddEngineCard}
                  onNbmFill={
                    isCommander && deck.commander && deck.cards.length < mainboardLimit
                      ? () => setShowFill(true)
                      : undefined
                  }
                />
              ) : undefined
            }
            engineSlot={
              formatConfig?.hasCommander &&
              deck.synergyAnalysis &&
              (deck.synergyAnalysis.warnings.length > 0 || deck.synergyAnalysis.axes.length > 0) ? (
                // Power tab keeps only the axis-balance diagnostics; the off-meta
                // picks live in the Tune Improve engine (synergy source).
                <EnginePanel
                  analysis={deck.synergyAnalysis}
                  onAdd={handleAddEngineCard}
                  showSuggestions={false}
                  axisSummaries={axisSummaries}
                  allCards={deckCards}
                />
              ) : undefined
            }
            winConditionSlot={
              formatConfig?.hasCommander && deck.winConditions ? (
                <WinConditionPanel
                  analysis={deck.winConditions}
                  library={deckLibrary}
                  combosUncounted={bracketAnalysis.missesCombos}
                  winConTags={deck.winConTags}
                  onToggleWinConTag={(name) =>
                    updateDeck(deck.id, { winConTags: toggleWinConTag(deck.winConTags, name) })
                  }
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </>
  );
}
