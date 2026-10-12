import { haptics } from '@/lib/util/haptics';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { DeckAiRefine } from '@/components/deck/DeckAiRefine';
import { DeckTokensSheet } from '@/components/deck/DeckTokensSheet';
import { DeckPrimerSheet } from '@/components/deck/DeckPrimerSheet';
import { AppendDeckDialog } from '@/components/deck/AppendDeckDialog';
import { BulkEditDeckDialog } from '@/components/deck/BulkEditDeckDialog';
import { PullListSheet } from '@/components/deck/PullListSheet';
import { CommanderPickerSheet } from '@/components/deck/CommanderPickerSheet';
import { DeckSizePrompt } from '@/components/deck/DeckSizePrompt';
import { FillDeckSheet } from '@/components/deck/FillDeckSheet';
import { type Change } from '@/lib/coach/deck-change';
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
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckEditorCardPickerSheet } from './DeckEditorCardPickerSheet';
import { DeckTestHandSheet } from './DeckTestHandSheet';
import { ReplaceCommanderDialog } from './ReplaceCommanderDialog';
import type { Dispatch, SetStateAction, JSX } from 'react';
import type { BuildTimeNudge } from '@/lib/coach/use-build-time-nudge';
import type { AddFitReport } from '@/lib/coach/card-fit';
import type { DeckToken } from '@/lib/deck/deck-tokens';
import type { EnrichedCard, BinderDef, Finish } from '@spellcontrol/binder-routing';
import type { AllocationInfo, StealableCopy, DonorOutcome } from '@/lib/collection/allocations';
import type { ChangeOwnership } from '@/lib/coach/deck-change';
import type { PrintingSelection } from '@/lib/collection/edit-card';
import type { DeckFormatConfig } from '@/deck-builder/types';
import type { SizePromptOption } from '@/components/deck/DeckSizePrompt';
import type { CrossDeckMove } from '@/lib/coach/cross-deck-moves';
import type { ComboMatchResponse } from '@/types/combos';
import type { RefineCard } from '@/lib/ai/ai-refine';
import type { AiScope } from '@/lib/ai/ai-scope';

