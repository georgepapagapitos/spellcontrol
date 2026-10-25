import { useDecksStore, effectiveBracket, type Deck } from '@/store/decks';
import { DeckDisplay } from '@/components/deck/DeckDisplay';
import { type DeckView } from '@/lib/deck-analysis/deck-view';
import {
  bracketReasons,
  bracketBorderline,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { DeckCombosPanel } from '@/components/deck/DeckCombosPanel';
import { DeckAnalysisPanel } from '@/components/deck/DeckAnalysisPanel';
import { useCommanderProfile, useWarmCommanderPage } from '@/lib/deck/use-commander-profile';
import { DeckAiReview } from '@/components/deck/DeckAiReview';
import { DeckAiRefine } from '@/components/deck/DeckAiRefine';
import { AiSourcesControl } from '@/components/deck/AiSourcesControl';
import { PowerHero } from '@/components/deck/PowerHero';
import { DeckSinceStrip } from '@/components/deck/DeckSinceStrip';
import { useDeckSince } from '@/components/deck/use-deck-since';
import { TableRecordPanel } from '@/components/deck/TableRecordPanel';
import { BracketTableRead } from '@/components/deck/BracketTableRead';
import { BracketVote } from '@/components/deck/BracketVote';
import { deckListText } from '@/lib/deck-analysis/bracket-vote';
import { CoachFeed } from '@/components/deck/CoachFeed';
import { EnginePanel } from '@/components/deck/EnginePanel';
import { WinConditionPanel } from '@/components/deck/WinConditionPanel';
import { toggleWinConTag } from '@/deck-builder/services/winConditions/winConTags';
import { type Change } from '@/lib/coach/deck-change';
import { winningCombos } from '@/lib/coach/coach-changes';
import { buildWinConditionSummary } from '@/lib/deck-analysis/win-condition-summary';
import { isValidCommander, isPdhCommanderEligible } from '@/lib/deck/commanders';
import { canHavePartner } from '@/deck-builder/lib/partnerUtils';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { deckEditActions } from './deck-page-chrome';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { DeckViewTab } from './deck-page-chrome';
import type { useDeckEditorUi } from './use-deck-editor-ui';
import type { useDeckZoneEdits } from './use-deck-zone-edits';
import type { useDeckPrintingEdits } from './use-deck-printing-edits';
import type { useDeckCommanderEdits } from './use-deck-commander-edits';
import type { useDeckReallocation } from './use-deck-reallocation';
import type { useDeckOwnership } from './use-deck-ownership';
import type { useDeckAddFlow } from './use-deck-add-flow';
import type { useDeckDerived } from './use-deck-derived';
import type { useDeckView } from './use-deck-view';
import type { useDeckCombosView } from './use-deck-combos-view';
import type { useDeckAnalysisData } from './use-deck-analysis-data';
import type { useDeckRefineData } from './use-deck-refine-data';
import type { useDeckCoachApply } from './use-deck-coach-apply';
import type { useCoachArrivals } from './use-coach-arrivals';
import type { useDeckCardRenderers } from './use-deck-card-renderers';
import type { useDeckHeroData } from './use-deck-hero-data';

export type DeckEditorChrome = {
  safeView: DeckView;
  viewTabs: DeckViewTab[];
  isDesktop: boolean;
  cover: ReturnType<typeof useDeckHeroData>['cover'];
};

/**
 * Every prop but `deck`, `collectionCards` and the page's own derived values is a
 * hook's returned object, passed whole (types come from the hooks, so a new member
 * needs no edit here).
 */
export function DeckEditorLayout({
  deck,
  collectionCards,
  chrome,
  ui,
  zoneEdits,
  printingEdits,
  commanderEdits,
  realloc,
  ownership,
  addFlow,
  derived,
  view,
  combosView,
  analysis,
  refine,
  refineAlternatives,
  coachApply,
  arrivals,
  renderers,
  onCoachPreviewFit: handleCoachPreviewFit,
}: {
  deck: Deck;
  collectionCards: EnrichedCard[];
  chrome: DeckEditorChrome;
  ui: ReturnType<typeof useDeckEditorUi>;
  zoneEdits: ReturnType<typeof useDeckZoneEdits>;
  printingEdits: ReturnType<typeof useDeckPrintingEdits>;
  commanderEdits: ReturnType<typeof useDeckCommanderEdits>;
  realloc: ReturnType<typeof useDeckReallocation>;
  ownership: ReturnType<typeof useDeckOwnership>;
  addFlow: ReturnType<typeof useDeckAddFlow>;
  derived: ReturnType<typeof useDeckDerived>;
  view: ReturnType<typeof useDeckView>;
  combosView: ReturnType<typeof useDeckCombosView>;
  analysis: ReturnType<typeof useDeckAnalysisData>;
  refine: ReturnType<typeof useDeckRefineData>;
  refineAlternatives: Map<string, string[]>;
  coachApply: ReturnType<typeof useDeckCoachApply>;
  arrivals: ReturnType<typeof useCoachArrivals>;
  renderers: ReturnType<typeof useDeckCardRenderers>;
  onCoachPreviewFit: (change: Change) => Promise<void>;
}) {
  const { safeView, viewTabs, isDesktop, cover } = chrome;
  const {
    setShowAddPanel,
    searchPanelRef,
    handleToggleAddPanel,
    ownedOnly,
    handleOwnedOnlyChange,
  } = ui;
  const {
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
  } = zoneEdits;
  const {
    handleMakeCommanderClick,
    handleMakePartnerClick,
    canMakePartner,
    setShowCommanderPicker,
    setShowPartnerPicker,
  } = commanderEdits;
  const { handleMatchMyCopies, handleCheapestPrintings } = printingEdits;
  const { setMoveCard, setReleaseCard, handleSetProxy, handleUseOwnCopy } = realloc;
  const {
    collectionById,
    binderByCopyId,
    ownedOracleIdSet,
    ownershipFor,
    holdsFor,
    effectiveCostPlan,
    ownedNames,
  } = ownership;
  const { handleAddEngineCard, setShowFill, addingEngineNames } = addFlow;
  // E260: the Coach feed's free "Lean into" lever reads the commander's abilities.
  useWarmCommanderPage(deck.commander, deck.partnerCommander);
  const commanderProfile = useCommanderProfile(deck.commander, deck.partnerCommander);
  const deckSince = useDeckSince(deck);
  const {
    formatConfig,
    isCommander,
    mainboardLimit,
    existingCardCounts,
    deckLibrary,
    speedPath,
    hasCopyMismatches,
    hasMissingSlots,
    deckOracleIds,
    mainboardOracleIds,
    comboColorIdentity,
    deckCardNames,
    axisSummaries,
    deckCards,
  } = derived;
  const {
    exportOpen,
    setExportOpen,
    setShowTestHand,
    statSlot,
    handleNavigateToTune,
    combosRef,
    tuneFocusLane,
    clearTuneFocus,
    handleNbmNavigate,
    planOpen,
    setPlanOpen,
    arrivalsDeepLink,
  } = view;
  const {
    mainboardComboData,
    comboData,
    combosByOracle,
    comboOwnedMissingCount,
    handleViewBracket,
    handleViewEngine,
    handleViewCombos,
    handleViewWinConditions,
  } = combosView;
  const {
    bracketAnalysis,
    suggestGroups,
    analysisState,
    scoreRevealKey,
    coachSettings,
    planAvailable,
    upgradePlanTools,
    nextBestMoves,
    crossDeckMoves,
    liveRoleCounts,
    replaceCuts,
  } = analysis;
  const { landUpgrades, aiScope, setAiAgrees, refinePool, substitutionPlan, aiAgrees } = refine;
  const { handleApplyCoachMove, handleApplyCostSwaps, bracketFitSwapName, handleApplyPlan } =
    coachApply;
  const { coachArrivals, arrivalsSettled } = arrivals;
  const { renderSwapSuggestions, renderSimilarCards } = renderers;
  const { setAppendOpen, setBulkEditOpen, setResyncOpen } = ui;
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
            commanderReleased={deck.commanderReleased}
            partnerCommanderReleased={deck.partnerCommanderReleased}
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
            speedPath={speedPath}
            bracketTableSlot={
              <>
                <BracketTableRead deckId={deck.id} />
                {deck.bracketEstimation && !bracketAnalysis.missesCombos && (
                  <BracketVote
                    deckId={deck.id}
                    listText={deckListText(
                      [deck.commander?.name, deck.partnerCommander?.name],
                      deck.cards.map((c) => c.card.name)
                    )}
                    estimation={deck.bracketEstimation}
                    stated={deck.bracketOverride ?? null}
                  />
                )}
              </>
            }
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
            sinceSlot={
              deckSince ? (
                <DeckSinceStrip
                  since={deckSince.since}
                  baselineAt={deckSince.baselineAt}
                  onDismiss={deckSince.dismiss}
                />
              ) : undefined
            }
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
                  holdsFor={holdsFor}
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
                  intent={coachSettings.intent}
                  aiAgrees={aiAgrees ?? undefined}
                  commanderProfile={commanderProfile}
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
