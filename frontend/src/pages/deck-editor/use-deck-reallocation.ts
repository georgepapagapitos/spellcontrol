import { useState } from 'react';
import { haptics } from '@/lib/util/haptics';
import { useDecksStore, withAllocationHealDeferred, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import {
  buildAllocationMap,
  pickCollectionCopy,
  findStealableCopy,
  type DonorOutcome,
  type DonorZone,
} from '@/lib/collection/allocations';
import { planProxyToggle, proxyToastMessage } from '@/lib/deck/proxy-slot';
import { useToastsStore } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

export function useDeckReallocation({
  deck,
  collectionCards,
}: {
  deck: Deck;
  collectionCards: EnrichedCard[];
}) {
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);
  const addSideboardCard = useDecksStore((s) => s.addSideboardCard);
  const removeSideboardCard = useDecksStore((s) => s.removeSideboardCard);
  const setCommander = useDecksStore((s) => s.setCommander);
  const setPartnerCommander = useDecksStore((s) => s.setPartnerCommander);
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const swapCard = useDecksStore((s) => s.swapCard);
  const setCardAllocation = useDecksStore((s) => s.setCardAllocation);
  const setCardProxy = useDecksStore((s) => s.setCardProxy);
  const replaceDeck = useDecksStore((s) => s.replaceDeck);
  const pushToast = useToastsStore((s) => s.push);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  // Physical-copy reallocation (move owned cards between decks). Each move is an
  // explicit, conscious action — nothing moves silently. Pulling a copy IN (the
  // Shared-copies review + per-row "Use my copy") is a direct leave-gap move with
  // an Undo toast; `moveCard` drives the MoveToDeckSheet (sending a copy out, with
  // the donor-outcome chooser); `releaseCard` drives the release confirm (freeing
  // a copy back to the collection).
  const [moveCard, setMoveCard] = useState<ScryfallCard | null>(null);
  const [releaseCard, setReleaseCard] = useState<ScryfallCard | null>(null);

  // ── Physical-copy reallocation (move owned cards between decks) ────────────
  // A move pulls one physical copy out of a donor deck and (optionally) into a
  // recipient deck, with an explicit donor outcome. A cross-deck move can't be a
  // single per-deck undo command, so it reverses via one toast "Undo" that
  // atomically restores BOTH decks' pre-move snapshots (the blessed
  // compensating-mutation pattern under LWW). Ctrl+Z stays in-deck-only.

  // Locate the slot in the current deck to move a copy of `name` OUT of. Prefers
  // an allocated slot (a real physical copy to move), else an unowned slot
  // (relocating just the list entry).
  const findDonorSlotInDeck = (
    name: string
  ): { zone: 'main' | 'sideboard'; slotId: string; copyId: string | null } | null => {
    if (!deck) return null;
    const key = name.toLowerCase();
    const mainAlloc = deck.cards.find(
      (c) => c.card.name.toLowerCase() === key && c.allocatedCopyId
    );
    if (mainAlloc)
      return { zone: 'main', slotId: mainAlloc.slotId, copyId: mainAlloc.allocatedCopyId };
    const sideAlloc = deck.sideboard.find(
      (c) => c.card.name.toLowerCase() === key && c.allocatedCopyId
    );
    if (sideAlloc)
      return { zone: 'sideboard', slotId: sideAlloc.slotId, copyId: sideAlloc.allocatedCopyId };
    const main = deck.cards.find((c) => c.card.name.toLowerCase() === key);
    if (main) return { zone: 'main', slotId: main.slotId, copyId: null };
    const side = deck.sideboard.find((c) => c.card.name.toLowerCase() === key);
    if (side) return { zone: 'sideboard', slotId: side.slotId, copyId: null };
    return null;
  };

  // Apply the chosen donor outcome to the slot losing the copy. Commander/partner
  // slots can only be freed (leave-gap) — they have no portable list slot.
  const applyDonorOutcome = (
    donorDeckId: string,
    zone: DonorZone,
    slotId: string | null,
    donorCard: ScryfallCard,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ): void => {
    // Cube donors never route here — a cube is freed via releaseCubePick (no slot,
    // leave-gap only). Guard so a future cube-outbound path can't silently no-op.
    if (zone === 'cube') {
      if (import.meta.env.DEV)
        throw new Error('[applyDonorOutcome] cube zone must use releaseCubePick');
      return;
    }
    if (zone === 'commander') return void setCommander(donorDeckId, donorCard, null);
    if (zone === 'partner') return void setPartnerCommander(donorDeckId, donorCard, null);
    if (!slotId) return;
    if (outcome === 'remove') {
      if (zone === 'sideboard') removeSideboardCard(donorDeckId, slotId);
      else removeCard(donorDeckId, slotId);
      return;
    }
    if (outcome === 'replace' && replacement) {
      const alloc =
        pickCollectionCopy(
          replacement.name,
          collectionCards,
          buildAllocationMap(useDecksStore.getState().decks, useCubeStore.getState().saved),
          replacement.card.id
        )?.copyId ?? null;
      if (zone === 'sideboard') {
        removeSideboardCard(donorDeckId, slotId);
        addSideboardCard(donorDeckId, replacement.card, alloc);
      } else {
        swapCard(donorDeckId, slotId, replacement.card, alloc);
      }
      return;
    }
    // leave-gap (default): the donor keeps the card as an unowned copy it needs.
    if (zone === 'sideboard') {
      // setCardAllocation only touches the mainboard; clear a sideboard slot's
      // allocation by re-seating it unowned.
      const slot = useDecksStore
        .getState()
        .decks.find((d) => d.id === donorDeckId)
        ?.sideboard.find((c) => c.slotId === slotId);
      removeSideboardCard(donorDeckId, slotId);
      if (slot) addSideboardCard(donorDeckId, slot.card, null);
    } else {
      setCardAllocation(donorDeckId, slotId, null);
    }
  };

  // Execute a cross-deck reallocation and offer a single toast-Undo that
  // atomically restores both decks.
  const executeReallocation = (opts: {
    donorDeckId: string;
    /** Set when the donor is a physical cube (instead of a deck) — snapshot the
     *  cube so Undo restores the released pick atomically alongside the deck. */
    donorCubeId?: string;
    recipientDeckId: string;
    recipientApply: () => void;
    donorApply: () => void;
    label: string;
  }): void => {
    const decksNow = useDecksStore.getState().decks;
    const snapDonor = decksNow.find((d) => d.id === opts.donorDeckId) ?? null;
    const snapRecipient =
      opts.recipientDeckId === opts.donorDeckId
        ? null
        : (decksNow.find((d) => d.id === opts.recipientDeckId) ?? null);
    const snapCube = opts.donorCubeId
      ? (useCubeStore.getState().saved.find((c) => c.id === opts.donorCubeId) ?? null)
      : null;
    // Ordering matters for crash-safety. A cube steal writes two different entity
    // rows (cube + deck) with no cross-entity dedupe heal, so RELEASE from the cube
    // first: a crash between the two writes then leaves the copy FREE (re-bindable),
    // never double-claimed. The deck→deck path keeps recipient-first because its
    // `replace` donor outcome must pick a free copy AFTER the moved copy is still
    // claimed (reversing it would let the replacement grab the copy being moved).
    // Deferred heal: between the two deck writes the moved copy is claimed
    // twice, and healing that half-state strips one claim by deck order.
    withAllocationHealDeferred(() => {
      if (opts.donorCubeId) {
        opts.donorApply();
        opts.recipientApply();
      } else {
        opts.recipientApply();
        opts.donorApply();
      }
    });
    haptics.tap();
    pushToast({
      message: opts.label,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => {
        withAllocationHealDeferred(() => {
          if (snapDonor) replaceDeck(opts.donorDeckId, snapDonor);
          if (snapRecipient) replaceDeck(opts.recipientDeckId, snapRecipient);
        });
        // Restore the cube's pre-release picks (re-binds the freed copy).
        if (snapCube) useCubeStore.getState().updateSaved(snapCube.id, { picks: snapCube.picks });
        haptics.tap();
      },
    });
  };

  // Surface 2 commit (from MoveToDeckSheet): send a copy of `card` from this deck
  // into `targetDeckId`, applying the donor outcome to THIS deck.
  const handleMoveConfirm = (
    card: ScryfallCard,
    targetDeckId: string,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ): void => {
    if (!deck) return;
    setMoveCard(null);
    const slot = findDonorSlotInDeck(card.name);
    if (!slot) return;
    const target = decks.find((d) => d.id === targetDeckId);
    executeReallocation({
      donorDeckId: deck.id,
      recipientDeckId: targetDeckId,
      recipientApply: () => addCard(targetDeckId, card, slot.copyId),
      donorApply: () =>
        applyDonorOutcome(deck.id, slot.zone, slot.slotId, card, outcome, replacement),
      label: `Moved ${card.name} → ${target?.name ?? 'deck'}`,
    });
  };

  // Surface 3: free an owned copy back to the collection (the slot stays as a
  // card you still need). Single-deck → normal undo + toast.
  const handleReleaseConfirm = (): void => {
    if (!deck || !releaseCard) return;
    const card = releaseCard;
    setReleaseCard(null);
    const slot = deck.cards.find((c) => c.card.name === card.name && c.allocatedCopyId);
    if (slot) {
      recordEdit(deck.id, `release ${card.name}`, () =>
        setCardAllocation(deck.id, slot.slotId, null)
      );
    } else if (deck.commander?.name === card.name && deck.commanderAllocatedCopyId) {
      recordEdit(deck.id, `release ${card.name}`, () =>
        setCommander(deck.id, deck.commander, null)
      );
    } else if (deck.partnerCommander?.name === card.name && deck.partnerCommanderAllocatedCopyId) {
      recordEdit(deck.id, `release ${card.name}`, () =>
        setPartnerCommander(deck.id, deck.partnerCommander, null)
      );
    } else {
      return;
    }
    pushToast({
      message: `${card.name} released. The copy is now free.`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  // Pull an owned copy of a slot's card into THIS deck from whichever other deck
  // OR physical cube holds it, leaving that donor a gap (it keeps the card
  // listed, now shown "In [this deck]"). One atomic Undo restores both. The
  // explicit "Move here…" / "Use my copy" click IS the conscious choice — we
  // don't pop a second sheet; the donor always gets leave-gap. (Replace/remove
  // live in the outbound "Move to another deck" flow; a cube only ever leaves a
  // gap.) Keyed by slotId so duplicate-name rows are exact.
  const handleMoveSharedCopy = (slotId: string): void => {
    if (!deck) return;
    const slot = deck.cards.find((c) => c.slotId === slotId);
    if (!slot) return;
    const stealable = findStealableCopy(
      slot.card.name,
      collectionCards,
      useDecksStore.getState().decks,
      deck.id,
      slot.card.id,
      useCubeStore.getState().saved
    );
    if (stealable) {
      const fromCube = stealable.donorKind === 'cube';
      executeReallocation({
        donorDeckId: stealable.donorDeckId,
        donorCubeId: fromCube ? stealable.donorId : undefined,
        recipientDeckId: deck.id,
        recipientApply: () => setCardAllocation(deck.id, slotId, stealable.copyId),
        donorApply: () =>
          fromCube
            ? useCubeStore.getState().releaseCubePick(stealable.donorId, stealable.copyId)
            : applyDonorOutcome(
                stealable.donorDeckId,
                stealable.donorZone,
                stealable.donorSlotId,
                stealable.donorCard!,
                'leave-gap',
                null
              ),
        label: `Moved ${slot.card.name} here from ${stealable.donorDeckName}`,
      });
      return;
    }
    // A free copy is available — bind it directly (no cross-deck move).
    const claim = pickCollectionCopy(
      slot.card.name,
      collectionCards,
      buildAllocationMap(useDecksStore.getState().decks, useCubeStore.getState().saved),
      slot.card.id
    );
    if (claim) {
      recordEdit(deck.id, `use my ${slot.card.name}`, () =>
        setCardAllocation(deck.id, slotId, claim.copyId)
      );
      pushToast({ message: `Using your copy of ${slot.card.name}`, tone: 'success' });
      haptics.tap();
    }
  };

  // Per-row "Use my copy" (row ⋮): resolve the card to its first unowned slot and
  // pull a copy in via the same conscious leave-gap move.
  const handleUseOwnCopy = (card: ScryfallCard): void => {
    if (!deck) return;
    const slot = deck.cards.find(
      (c) => c.card.name === card.name && !c.allocatedCopyId && !c.proxy
    );
    if (slot) handleMoveSharedCopy(slot.slotId);
  };

  // Row ⋮ "Mark as proxy" / "Not a proxy": a proxy slot never claims a copy, so
  // no matcher (boot, sync, Repair) pulls one back in (lib/deck/proxy-slot.ts).
  const handleSetProxy = (slotIds: string[], proxy: boolean): void => {
    if (!deck) return;
    const { decks: all } = useDecksStore.getState();
    const plan = planProxyToggle(deck, slotIds, proxy, collectionCards, all, savedCubes);
    if (!plan) return;
    if (plan.kind === 'hand-over') {
      const { waiting, copy, slot } = plan;
      return executeReallocation({
        donorDeckId: deck.id,
        recipientDeckId: waiting.deckId,
        recipientApply: () => setCardAllocation(waiting.deckId, waiting.slotId, copy.copyId),
        donorApply: () => setCardProxy(deck.id, slot.slotId, true),
        label: proxyToastMessage(plan),
      });
    }
    const copyId = plan.kind === 'unmark' ? plan.copyId : null;
    recordEdit(deck.id, `${proxy ? '' : 'un'}proxy ${plan.slot.card.name}`, () =>
      setCardProxy(deck.id, plan.slot.slotId, proxy, copyId)
    );
    haptics.tap();
    const onAction = () => undoEdit(deck.id);
    pushToast({ message: proxyToastMessage(plan), tone: 'success', actionLabel: 'Undo', onAction });
  };

  return {
    executeReallocation,
    applyDonorOutcome,
    setMoveCard,
    setReleaseCard,
    handleSetProxy,
    handleUseOwnCopy,
    moveCard,
    handleMoveConfirm,
    releaseCard,
    handleReleaseConfirm,
    handleMoveSharedCopy,
  };
}
