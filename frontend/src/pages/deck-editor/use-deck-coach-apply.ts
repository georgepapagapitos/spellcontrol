import { useState } from 'react';
import { haptics } from '@/lib/util/haptics';
import { useNavigate } from 'react-router-dom';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { type Change } from '@/lib/coach/deck-change';
import { type CrossDeckMove } from '@/lib/coach/cross-deck-moves';
import { buildAllocationMap, pickCollectionCopy } from '@/lib/collection/allocations';
import { useToastsStore } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import { applyUpgradePlan, type PlanStep } from '@/lib/coach/apply-upgrade-plan';
import { logger } from '@/lib/util/logger';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { Dispatch, SetStateAction } from 'react';

export function useDeckCoachApply({
  deck,
  collectionCards,
  crossDeckMoves,
  deckIsFull,
  setPendingMove,
  setPendingAdd,
  setPendingAddPrinting,
  setPendingAddGroup,
  commitCrossDeckMove,
  handleAddEngineCard,
  handleCutEngineCard,
  setPlanOpen,
}: {
  deck: Deck;
  collectionCards: EnrichedCard[];
  crossDeckMoves: CrossDeckMove[];
  deckIsFull: boolean;
  setPendingMove: Dispatch<SetStateAction<CrossDeckMove | null>>;
  setPendingAdd: Dispatch<SetStateAction<string | null>>;
  setPendingAddPrinting: Dispatch<SetStateAction<ScryfallCard | null>>;
  setPendingAddGroup: Dispatch<SetStateAction<string | null>>;
  commitCrossDeckMove: (
    move: CrossDeckMove,
    place: (deckId: string, card: ScryfallCard, copyId: string) => void
  ) => Promise<void>;
  handleAddEngineCard: (cardName: string) => Promise<void>;
  handleCutEngineCard: (cardName: string) => void;
  setPlanOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const navigate = useNavigate();
  const renameDeck = useDecksStore((s) => s.renameDeck);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const addCard = useDecksStore((s) => s.addCard);
  const duplicateDeck = useDecksStore((s) => s.duplicateDeck);
  const swapCard = useDecksStore((s) => s.swapCard);
  const pushToast = useToastsStore((s) => s.push);
  const beginEdit = useDeckHistoryStore((s) => s.begin);
  const commitEdit = useDeckHistoryStore((s) => s.commit);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  // In-context "Swap this card" — its OWN loading gate (not addingEngineNames),
  // so a swap-in-flight never cross-disables the Engine/Substitution Add buttons.
  const [swappingSlot, setSwappingSlot] = useState<string | null>(null);
  // Bracket Fit swaps gate the row by the CUT card's name (the page-side swap
  // state is slot-keyed, which BracketFitLane can't see). Tracked separately so a
  // swap-in-flight disables only its own row.
  const [bracketFitSwapName, setBracketFitSwapName] = useState<string | null>(null);

  // In-context swap: cut the in-deck card at `slotId` and add `newName` in its
  // place (resolve → allocate → add). Removal runs BEFORE the add so the freed
  // physical copy is re-allocatable; net size is unchanged (1-for-1), keeping a
  // 99-card deck legal. `close()` dismisses the preview (the card it showed is
  // gone). Uses its own loading gate (swappingSlot).
  const handleSwapInDeck = async (
    slotId: string,
    oldName: string,
    newName: string,
    close: () => void
  ) => {
    if (!deck) return;
    setSwappingSlot(slotId);
    try {
      const scry = await getCardByName(newName);
      if (!scry) {
        pushToast({ message: `Couldn't find ${newName}`, tone: 'error' });
        return;
      }
      const before = beginEdit(deck.id);
      const allocations = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      const claim = pickCollectionCopy(newName, collectionCards, allocations, scry.id);
      // Atomic swap: one state update, so no transient "card removed" deck row.
      swapCard(deck.id, slotId, scry, claim?.copyId ?? null);
      if (before) commitEdit(deck.id, `swap ${oldName} → ${newName}`, before);
      pushToast({ message: `Swapped ${oldName} → ${newName}`, tone: 'success' });
      haptics.tap();
      close();
    } catch {
      pushToast({ message: `Couldn't swap ${oldName}`, tone: 'error' });
    } finally {
      setSwappingSlot(null);
    }
  };

  // CoachFeed unified apply handler — routes add/cut/swap changes from the
  // CoachFeed to the existing engine add/cut/swap flows.
  const handleApplyCoachMove = async (change: Change) => {
    if (!deck) return;
    if (change.lane === 'decks') {
      // One move per card into this deck (the engine dedupes card × target).
      const move = crossDeckMoves.find((m) => m.cardName === change.name);
      if (!move) return;
      if (deckIsFull) {
        setPendingMove(move);
        setPendingAdd(move.cardName);
        setPendingAddPrinting(null);
        setPendingAddGroup(null);
        return;
      }
      await commitCrossDeckMove(move, addCard);
      return;
    }
    if (change.type === 'add') {
      await handleAddEngineCard(change.name);
    } else if (change.type === 'cut') {
      handleCutEngineCard(change.name);
    } else if (change.type === 'swap' && change.inName) {
      if (bracketFitSwapName === change.inName) return;
      const slotId = deck.cards.find((c) => c.card.name === change.inName)?.slotId;
      if (!slotId) return;
      setBracketFitSwapName(change.inName);
      void handleSwapInDeck(slotId, change.inName, change.name, () => {}).finally(() =>
        setBracketFitSwapName(null)
      );
    }
  };

  // Apply a batch of 1-for-1 swaps as ONE undo entry: each pair cuts the named
  // in-deck card and adds the replacement. Drives both the budget "Apply all
  // drop-ins" and the bracket "Converge to target" bulk actions — both are
  // swap-only, so the deck size never changes. `kind` only tunes the copy.
  const handleApplyCostSwaps = async (
    swaps: Array<{ removeName: string; addName: string }>,
    kind: 'budget' | 'bracket' | 'ai' = 'budget'
  ) => {
    if (!deck) return;
    const kindLabel = kind === 'ai' ? 'AI' : kind;
    try {
      const slotsByName = new Map<string, string[]>();
      for (const c of deck.cards) {
        const k = c.card.name.toLowerCase();
        const arr = slotsByName.get(k) ?? [];
        arr.push(c.slotId);
        slotsByName.set(k, arr);
      }
      // Bracket the whole batch as one undo entry (begin before the loop,
      // commit once after) — Cmd+Z reverts the entire budget plan at once.
      const before = beginEdit(deck.id);
      let done = 0;
      for (const { removeName, addName } of swaps) {
        const slotId = slotsByName.get(removeName.toLowerCase())?.shift();
        if (!slotId) continue;
        try {
          const scry = await getCardByName(addName);
          if (!scry) continue;
          const allocations = buildAllocationMap(
            useDecksStore.getState().decks,
            useCubeStore.getState().saved
          );
          const claim = pickCollectionCopy(addName, collectionCards, allocations, scry.id);
          swapCard(deck.id, slotId, scry, claim?.copyId ?? null);
          done += 1;
        } catch {
          /* skip cards that won't resolve — leave the original in place */
        }
      }
      if (before)
        commitEdit(deck.id, `apply ${done} ${kindLabel} swap${done === 1 ? '' : 's'}`, before);
      pushToast({
        message: `Applied ${done} ${kindLabel} swap${done === 1 ? '' : 's'}`,
        tone: 'success',
      });
    } catch {
      pushToast({ message: `Couldn't apply ${kindLabel} swaps`, tone: 'error' });
    }
  };

  // E458: apply the plan in place (one undo entry) or to a fresh copy, which
  // leaves this list as it was. A copy the plan never reached is removed again.
  const handleApplyPlan = async (steps: PlanStep[], toCopy: boolean) => {
    if (!deck) return;
    const upgradedName = `${deck.name} (upgraded)`;
    const targetId = toCopy ? duplicateDeck(deck.id) : deck.id;
    if (!targetId) return;
    if (toCopy) renameDeck(targetId, upgradedName);
    let done = 0;
    try {
      done = await applyUpgradePlan(targetId, steps);
    } catch (err) {
      logger.warn('[UpgradePlan] apply failed', err);
    }
    if (done === 0) {
      if (toCopy) deleteDeck(targetId);
      pushToast({ message: "Couldn't apply the plan. Try again.", tone: 'error' });
      return;
    }
    setPlanOpen(false);
    if (toCopy) {
      pushToast({
        message: `Saved as ${upgradedName}`,
        tone: 'success',
        actionLabel: 'Open',
        onAction: () => navigate(`/decks/${targetId}`),
      });
    } else {
      pushToast({
        message: `Applied ${done} ${done === 1 ? 'swap' : 'swaps'}`,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: () => undoEdit(deck.id),
      });
    }
  };

  return {
    handleApplyCoachMove,
    handleApplyCostSwaps,
    swappingSlot,
    handleSwapInDeck,
    bracketFitSwapName,
    handleApplyPlan,
  };
}
