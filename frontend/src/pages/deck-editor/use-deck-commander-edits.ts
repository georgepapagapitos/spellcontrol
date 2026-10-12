import { useState } from 'react';
import { useDecksStore, commanderShortName, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { buildAllocationMap, pickCollectionCopy } from '@/lib/collection/allocations';
import { deckColorIdentity, fitsColorIdentity } from '@/lib/deck/deck-validation';
import { areValidPartners } from '@/deck-builder/lib/partnerUtils';
import { useToastsStore } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

export function useDeckCommanderEdits({
  deck,
  collectionCards,
}: {
  deck: Deck;
  collectionCards: EnrichedCard[];
}) {
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);
  const removeSideboardCard = useDecksStore((s) => s.removeSideboardCard);
  const chooseCommander = useDecksStore((s) => s.chooseCommander);
  const setPartnerCommander = useDecksStore((s) => s.setPartnerCommander);
  const pushToast = useToastsStore((s) => s.push);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  // The card about to replace the current commander, waiting on "keep the old
  // one or remove it". `slotId` is the mainboard/sideboard slot it moves out
  // of, or null when it came from the commander picker's search (not in the deck).
  const [makeCommanderTarget, setMakeCommanderTarget] = useState<{
    slotId: string | null;
    card: ScryfallCard;
    allocatedCopyId: string | null;
  } | null>(null);
  // The commander picker (E465): the open slot, the empty state and the Coach
  // tab open it when there's no commander; the commander row's menu opens it
  // to change one.
  const [showCommanderPicker, setShowCommanderPicker] = useState(false);
  const [makePartnerTarget, setMakePartnerTarget] = useState<{
    slotId: string;
    card: ScryfallCard;
    zone: 'main' | 'side';
    allocatedCopyId: string | null;
  } | null>(null);
  const [showPartnerPicker, setShowPartnerPicker] = useState(false);

  const handleMakeCommanderClick = (slotId: string, card: ScryfallCard) => {
    const slot =
      deck.cards.find((c) => c.slotId === slotId) ??
      deck.sideboard.find((c) => c.slotId === slotId);
    if (!slot) return;
    const target = { slotId, card, allocatedCopyId: slot.allocatedCopyId ?? null };
    // No current commander → just set it directly, no dialog needed.
    if (!deck.commander) {
      recordEdit(deck.id, `make ${card.name} commander`, () =>
        chooseCommander(deck.id, card, target.allocatedCopyId, { fromSlotId: slotId })
      );
      pushToast({ message: `${card.name} is now the commander.`, tone: 'success' });
      return;
    }
    setMakeCommanderTarget(target);
  };

  const handleConfirmMakeCommander = (keepOldInDeck: boolean) => {
    const target = makeCommanderTarget;
    if (!target) return;
    const oldCommander = deck.commander;
    setMakeCommanderTarget(null);

    recordEdit(deck.id, `make ${target.card.name} commander`, () =>
      chooseCommander(deck.id, target.card, target.allocatedCopyId, {
        fromSlotId: target.slotId,
        keepPrevious: keepOldInDeck,
      })
    );
    pushToast({
      message: `${target.card.name} is now the commander${
        keepOldInDeck && oldCommander ? ` · ${oldCommander.name} moved to the deck` : ''
      }.`,
      tone: 'success',
    });
  };

  // Commander picker (E465). Mirrors the partner picker below: a card already
  // in the deck moves into the command zone with its copy claim; one that
  // isn't claims a free owned copy if there is one. Either way it's ONE store
  // write and one undo entry. Replacing an existing commander goes through
  // the same keep/remove confirm as Make commander.
  const handleSelectCommanderFromPicker = (card: ScryfallCard) => {
    setShowCommanderPicker(false);
    if (card.name === deck.commander?.name || card.name === deck.partnerCommander?.name) return;
    const slot =
      deck.cards.find((c) => c.card.name === card.name) ??
      deck.sideboard.find((c) => c.card.name === card.name);
    let allocated: string | null;
    if (slot) {
      allocated = slot.allocatedCopyId ?? null;
    } else {
      const allocations = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      allocated =
        pickCollectionCopy(card.name, collectionCards, allocations, card.id)?.copyId ?? null;
    }
    if (deck.commander) {
      setMakeCommanderTarget({ slotId: slot?.slotId ?? null, card, allocatedCopyId: allocated });
      return;
    }
    recordEdit(deck.id, `make ${card.name} commander`, () =>
      chooseCommander(deck.id, card, allocated, { fromSlotId: slot?.slotId })
    );
    // Off-color cards are flagged by the deck checks, never removed; the toast
    // counts them so the pick's consequence is said once, where it happened.
    const after = useDecksStore.getState().decks.find((d) => d.id === deck.id);
    const identity = deckColorIdentity(card, after?.partnerCommander ?? null);
    const offColor = (after?.cards ?? []).filter(
      (c) => !fitsColorIdentity(c.card, identity)
    ).length;
    pushToast({
      message: `${commanderShortName(card)} is the commander.${
        offColor === 0
          ? ''
          : offColor === 1
            ? ' 1 card is off color.'
            : ` ${offColor} cards are off color.`
      }`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  // Whether a deck card is a legal partner for the current commander — gates
  // the "Make partner" row action. Requires a commander already set; the
  // partner mechanic itself (generic Partner, "Partner with X", Friends
  // forever, Choose a Background, Doctor's companion) is checked in
  // areValidPartners, which also rejects pairing a card with itself. Plain
  // function, not a hook.
  const canMakePartner = (card: ScryfallCard) =>
    !!deck.commander && areValidPartners(deck.commander, card);

  const handleMakePartnerClick = (slotId: string, card: ScryfallCard) => {
    const mainSlot = deck.cards.find((c) => c.slotId === slotId);
    const sideSlot = mainSlot ? null : deck.sideboard.find((c) => c.slotId === slotId);
    const slot = mainSlot ?? sideSlot;
    if (!slot) return;
    const target = {
      slotId,
      card,
      zone: (mainSlot ? 'main' : 'side') as 'main' | 'side',
      allocatedCopyId: slot.allocatedCopyId,
    };
    // No current partner → pull the card out of the deck and pair it directly.
    if (!deck.partnerCommander) {
      recordEdit(deck.id, `make ${card.name} partner`, () => {
        if (target.zone === 'main') removeCard(deck.id, slotId);
        else removeSideboardCard(deck.id, slotId);
        setPartnerCommander(deck.id, card, target.allocatedCopyId);
      });
      pushToast({ message: `${card.name} is now the partner commander.`, tone: 'success' });
      return;
    }
    setMakePartnerTarget(target);
  };

  const handleConfirmMakePartner = (keepOldInDeck: boolean) => {
    const target = makePartnerTarget;
    if (!target) return;
    const oldPartner = deck.partnerCommander;
    const oldAllocated = deck.partnerCommanderAllocatedCopyId;
    setMakePartnerTarget(null);

    recordEdit(deck.id, `make ${target.card.name} partner`, () => {
      if (target.zone === 'main') removeCard(deck.id, target.slotId);
      else removeSideboardCard(deck.id, target.slotId);

      if (keepOldInDeck && oldPartner) {
        addCard(deck.id, oldPartner, oldAllocated);
      }
      setPartnerCommander(deck.id, target.card, target.allocatedCopyId);
    });
    pushToast({
      message: `${target.card.name} is now the partner commander${
        keepOldInDeck && oldPartner ? ` · ${oldPartner.name} moved to the deck` : ''
      }.`,
      tone: 'success',
    });
  };

  // Picker entry point (hero): pair a legal partner that may not already be in
  // the deck. If the chosen card IS in the deck, reuse its slot/allocation and
  // pull it out (mirrors make-commander); otherwise claim a free owned copy.
  // Passing null clears the partner.
  const handleSelectPartnerFromPicker = (card: ScryfallCard | null) => {
    if (!card) {
      recordEdit(deck.id, 'remove partner', () => setPartnerCommander(deck.id, null, null));
      pushToast({ message: 'Partner commander removed.', tone: 'success' });
      return;
    }
    const mainSlot = deck.cards.find((c) => c.card.name === card.name);
    const sideSlot = mainSlot ? null : deck.sideboard.find((c) => c.card.name === card.name);
    const slot = mainSlot ?? sideSlot;
    let allocated: string | null;
    if (slot) {
      allocated = slot.allocatedCopyId ?? null;
    } else {
      const allocations = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      allocated =
        pickCollectionCopy(card.name, collectionCards, allocations, card.id)?.copyId ?? null;
    }
    recordEdit(deck.id, `make ${card.name} partner`, () => {
      if (slot) {
        if (mainSlot) removeCard(deck.id, slot.slotId);
        else removeSideboardCard(deck.id, slot.slotId);
      }
      setPartnerCommander(deck.id, card, allocated);
    });
    setShowPartnerPicker(false);
    pushToast({ message: `${card.name} is now the partner commander.`, tone: 'success' });
  };

  return {
    handleMakeCommanderClick,
    handleMakePartnerClick,
    canMakePartner,
    setShowCommanderPicker,
    setShowPartnerPicker,
    makeCommanderTarget,
    setMakeCommanderTarget,
    handleConfirmMakeCommander,
    makePartnerTarget,
    setMakePartnerTarget,
    handleConfirmMakePartner,
    showCommanderPicker,
    handleSelectCommanderFromPicker,
    showPartnerPicker,
    handleSelectPartnerFromPicker,
  };
}
