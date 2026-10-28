import { haptics } from '@/lib/util/haptics';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { DeckAiRefine } from '@/components/deck/DeckAiRefine';
import { DeckTokensSheet } from '@/components/deck/DeckTokensSheet';
import { DeckPrimerSheet } from '@/components/deck/DeckPrimerSheet';
import { RecheckLandsSheet } from '@/components/deck/RecheckLandsSheet';
import { applyUpgradePlan } from '@/lib/coach/apply-upgrade-plan';
import { generatedListAfter, landSwapSteps } from '@/lib/deck/recheck-lands';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { AppendDeckDialog } from '@/components/deck/AppendDeckDialog';
import { BulkEditDeckDialog } from '@/components/deck/BulkEditDeckDialog';
import { PullListSheet } from '@/components/deck/PullListSheet';
import { CommanderPickerSheet } from '@/components/deck/CommanderPickerSheet';
import { DeckSizePrompt } from '@/components/deck/DeckSizePrompt';
import { FillDeckSheet } from '@/components/deck/FillDeckSheet';
import { CardFitPanel } from '@/components/deck/CardFitPanel';
import { CardEditDialog } from '@/components/collection/CardEditDialog';
import {
  buildAllocationMap,
  pickCollectionCopy,
  listContestedCards,
  makeDeckAllocationInfo,
} from '@/lib/collection/allocations';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { SharedCopiesSheet } from '@/components/deck/SharedCopiesSheet';
import { DeckFeedbackSheet } from '@/components/deck/DeckFeedbackSheet';
import { MovePrintingPrompt } from '@/components/deck/MovePrintingPrompt';
import { MoveToDeckSheet } from '@/components/deck/MoveToDeckSheet';
import { BuildReportSheet } from '@/components/deck/BuildReportSheet';
import type { ComboSeedContext } from '@/types/combos';
import { Modal } from '@/components/overlays/Modal';
import { PartnerCommanderSelector } from '@/components/deck/PartnerCommanderSelector';
import { useToastsStore } from '@/store/toasts';
import { DeckEditorCardPickerSheet } from './DeckEditorCardPickerSheet';
import { DeckTestHandSheet } from './DeckTestHandSheet';
import { ReplaceCommanderDialog } from './ReplaceCommanderDialog';
import type { DeckToken } from '@/lib/deck/deck-tokens';
import type { EnrichedCard, BinderDef } from '@spellcontrol/binder-routing';
import type { useDeckEditorUi } from './use-deck-editor-ui';
import type { useDeckView } from './use-deck-view';
import type { useDeckOwnership } from './use-deck-ownership';
import type { useDeckAddFlow } from './use-deck-add-flow';
import type { useDeckPrintingEdits } from './use-deck-printing-edits';
import type { useDeckCommanderEdits } from './use-deck-commander-edits';
import type { useDeckReallocation } from './use-deck-reallocation';
import type { useDeckDerived } from './use-deck-derived';
import type { useDeckAnalysisData } from './use-deck-analysis-data';
import type { useDeckCombosView } from './use-deck-combos-view';
import type { useDeckCoachApply } from './use-deck-coach-apply';
import type { useDeckRefineData } from './use-deck-refine-data';
import type { useDeckCardRenderers } from './use-deck-card-renderers';