export function DeckEditorOverlays({
  showTestHand,
  deck,
  setShowTestHand,
  showAddPanel,
  setShowAddPanel,
  buildTimeNudge,
  renderAddPanelContent,
  auditionCard,
  auditionReport,
  swappingSlot,
  auditionPinnedCutName,
  handleSwapInDeck,
  setAuditionCard,
  setAuditionPinnedCutName,
  handleAddEngineCard,
  tokensOpen,
  deckTokens,
  setTokensOpen,
  primerOpen,
  setPrimerOpen,
  appendOpen,
  setAppendOpen,
  bulkEditOpen,
  setBulkEditOpen,
  resyncOpen,
  setResyncOpen,
  pullListOpen,
  collectionCards,
  binderDefs,
  printingAllocationMap,
  setPullListOpen,
  editingSlot,
  collectionById,
  resolveAvailability,
  resolveOwnedFinishes,
  handleEditConfirm,
  setEditingSlot,
  movePrompt,
  handleMovePrintingConfirm,
  setMovePrompt,
  makeCommanderTarget,
  setMakeCommanderTarget,
  handleConfirmMakeCommander,
  makePartnerTarget,
  setMakePartnerTarget,
  handleConfirmMakePartner,
  showCommanderPicker,
  formatConfig,
  commanderNames,
  handleSelectCommanderFromPicker,
  setShowCommanderPicker,
  showPartnerPicker,
  setShowPartnerPicker,
  handleSelectPartnerFromPicker,
  showFill,
  mainboardLimit,
  ownedNames,
  setShowFill,
  pendingAdd,
  replaceOptions,
  pendingMoveFor,
  handleApplyCoachMove,
  setPendingAdd,
  addToSideboardAndClose,
  addToConsideringAndClose,
  addAnywayAndClose,
  refillAfterCut,
  refillOptions,
  setRefillAfterCut,
  moveCard,
  ownershipFor,
  freeCountFor,
  handleMoveConfirm,
  setMoveCard,
  releaseCard,
  handleReleaseConfirm,
  setReleaseCard,
  feedbackOpen,
  setFeedbackOpen,
  showSharedCopies,
  handleMoveSharedCopy,
  setShowSharedCopies,
  showBuildReport,
  mainboardComboData,
  ownedOracleIdSet,
  comboSeedContext,
  setShowBuildReport,
  refinePool,
  aiScope,
  refineAlternatives,
  handleApplyCostSwaps,
}: {
  showTestHand: boolean;
  deck: Deck;
  setShowTestHand: Dispatch<SetStateAction<boolean>>;
  showAddPanel: boolean;
  setShowAddPanel: Dispatch<SetStateAction<boolean>>;
  buildTimeNudge: {
    nudge: BuildTimeNudge | null;
    notifyMainboardAdd: (cardName: string) => void;
    dismiss: () => void;
  };
  renderAddPanelContent: (close: () => void) => JSX.Element;
  auditionCard: ScryfallCard | null;
  auditionReport: AddFitReport | null;
  swappingSlot: string | null;
  auditionPinnedCutName: string | null;
  handleSwapInDeck: (
    slotId: string,
    oldName: string,
    newName: string,
    close: () => void
  ) => Promise<void>;
  setAuditionCard: Dispatch<SetStateAction<ScryfallCard | null>>;
  setAuditionPinnedCutName: Dispatch<SetStateAction<string | null>>;
  handleAddEngineCard: (cardName: string) => Promise<void>;
  tokensOpen: boolean;
  deckTokens: DeckToken[];
  setTokensOpen: Dispatch<SetStateAction<boolean>>;
  primerOpen: boolean;
  setPrimerOpen: Dispatch<SetStateAction<boolean>>;
  appendOpen: boolean;
  setAppendOpen: Dispatch<SetStateAction<boolean>>;
  bulkEditOpen: boolean;
  setBulkEditOpen: Dispatch<SetStateAction<boolean>>;
  resyncOpen: boolean;
  setResyncOpen: Dispatch<SetStateAction<boolean>>;
  pullListOpen: boolean;
  collectionCards: EnrichedCard[];
  binderDefs: BinderDef[];
  printingAllocationMap: Map<string, AllocationInfo>;
  setPullListOpen: Dispatch<SetStateAction<boolean>>;
  editingSlot: { slotId: string; card: ScryfallCard } | null;
  collectionById: Map<string, EnrichedCard> | undefined;
  resolveAvailability: (printing: ScryfallCard) => ChangeOwnership;
  resolveOwnedFinishes: (printing: ScryfallCard) => Finish[];
  handleEditConfirm: (selection: PrintingSelection) => void;
  setEditingSlot: Dispatch<SetStateAction<{ slotId: string; card: ScryfallCard } | null>>;
  movePrompt: {
    editSlotId: string;
    newCard: ScryfallCard;
    chosenSetName: string;
    donor: StealableCopy;
    swap: { returnCopyId: string; returnCard: ScryfallCard; returnSetName: string } | null;
  } | null;
  handleMovePrintingConfirm: (mode: 'move' | 'swap') => void;
  setMovePrompt: Dispatch<
    SetStateAction<{
      editSlotId: string;
      newCard: ScryfallCard;
      chosenSetName: string;
      donor: StealableCopy;
      swap: { returnCopyId: string; returnCard: ScryfallCard; returnSetName: string } | null;
    } | null>
  >;
  makeCommanderTarget: {
    slotId: string | null;
    card: ScryfallCard;
    allocatedCopyId: string | null;
  } | null;
  setMakeCommanderTarget: Dispatch<
    SetStateAction<{
      slotId: string | null;
      card: ScryfallCard;
      allocatedCopyId: string | null;
    } | null>
  >;
  handleConfirmMakeCommander: (keepOldInDeck: boolean) => void;
  makePartnerTarget: {
    slotId: string;
    card: ScryfallCard;
    zone: 'main' | 'side';
    allocatedCopyId: string | null;
  } | null;
  setMakePartnerTarget: Dispatch<
    SetStateAction<{
      slotId: string;
      card: ScryfallCard;
      zone: 'main' | 'side';
      allocatedCopyId: string | null;
    } | null>
  >;
  handleConfirmMakePartner: (keepOldInDeck: boolean) => void;
  showCommanderPicker: boolean;
  formatConfig: DeckFormatConfig | null;
  commanderNames: string[];
  handleSelectCommanderFromPicker: (card: ScryfallCard) => void;
  setShowCommanderPicker: Dispatch<SetStateAction<boolean>>;
  showPartnerPicker: boolean;
  setShowPartnerPicker: Dispatch<SetStateAction<boolean>>;
  handleSelectPartnerFromPicker: (card: ScryfallCard | null) => void;
  showFill: boolean;
  mainboardLimit: number;
  ownedNames: Set<string>;
  setShowFill: Dispatch<SetStateAction<boolean>>;
  pendingAdd: string | null;
  replaceOptions: {
    suggested: SizePromptOption[];
    all: SizePromptOption[];
    anyRelated: boolean;
  } | null;
  pendingMoveFor: CrossDeckMove | null;
  handleApplyCoachMove: (change: Change) => Promise<void>;
  setPendingAdd: Dispatch<SetStateAction<string | null>>;
  addToSideboardAndClose: () => Promise<void>;
  addToConsideringAndClose: () => Promise<void>;
  addAnywayAndClose: () => Promise<void>;
  refillAfterCut: { name: string; role: string | null } | null;
  refillOptions: SizePromptOption[];
  setRefillAfterCut: Dispatch<SetStateAction<{ name: string; role: string | null } | null>>;
  moveCard: ScryfallCard | null;
  ownershipFor: (name: string) => ChangeOwnership;
  freeCountFor: (name: string) => number;
  handleMoveConfirm: (
    card: ScryfallCard,
    targetDeckId: string,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ) => void;
  setMoveCard: Dispatch<SetStateAction<ScryfallCard | null>>;
  releaseCard: ScryfallCard | null;
  handleReleaseConfirm: () => void;
  setReleaseCard: Dispatch<SetStateAction<ScryfallCard | null>>;
  feedbackOpen: boolean;
  setFeedbackOpen: Dispatch<SetStateAction<boolean>>;
  showSharedCopies: boolean;
  handleMoveSharedCopy: (slotId: string) => void;
  setShowSharedCopies: Dispatch<SetStateAction<boolean>>;
  showBuildReport: boolean;
  mainboardComboData: ComboMatchResponse | null;
  ownedOracleIdSet: Set<string>;
  comboSeedContext: ComboSeedContext | null;
  setShowBuildReport: Dispatch<SetStateAction<boolean>>;
  refinePool: RefineCard[];
  aiScope: AiScope;
  refineAlternatives: Map<string, string[]>;
  handleApplyCostSwaps: (
    swaps: Array<{ removeName: string; addName: string }>,
    kind?: 'budget' | 'bracket' | 'ai'
  ) => Promise<void>;
}) {
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
