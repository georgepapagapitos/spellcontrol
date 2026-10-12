import { useCallback, useState } from 'react';
import type { PlaytestAction, PlaytestState, Zone } from '@/lib/playtest';
import { haptics } from '@/lib/util/haptics';
import type { OnlineTable } from '../../hooks/use-online-table';

interface SelectionInput {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  arrowFrom: { seat: number; cardId: string } | null;
  finishArrow: (toSeat: number, toCardId?: string) => void;
  ping: (cardId: string) => void;
}

/**
 * Battlefield selection + copy buffer (E226). Deliberately UI state, not
 * reducer state: selecting a card isn't a game action and must never land
 * on the 50-deep undo stack.
 */
export function useBoardSelection({
  state,
  dispatch,
  onlineTable,
  arrowFrom,
  finishArrow,
  ping,
}: SelectionInput) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // Touch has no shift/⌘ modifier, so building a selection was desktop-only.
  // Select mode makes a plain tap toggle selection instead of tapping the
  // card — same selection state, reached without a keyboard.
  const [selectMode, setSelectMode] = useState(false);
  const [clipboard, setClipboard] = useState<readonly string[]>([]);

  // useCallback so these keep their identity across PlaytestBoard renders —
  // Battlefield passes them straight through to every card's
  // React.memo(PlaytestCardView), and a fresh identity here would defeat
  // that memo for the whole battlefield on every dispatch.
  // Modifier-click builds a selection. What a PLAIN click does depends on
  // what is pointing at the card: with a mouse it does NOTHING (user,
  // 2026-09-21) — the click is the start of a drag, selecting is the box or
  // ⌘/ctrl-click, and tapping is a deliberate act (T, or Tap in the card
  // menu) the way it is at EDHPlay. Tapping on every stray click was the
  // first misfire; selecting on every stray click was the second. A finger
  // is the same since 2026-09-25 (EDHPlay's phone table, user-confirmed): a
  // tap pings, and Tap is the first row of the long-press menu.
  const handleCardClick = useCallback(
    (cardId: string, e: React.MouseEvent | React.KeyboardEvent) => {
      // Drawing an arrow: this tap is where it lands, not a tap of the card.
      if (arrowFrom && onlineTable) {
        finishArrow(onlineTable.mySeat, cardId);
        return;
      }
      // Every tap rings the card, whatever the tap then does — building a
      // selection, tapping a permanent, or landing an arrow. That IS the
      // gesture: the player is already pointing at the card with their
      // hand, and the ring is the table seeing them do it.
      ping(cardId);
      // Enter/Space on a focused card is the keyboard's ⌘-click: a keyboard
      // can neither drag a box nor hold a modifier over a card, so without
      // this there is no keyboard route into a selection at all.
      if (selectMode || e.type === 'keydown' || e.shiftKey || e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (!next.delete(cardId)) next.add(cardId);
          return next;
        });
        return;
      }
      // A plain click or tap says nothing beyond the ring it just put round
      // the card: it leaves the selection exactly as it found it, so a stray
      // one can neither tap a permanent nor throw away a box you spent a
      // gesture building.
    },
    [selectMode, arrowFrom, onlineTable, finishArrow, ping]
  );

  // Leaving select mode drops the selection with it, so nothing lingers
  // invisibly once taps go back to meaning "tap this card".
  const toggleSelectMode = useCallback(() => {
    setSelectMode((on) => {
      if (on) setSelected((prev) => (prev.size === 0 ? prev : new Set()));
      return !on;
    });
    haptics.tap();
  }, []);

  const clearSelection = useCallback(
    () => setSelected((prev) => (prev.size === 0 ? prev : new Set())),
    []
  );

  // A box dragged across bare felt. Holding a modifier as the drag starts
  // adds to what was already selected; a plain drag is a fresh selection.
  const selectArea = useCallback((ids: string[], additive: boolean) => {
    setSelected((prev) => {
      if (!additive) return new Set(ids);
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  // Batch actions over the selection (Archidekt/Moxfield `T` parity). Each
  // card is its own reducer step — the takeback trail counts them, which is
  // honest: a "tap all" of five creatures is five taps at the table too.
  const tapSelection = useCallback(() => {
    const cards = state.battlefield.filter((b) => selected.has(b.card.id));
    if (cards.length === 0) return;
    // Any untapped → tap them all (attacking / paying); all tapped → untap all.
    const tapped = cards.some((b) => !b.tapped);
    for (const b of cards)
      if (b.tapped !== tapped) dispatch({ type: 'TAP', cardId: b.card.id, tapped });
    haptics.tap();
  }, [dispatch, selected, state.battlefield]);
  const moveSelection = useCallback(
    (to: Zone, toIndex?: number) => {
      for (const id of selected) dispatch({ type: 'MOVE_TO_ZONE', cardId: id, to, toIndex });
      setSelected(new Set());
      haptics.tap();
    },
    [dispatch, selected]
  );

  return {
    selected,
    setSelected,
    selectMode,
    setSelectMode,
    clipboard,
    setClipboard,
    handleCardClick,
    toggleSelectMode,
    clearSelection,
    selectArea,
    tapSelection,
    moveSelection,
  };
}