/** Every prop but the plain data is a hook's returned object, passed whole. */
export function DeckEditorOverlays({
  deck,
  collectionCards,
  binderDefs,
  deckTokens,
  comboSeedContext,
  ui,
  view,
  ownership,
  addFlow,
  printingEdits,
  commanderEdits,
  realloc,
  derived,
  analysis,
  combosView,
  coachApply,
  refine,
  refineAlternatives,
  renderers,
}: {
  deck: Deck;
  collectionCards: EnrichedCard[];
  binderDefs: BinderDef[];
  deckTokens: DeckToken[];
  comboSeedContext: ComboSeedContext | null;
  ui: ReturnType<typeof useDeckEditorUi>;
  view: ReturnType<typeof useDeckView>;
  ownership: ReturnType<typeof useDeckOwnership>;
  addFlow: ReturnType<typeof useDeckAddFlow>;
  printingEdits: ReturnType<typeof useDeckPrintingEdits>;
  commanderEdits: ReturnType<typeof useDeckCommanderEdits>;
  realloc: ReturnType<typeof useDeckReallocation>;
  derived: ReturnType<typeof useDeckDerived>;
  analysis: ReturnType<typeof useDeckAnalysisData>;
  combosView: ReturnType<typeof useDeckCombosView>;
  coachApply: ReturnType<typeof useDeckCoachApply>;
  refine: ReturnType<typeof useDeckRefineData>;
  refineAlternatives: Map<string, string[]>;
  renderers: ReturnType<typeof useDeckCardRenderers>;
}) {
  const {
    showAddPanel,
    setShowAddPanel,
    tokensOpen,
    setTokensOpen,
    primerOpen,
    setPrimerOpen,
    recheckLandsOpen,
    setRecheckLandsOpen,
    appendOpen,
    setAppendOpen,
    bulkEditOpen,
    setBulkEditOpen,
    resyncOpen,
    setResyncOpen,
    pullListOpen,
    setPullListOpen,
    feedbackOpen,
    setFeedbackOpen,
    showSharedCopies,
    setShowSharedCopies,
    showBuildReport,
    setShowBuildReport,
  } = ui;
  const { showTestHand, setShowTestHand } = view;
  const {
    printingAllocationMap,
    collectionById,
    resolveAvailability,
    resolveOwnedFinishes,
    ownedNames,
    ownershipFor,
    freeCountFor,
    ownedOracleIdSet,
  } = ownership;
  const {
    auditionCard,
    auditionReport,
    auditionPinnedCutName,
    setAuditionCard,
    setAuditionPinnedCutName,
    handleAddEngineCard,
    showFill,
    setShowFill,
    pendingAdd,
    replaceOptions,
    pendingMoveFor,
    setPendingAdd,
    addToSideboardAndClose,
    addToConsideringAndClose,
    addAnywayAndClose,
    refillAfterCut,
    refillOptions,
    setRefillAfterCut,
  } = addFlow;
  const {
    editingSlot,
    handleEditConfirm,
    setEditingSlot,
    movePrompt,
    handleMovePrintingConfirm,
    setMovePrompt,
  } = printingEdits;
  const {
    makeCommanderTarget,
    setMakeCommanderTarget,
    handleConfirmMakeCommander,
    makePartnerTarget,
    setMakePartnerTarget,
    handleConfirmMakePartner,
    showCommanderPicker,
    handleSelectCommanderFromPicker,
    setShowCommanderPicker,
    showPartnerPicker,
    setShowPartnerPicker,
    handleSelectPartnerFromPicker,
  } = commanderEdits;
  const {
    moveCard,
    handleMoveConfirm,
    setMoveCard,
    releaseCard,
    handleReleaseConfirm,
    setReleaseCard,
    handleMoveSharedCopy,
  } = realloc;
  const { formatConfig, commanderNames, mainboardLimit } = derived;
  const { buildTimeNudge } = analysis;
  const { mainboardComboData } = combosView;
  const { swappingSlot, handleSwapInDeck, handleApplyCoachMove, handleApplyCostSwaps } = coachApply;
  const { refinePool, aiScope } = refine;
  const { renderAddPanelContent } = renderers;
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const bulkAddCards = useDecksStore((s) => s.bulkAddCards);
  const pushToast = useToastsStore((s) => s.push);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  return (
    <>
      {/* Test hand — a breakpoint-aware overlay (bottom sheet on mobile,
          centered modal ≥1024px) via the shared card-picker sheet. Goldfishing
          is a distinct activity, opened on demand from the Deck-view toolbar so
          it's never pinned inline or in a tab. */}
      {showTestHand && (
        <DeckTestHandSheet deckId={deck.id} onClose={() => setShowTestHand(false)} />
      )}

      {/* Add cards — a breakpoint-aware overlay (bottom sheet on mobile,
          centered modal ≥1024px) via the shared card-picker sheet. Open in
          every format, commander or not (E465): a commander deck can take
          cards before it has a commander, and the search shows every color
          until it does. */}
      {showAddPanel && (
        <DeckEditorCardPickerSheet
          label="Add cards"
          className="deck-add-sheet"
          onClose={() => {
            setShowAddPanel(false);
            buildTimeNudge.dismiss();
          }}
        >
          {(dismiss) => renderAddPanelContent(dismiss)}
        </DeckEditorCardPickerSheet>
      )}

      {auditionCard && auditionReport && deck && (
        <CardFitPanel
          addCard={auditionCard}
          report={auditionReport}
          commanderName={deck.commander?.name}
          busySlotId={swappingSlot}
          pinnedCutName={auditionPinnedCutName ?? undefined}
          onSwapCut={(cut) =>
            void handleSwapInDeck(cut.slotId, cut.card.name, auditionCard.name, () => {
              setAuditionCard(null);
              setAuditionPinnedCutName(null);
            })
          }
          onAddAnyway={() => {
            const name = auditionCard.name;
            setAuditionCard(null);
            setAuditionPinnedCutName(null);
            void handleAddEngineCard(name);
          }}
          onClose={() => {
            setAuditionCard(null);
            setAuditionPinnedCutName(null);
          }}
        />
      )}

      {tokensOpen && <DeckTokensSheet tokens={deckTokens} onClose={() => setTokensOpen(false)} />}
      {primerOpen && <DeckPrimerSheet deck={deck} onClose={() => setPrimerOpen(false)} />}
      {recheckLandsOpen && (
        <RecheckLandsSheet
          deck={deck}
          env={{
            collection: collectionCards,
            decks: useDecksStore.getState().decks,
            cubes: savedCubes,
            bannedCards: useDeckBuilderStore.getState().customization.bannedCards,
          }}
          ownershipFor={ownershipFor}
          onClose={() => setRecheckLandsOpen(false)}
          onApply={async (swaps, declined) => {
            const n = await applyUpgradePlan(deck.id, landSwapSteps(swaps), {
              label: (count) => `re-check lands (${count} ${count === 1 ? 'swap' : 'swaps'})`,
              patch: (d, applied) => ({
                generationContext: generatedListAfter(d, applied, declined),
              }),
            });
            if (n === 0) {
              pushToast({ message: "Couldn't find those lands. Nothing changed.", tone: 'error' });
              return;
            }
            pushToast({
              message:
                n === swaps.length
                  ? `Swapped ${n} ${n === 1 ? 'land' : 'lands'}`
                  : `Swapped ${n} of ${swaps.length} lands. The rest couldn't be found`,
              tone: 'success',
              actionLabel: 'Undo',
              onAction: () => undoEdit(deck.id),
            });
            haptics.tap();
          }}
        />
      )}
      {appendOpen && <AppendDeckDialog deck={deck} onClose={() => setAppendOpen(false)} />}
      {bulkEditOpen && <BulkEditDeckDialog deck={deck} onClose={() => setBulkEditOpen(false)} />}
      {resyncOpen && (
        <BulkEditDeckDialog deck={deck} mode="resync" onClose={() => setResyncOpen(false)} />
      )}
      {pullListOpen && (
        <PullListSheet
          deck={deck}
          collection={collectionCards}
          binderDefs={binderDefs}
          allocations={printingAllocationMap}
          onClose={() => setPullListOpen(false)}
        />
      )}

      {editingSlot && (
        <CardEditDialog
          cardName={editingSlot.card.name}
          currentScryfallId={editingSlot.card.id}
          fallbackCard={editingSlot.card}
          // The slot's real finish is whatever physical copy it's bound to —
          // an unbound slot has no finish, so it reads as non-foil.
          currentFinish={(() => {
            const copyId = deck.cards.find((c) => c.slotId === editingSlot.slotId)?.allocatedCopyId;
            return (copyId && collectionById?.get(copyId)?.finish) || 'nonfoil';
          })()}
          resolveAvailability={resolveAvailability}
          resolveOwnedFinishes={resolveOwnedFinishes}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingSlot(null)}
        />
      )}

      {movePrompt && (
        <MovePrintingPrompt
          cardName={movePrompt.newCard.name}
          chosenSetName={movePrompt.chosenSetName}
          donorName={movePrompt.donor.donorDeckName}
          donorKind={movePrompt.donor.donorKind}
          swap={movePrompt.swap ? { returnSetName: movePrompt.swap.returnSetName } : null}
          onMove={() => handleMovePrintingConfirm('move')}
          onSwap={() => handleMovePrintingConfirm('swap')}
          onCancel={() => setMovePrompt(null)}
        />
      )}

      {makeCommanderTarget && deck.commander && (
        <ReplaceCommanderDialog
          which="commander"
          incoming={makeCommanderTarget.card.name}
          current={deck.commander.name}
          onCancel={() => setMakeCommanderTarget(null)}
          onConfirm={handleConfirmMakeCommander}
        />
      )}

      {makePartnerTarget && deck.partnerCommander && (
        <ReplaceCommanderDialog
          which="partner"
          incoming={makePartnerTarget.card.name}
          current={deck.partnerCommander.name}
          onCancel={() => setMakePartnerTarget(null)}
          onConfirm={handleConfirmMakePartner}
        />
      )}

      {showCommanderPicker && formatConfig?.hasCommander && (
        <CommanderPickerSheet
          format={deck.format}
          deckCards={[...deck.cards, ...deck.sideboard].map((c) => c.card)}
          exclude={commanderNames}
          onPick={handleSelectCommanderFromPicker}
          onClose={() => setShowCommanderPicker(false)}
        />
      )}

      {showPartnerPicker && deck.commander && (
        <Modal onClose={() => setShowPartnerPicker(false)} labelledBy="partner-picker-title">
          <h2 id="partner-picker-title" className="choice-dialog-title">
            Partner commander
          </h2>
          {/* collectionMode={false}: the editor isn't constrained to owned
              cards, so the picker lists every legal partner and the build does
              the allocation when one is chosen. */}
          <PartnerCommanderSelector
            commander={deck.commander}
            partner={deck.partnerCommander}
            onSelect={handleSelectPartnerFromPicker}
            collectionMode={false}
          />
        </Modal>
      )}

      {showFill && deck && (
        <FillDeckSheet
          deck={deck}
          target={mainboardLimit}
          ownedNames={ownedNames}
          onClose={() => setShowFill(false)}
          onAdd={(cards) => {
            setShowFill(false);
            // One write and one undo entry for the whole fill, binding free
            // owned copies the same way a quantity increment does.
            recordEdit(deck.id, `fill ${cards.length} cards`, () => {
              const allocations = buildAllocationMap(
                useDecksStore.getState().decks,
                useCubeStore.getState().saved
              );
              const entries = cards.map((card) => {
                const claim = pickCollectionCopy(card.name, collectionCards, allocations, card.id);
                const allocatedCopyId = claim?.copyId ?? null;
                if (allocatedCopyId) {
                  allocations.set(
                    allocatedCopyId,
                    makeDeckAllocationInfo(deck.id, deck.name, deck.color, card.name)
                  );
                }
                return { card, allocatedCopyId };
              });
              bulkAddCards(deck.id, 'cards', entries);
            });
            pushToast({
              message: `Added ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`,
              tone: 'success',
              actionLabel: 'Undo',
              onAction: () => undoEdit(deck.id),
            });
            haptics.tap();
          }}
        />
      )}

      {/* Deck-size guard: replace-when-full (adding to a full Commander deck). */}
      {pendingAdd && replaceOptions && deck && (
        <DeckSizePrompt
          title={`Deck is full (${deck.cards.length}/${mainboardLimit})`}
          subtitle={
            replaceOptions.anyRelated
              ? `Replace a card with ${pendingAdd}?`
              : `Cut a weak card to make room for ${pendingAdd}?`
          }
          actionVerb="Replace"
          subject={{ name: pendingAdd, label: "The card you're adding" }}
          aiSlot={
            // A move's apply carries the sibling deck's patch; the AI verdict
            // applies a plain swap, so it stays out of a move's prompt.
            formatConfig?.hasCommander && deck.commander && !pendingMoveFor ? (
              <DeckAiRefine
                key={deck.id}
                variant="replace"
                deckId={deck.id}
                format={deck.format}
                commander={deck.commander}
                partnerCommander={deck.partnerCommander ?? null}
                mainboard={deck.cards.map((c) => ({ slotId: c.slotId, card: c.card }))}
                pool={[{ name: pendingAdd, oracleId: '', qty: 1 }]}
                scope="any"
                bracketTarget={deck.bracketOverride ?? null}
                bracketEstimate={deck.bracketEstimation?.bracket ?? null}
                onApplyMove={(change) => {
                  // A verdict swap resolves the whole prompt: apply through the
                  // coach path (atomic swap + undo) and close.
                  void handleApplyCoachMove(change);
                  setPendingAdd(null);
                }}
              />
            ) : undefined
          }
          options={replaceOptions.suggested}
          moreOptions={replaceOptions.all}
          footer={[
            { label: 'Add to sideboard', onClick: () => void addToSideboardAndClose() },
            { label: 'Add to considering', onClick: () => void addToConsideringAndClose() },
            { label: 'Add anyway', onClick: () => void addAnywayAndClose() },
            { label: 'Cancel', onClick: () => setPendingAdd(null), primary: true },
          ]}
          onClose={() => setPendingAdd(null)}
        />
      )}

      {/* Deck-size guard: refill nudge (a cut dropped a full deck below 100). */}
      {refillAfterCut && deck && (
        <DeckSizePrompt
          title={`Cut ${refillAfterCut.name}`}
          subtitle="Add a replacement to keep your deck at its limit?"
          actionVerb="Add"
          subject={{ name: refillAfterCut.name, label: 'The card you cut' }}
          options={refillOptions}
          footer={[{ label: 'Leave it', onClick: () => setRefillAfterCut(null), primary: true }]}
          onClose={() => setRefillAfterCut(null)}
        />
      )}

      {/* Physical-copy reallocation — move owned cards between decks. */}
      {moveCard && deck && (
        <MoveToDeckSheet
          card={moveCard}
          currentDeck={deck}
          collectionCards={collectionCards}
          ownershipFor={ownershipFor}
          freeCountFor={freeCountFor}
          onConfirm={(targetId, outcome, replacement) =>
            handleMoveConfirm(moveCard, targetId, outcome, replacement)
          }
          onCancel={() => setMoveCard(null)}
        />
      )}

      {releaseCard && deck && (
        <ConfirmDialog
          title={`Release your copy of ${releaseCard.name}?`}
          body={`The copy frees up for another deck or trade. ${releaseCard.name} stays in this deck as a card you still need.`}
          confirmLabel="Release copy"
          onConfirm={handleReleaseConfirm}
          onCancel={() => setReleaseCard(null)}
        />
      )}

      {feedbackOpen && deck && (
        <DeckFeedbackSheet deck={deck} onClose={() => setFeedbackOpen(false)} />
      )}

      {showSharedCopies && deck && (
        <SharedCopiesSheet
          deckName={deck.name}
          contested={listContestedCards(deck, collectionCards, decks, savedCubes)}
          onMove={handleMoveSharedCopy}
          onClose={() => setShowSharedCopies(false)}
        />
      )}

      {/* One-shot post-generation build report sheet (UX-316).
          Shown once per deck immediately after generation; never again. */}
      {showBuildReport && deck?.buildReport && (
        <BuildReportSheet
          deckId={deck.id}
          commanderName={deck.commander?.name}
          commanderImageUrl={
            deck.commander?.image_uris?.art_crop ??
            deck.commander?.card_faces?.[0]?.image_uris?.art_crop
          }
          report={deck.buildReport}
          oneAwayCombos={mainboardComboData?.oneAway}
          ownedOracleIds={ownedOracleIdSet}
          comboSeedContext={comboSeedContext}
          onClose={() => setShowBuildReport(false)}
          onReviewConflicts={() => {
            setShowBuildReport(false);
            setShowSharedCopies(true);
          }}
          /* The post-generation moment (T102 slice 4). Same panel as the Coach
             tab, so the offer meets the user while they're judging the fresh
             deck instead of waiting to be found. It self-hides when the feature
             is off and never auto-runs — the press is still the user's. */
          refineSlot={
            deck.commander ? (
              <DeckAiRefine
                key={deck.id}
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
            ) : undefined
          }
        />
      )}
    </>
  );
}
