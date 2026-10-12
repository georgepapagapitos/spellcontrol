import { useState } from 'react';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { formatMoney } from '@/lib/collection/format-money';
import { useCurrency } from '@/lib/collection/currency';
import { type PrintingSelection } from '@/lib/collection/edit-card';
import {
  buildAllocationMap,
  pickCollectionCopy,
  findStealableCopy,
  makeDeckAllocationInfo,
  type DonorOutcome,
  type DonorZone,
  type StealableCopy,
} from '@/lib/collection/allocations';
import { useToastsStore } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  applyCheapestPrintings,
  applyMatchMyCopies,
  PrintingLookupOfflineError,
} from '@/lib/deck/deck-printing-actions';
import { logger } from '@/lib/util/logger';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

export function useDeckPrintingEdits({
  deck,
  collectionCards,
  executeReallocation,
  applyDonorOutcome,
}: {
  deck: Deck;
  collectionCards: EnrichedCard[];
  executeReallocation: (opts: {
    donorDeckId: string;
    donorCubeId?: string;
    recipientDeckId: string;
    recipientApply: () => void;
    donorApply: () => void;
    label: string;
  }) => void;
  applyDonorOutcome: (
    donorDeckId: string,
    zone: DonorZone,
    slotId: string | null,
    donorCard: ScryfallCard,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ) => void;
}) {
  const currency = useCurrency();
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const updateCardPrinting = useDecksStore((s) => s.updateCardPrinting);
  const pushToast = useToastsStore((s) => s.push);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);

  const [editingSlot, setEditingSlot] = useState<{ slotId: string; card: ScryfallCard } | null>(
    null
  );
  // Pending "pull an owned-but-committed printing in from another deck/cube"
  // prompt, raised from the edit-printing picker when the chosen printing has no
  // free copy. Resolved by handleMovePrintingConfirm.
  const [movePrompt, setMovePrompt] = useState<{
    editSlotId: string;
    newCard: ScryfallCard;
    chosenSetName: string;
    donor: StealableCopy;
    swap: { returnCopyId: string; returnCard: ScryfallCard; returnSetName: string } | null;
  } | null>(null);

  // ⋮ Deck actions: printing swaps that never touch a copy binding, each one
  // write and one undo entry (lib/deck/deck-printing-actions).
  const printingLookupFailed = (err: unknown, fallback: string) => {
    if (!(err instanceof PrintingLookupOfflineError)) logger.warn('[Printings] lookup failed', err);
    pushToast({
      message:
        err instanceof PrintingLookupOfflineError
          ? "You're offline. Reconnect to look up printings."
          : fallback,
      tone: 'error',
    });
  };

  const handleCheapestPrintings = async () => {
    const deckId = deck.id;
    try {
      const { changed, saved, unresolved } = await applyCheapestPrintings(deckId, currency);
      if (changed > 0) {
        pushToast({
          message: `Switched ${changed} ${changed === 1 ? 'printing' : 'printings'}. Missing cards cost ${formatMoney(saved, { currency })} less`,
          tone: 'success',
          actionLabel: 'Undo',
          onAction: () => undoEdit(deckId),
        });
      } else if (unresolved > 0) {
        pushToast({ message: "Couldn't look up cheaper printings.", tone: 'error' });
      } else {
        pushToast({ message: 'No cheaper printings for your missing cards', tone: 'info' });
      }
    } catch (err) {
      printingLookupFailed(err, "Couldn't look up cheaper printings.");
    }
  };

  const handleMatchMyCopies = async () => {
    const deckId = deck.id;
    try {
      const { changed } = await applyMatchMyCopies(deckId);
      if (changed === 0) {
        pushToast({ message: "Couldn't look up your copies' printings.", tone: 'error' });
        return;
      }
      pushToast({
        message: `Matched ${changed} ${changed === 1 ? 'card' : 'cards'} to your copies`,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: () => undoEdit(deckId),
      });
    } catch (err) {
      printingLookupFailed(err, "Couldn't look up your copies' printings.");
    }
  };

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingSlot || !deck) return;
    const newCard = selection.card;
    const slotsForName = deck.cards.filter((c) => c.card.name === editingSlot.card.name);

    // If the chosen printing — or the chosen FINISH of it (a foil pick while
    // only the foil is committed) — is owned but every such copy is committed
    // elsewhere, don't silently bind a lesser copy or leave the slot unbound:
    // offer to pull the exact copy in from its donor (Move), or trade this
    // slot's current copy back to the donor (Swap). Nothing moves without the
    // explicit choice; the reallocation itself happens in
    // handleMovePrintingConfirm. findStealableCopy scopes its "a free copy
    // exists" bail-out to these preferences, so it returns null whenever the
    // normal binding below can satisfy the pick.
    const donor = findStealableCopy(
      newCard.name,
      collectionCards,
      decks,
      deck.id,
      newCard.id,
      savedCubes,
      selection.finish
    );
    const donorCopy = donor ? collectionCards.find((c) => c.copyId === donor.copyId) : undefined;
    // Only prompt when the pull delivers the printing the user picked — the
    // finder's fallback can surface a different-printing copy, but a deck
    // lists an unowned printing freely (no prompt, slot just goes unbound).
    if (donor && donorCopy?.scryfallId === newCard.id) {
      const editSlot = deck.cards.find((c) => c.slotId === editingSlot.slotId);
      // Swap needs a reciprocal owned copy this slot can hand back — and a
      // mainboard deck donor whose slot we can rewrite. A copy bound to a
      // printing other than the slot's own (a suboptimal binding) has no clean
      // ScryfallCard to send, so require the slot to hold its own printing.
      const displaced = editSlot?.allocatedCopyId
        ? collectionCards.find((c) => c.copyId === editSlot.allocatedCopyId)
        : undefined;
      const canSwap =
        donor.donorKind === 'deck' &&
        donor.donorZone === 'main' &&
        !!displaced &&
        displaced.scryfallId === editSlot!.card.id;
      // Name the finish in the prompt when the pulled copy is a premium one,
      // so "your foil <set> copy is in <deck>" reads as the reason for the ask.
      const finishPrefix =
        donorCopy.finish === 'foil' ? 'foil ' : donorCopy.finish === 'etched' ? 'etched ' : '';
      setMovePrompt({
        editSlotId: editingSlot.slotId,
        newCard,
        chosenSetName: `${finishPrefix}${newCard.set_name ?? newCard.set?.toUpperCase() ?? 'this'}`,
        donor,
        swap: canSwap
          ? {
              returnCopyId: displaced!.copyId,
              returnCard: editSlot!.card,
              returnSetName: editSlot!.card.set_name ?? displaced!.setCode,
            }
          : null,
      });
      setEditingSlot(null);
      return;
    }

    // Bind each rebound slot to a free owned copy of the NEW printing so picking
    // a printing you own actually sources it from your collection — previously
    // the swap always nulled the allocation, so an owned printing read as
    // unowned. Release these slots' own copies first, and pick greedily, so N
    // same-name slots don't double-claim one physical copy.
    const allocations = buildAllocationMap(decks, savedCubes);
    for (const slot of slotsForName) {
      if (slot.allocatedCopyId) allocations.delete(slot.allocatedCopyId);
    }
    const bindings = new Map<string, string | null>();
    for (const slot of slotsForName) {
      // The chosen finish rides along as a preference: owning both finishes of
      // the picked printing binds the one the user asked for (foil stays foil)
      // instead of the ranking's non-foil default.
      const copy = pickCollectionCopy(
        newCard.name,
        collectionCards,
        allocations,
        newCard.id,
        selection.finish
      );
      // pickCollectionCopy falls back to any free copy of the name; the slot now
      // shows newCard, so only keep a copy that is actually the chosen printing.
      if (copy && copy.scryfallId === newCard.id) {
        bindings.set(slot.slotId, copy.copyId);
        allocations.set(
          copy.copyId,
          makeDeckAllocationInfo(deck.id, deck.name, deck.color, newCard.name)
        );
      } else {
        bindings.set(slot.slotId, null);
      }
    }
    recordEdit(deck.id, `change printing of ${newCard.name}`, () => {
      for (const slot of slotsForName) {
        updateCardPrinting(deck.id, slot.slotId, newCard, bindings.get(slot.slotId) ?? null);
      }
    });
    setEditingSlot(null);
    pushToast({ message: `Updated printing for ${newCard.name}`, tone: 'success' });
  };

  // Commit the pending move/swap from the edit-printing picker. Both directions
  // reuse the shared reallocation engine (snapshot both decks + one Undo toast):
  // the recipient side sets the chosen printing on every same-name slot and binds
  // the pulled copy to the edited slot; the donor side either leaves a gap (Move)
  // or takes this slot's displaced copy in return (Swap).
  const handleMovePrintingConfirm = (mode: 'move' | 'swap'): void => {
    if (!deck || !movePrompt) return;
    const { editSlotId, newCard, donor, swap } = movePrompt;
    setMovePrompt(null);
    const fromCube = donor.donorKind === 'cube';
    executeReallocation({
      donorDeckId: donor.donorDeckId,
      donorCubeId: fromCube ? donor.donorId : undefined,
      recipientDeckId: deck.id,
      // Only the edited slot changes — bring the one pulled copy into it. Other
      // same-name slots keep their own printing and binding; a move relocates a
      // single physical copy, not the whole playset.
      recipientApply: () => updateCardPrinting(deck.id, editSlotId, newCard, donor.copyId),
      donorApply: () => {
        if (fromCube) {
          useCubeStore.getState().releaseCubePick(donor.donorId, donor.copyId);
        } else if (mode === 'swap' && swap) {
          // Hand our displaced copy back to the donor's mainboard slot so it stays
          // whole — its slot now shows (and holds) that printing.
          updateCardPrinting(
            donor.donorDeckId,
            donor.donorSlotId!,
            swap.returnCard,
            swap.returnCopyId
          );
        } else {
          applyDonorOutcome(
            donor.donorDeckId,
            donor.donorZone,
            donor.donorSlotId,
            donor.donorCard!,
            'leave-gap',
            null
          );
        }
      },
      label:
        mode === 'swap' && swap
          ? `Swapped ${newCard.name} with ${donor.donorDeckName}`
          : `Moved ${newCard.name} here from ${donor.donorDeckName}`,
    });
  };

  return {
    setEditingSlot,
    handleMatchMyCopies,
    handleCheapestPrintings,
    editingSlot,
    handleEditConfirm,
    movePrompt,
    handleMovePrintingConfirm,
    setMovePrompt,
  };
}
