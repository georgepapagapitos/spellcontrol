import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { PlaytestAction, PlaytestCard, PlaytestState, Zone } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { haptics } from '@/lib/util/haptics';
import { usePlayStore } from '@/store/play';
import type { OnlineTable } from '../../hooks/use-online-table';
import { REACTION_EMOTES } from '../../lib/table-signals';
import type { TriggerCard } from '../TriggerReminder';
import { buildStackItems, buildTriggerCards } from './board-derive';
import type { PeekState } from './PeekModal';

interface CardActionsInput {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  sendSignal: ReturnType<typeof usePlayStore.getState>['sendSignal'];
  cardLookup: Map<string, ScryfallCard> | undefined;
  /** Reads live DOM geometry and is redefined every render by design. */
  placeOnBattlefield: (card: PlaytestCard) => { x: number; y: number };
  cloneCards: (sourceIds: readonly string[]) => string[] | undefined;
  setSelected: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setCountersFor: (cardId: string | null) => void;
  setPeek: (peek: PeekState | null) => void;
}

/**
 * The stack panel's list and the per-card actions the keyboard, the card
 * menus and the panel share: put on / copy onto / resolve the stack, reveal,
 * move to the battlefield, P/T and counters, the trigger reminder's cards,
 * a peek at a pile and a reaction. One run of hooks, called where those
 * hooks used to sit in PlaytestBoard.
 */
export function useCardActions({
  state,
  dispatch,
  onlineTable,
  sendSignal,
  cardLookup,
  placeOnBattlefield,
  cloneCards,
  setSelected,
  setCountersFor,
  setPeek,
}: CardActionsInput) {
  // ── The stack ───────────────────────────────────────────────────────────
  // Being on the stack is a MARK on a permanent already in play, not a zone
  // that holds it: the card keeps its place on the battlefield and wears a
  // ribbon while it waits. The panel is a view onto those marked cards.
  //
  // One list for the whole table: your own from the reducer, everyone
  // else's from their published board. Ordered exactly within a seat and
  // grouped across seats — see StackPanel for why that is the honest
  // rendering rather than an interleaving nobody can compute.
  const stackIds = state.stack;
  const stackItems = useMemo(
    () => buildStackItems(state.battlefield, stackIds, onlineTable),
    [stackIds, state.battlefield, onlineTable]
  );

  /**
   * Mark cards as waiting to resolve. A card still in hand is played first
   * — "casting" it — because the stack only ever names permanents in play.
   */
  const putOnStack = useCallback(
    (cardIds: readonly string[]) => {
      // A card in hand or a commander is cast onto the stack by way of the
      // battlefield, which is also what bumps a commander's tax.
      const castable = (id: string) =>
        state.zones.hand.find((c) => c.id === id) ?? state.zones.command.find((c) => c.id === id);
      const usable = cardIds.filter(
        (id) => state.battlefield.some((b) => b.card.id === id) || castable(id)
      );
      if (usable.length === 0) return false;
      for (const cardId of usable) {
        const handCard = castable(cardId);
        if (handCard) {
          const { x, y } = placeOnBattlefield(handCard);
          dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x, y });
        }
        dispatch({ type: 'PUT_ON_STACK', cardId });
      }
      setSelected(new Set());
      haptics.tap();
      return true;
    },
    // `placeOnBattlefield` reads live DOM geometry and is redefined every
    // render by design; every card it places is read fresh from `state`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, state.battlefield, state.zones.hand]
  );

  /** Copy a card onto the stack: a token copy of it, itself marked. */
  const copyOntoStack = useCallback(
    (cardIds: readonly string[]) => {
      const onBoard = cardIds.filter((id) => state.battlefield.some((b) => b.card.id === id));
      if (onBoard.length === 0) return false;
      const made = cloneCards(onBoard);
      for (const cardId of made ?? []) dispatch({ type: 'PUT_ON_STACK', cardId });
      return true;
    },
    [cloneCards, dispatch, state.battlefield]
  );

  const resolveStack = useCallback(
    (cardId?: string) => {
      if ((state.stack ?? []).length === 0) return false;
      dispatch({ type: 'RESOLVE_STACK', ...(cardId !== undefined && { cardId }) });
      haptics.tap();
      return true;
    },
    [dispatch, state.stack]
  );

  // ── Per-card actions the keyboard reaches ───────────────────────────────
  /** Is this id one of MY cards, anywhere? The hover target can be an
   *  opponent's permanent (their quadrant publishes a seat-scoped id), and
   *  a key that silently swallowed itself over one of those would read as a
   *  dead shortcut rather than falling through to the browser. */
  const locatable = useCallback(
    (cardId: string) =>
      state.battlefield.some((b) => b.card.id === cardId) ||
      (Object.keys(state.zones) as Zone[]).some((zone) =>
        state.zones[zone].some((c) => c.id === cardId)
      ),
    [state.battlefield, state.zones]
  );

  /** Show or stop showing hand cards to the table. */
  const toggleReveal = useCallback(
    (cardIds: readonly string[]) => {
      const inHand = cardIds.filter((id) => state.zones.hand.some((c) => c.id === id));
      if (inHand.length === 0) return false;
      for (const cardId of inHand) dispatch({ type: 'TOGGLE_REVEAL', cardId });
      haptics.tap();
      return true;
    },
    [dispatch, state.zones.hand]
  );

  /** Move cards onto the battlefield from wherever they are — the keyboard
   *  half of dragging one out of a zone. */
  const moveToBattlefield = useCallback(
    (cardIds: readonly string[]) => {
      const moved = cardIds.filter((id) => !state.battlefield.some((b) => b.card.id === id));
      if (moved.length === 0) return false;
      for (const cardId of moved) {
        const card =
          state.zones.hand.find((c) => c.id === cardId) ??
          state.zones.graveyard.find((c) => c.id === cardId) ??
          state.zones.exile.find((c) => c.id === cardId) ??
          state.zones.command.find((c) => c.id === cardId) ??
          state.zones.library.find((c) => c.id === cardId);
        if (!card) continue;
        const { x, y } = placeOnBattlefield(card);
        dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x, y });
      }
      setSelected(new Set());
      haptics.tap();
      return true;
    },
    // Same reason as `resolveStack`: `placeOnBattlefield` is DOM-reading and
    // per-render, and every card it places is read fresh from `state`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, state.battlefield, state.zones]
  );

  const adjustPT = useCallback(
    (cardIds: readonly string[], power: number, toughness: number) => {
      const onBoard = cardIds.filter((id) => state.battlefield.some((b) => b.card.id === id));
      if (onBoard.length === 0) return false;
      for (const cardId of onBoard) dispatch({ type: 'ADJUST_PT', cardId, power, toughness });
      haptics.tap();
      return true;
    },
    [dispatch, state.battlefield]
  );

  const adjustAllCounters = useCallback(
    (cardIds: readonly string[], op: 'inc' | 'dec' | 'double' | 'clear') => {
      const withCounters = cardIds.filter((id) =>
        state.battlefield.some((b) => b.card.id === id && Object.keys(b.counters).length > 0)
      );
      if (withCounters.length === 0) return false;
      for (const cardId of withCounters) dispatch({ type: 'ADJUST_ALL_COUNTERS', cardId, op });
      haptics.tap();
      return true;
    },
    [dispatch, state.battlefield]
  );

  /** Open the Custom counters dialog for one card: J, as on EDHPlay. */
  const openCounters = useCallback(
    (cardId: string) => {
      setCountersFor(cardId);
      return true;
    },
    [setCountersFor]
  );

  /**
   * Your permanents that carry an "at the beginning of …" trigger, for the
   * boundary reminder. Read off `cardLookup` rather than the reducer, since
   * `PlaytestCard` deliberately holds no oracle text.
   *
   * Face-down and phased-out permanents are left out: a face-down card is a
   * 2/2 with no abilities, and a phased-out one is not there to trigger. A
   * token, or any card the lookup can't key, has no oracle text to read and so
   * never reminds.
   */
  const triggerCards = useMemo<TriggerCard[]>(
    () => buildTriggerCards(cardLookup, state.battlefield),
    [cardLookup, state.battlefield]
  );

  /** Bring one card into view and select it, so a name in the reminder leads
   *  to the permanent it names. Selection, not a ping: a ping is a table
   *  signal, and your own bookkeeping is nobody else's business. */
  const locateCard = useCallback(
    (cardId: string) => {
      setSelected(new Set([cardId]));
      document
        .querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    [setSelected]
  );

  /** Look at one card off an end of the library without moving it. */
  /** Look at one card out of a pile without moving it. Only the library has
   *  a top and a bottom worth naming; anywhere else the pick is random. */
  const peekZone = useCallback(
    (where: 'top' | 'bottom' | 'random', zone: Zone = 'library') => {
      const lib = state.zones[zone];
      // `Math.random` rather than the state's seeded RNG on purpose: looking
      // at a card moves nothing and advances no seed, so there is no game
      // state here to keep reproducible.
      const card =
        where === 'top'
          ? lib[0]
          : where === 'bottom'
            ? lib.at(-1)
            : lib[Math.floor(Math.random() * lib.length)];
      if (!card) return false;
      setPeek({ card, where, zone });
      return true;
    },
    [state.zones, setPeek]
  );

  /** Send one of the four keyboard-bound reactions. */
  const sendReaction = useCallback(
    (index: number) => {
      if (!onlineTable) return false;
      const emote = REACTION_EMOTES[index];
      if (!emote) return false;
      void sendSignal({ kind: 'reaction', emote });
      haptics.tap();
      return true;
    },
    [onlineTable, sendSignal]
  );

  return {
    stackItems,
    putOnStack,
    copyOntoStack,
    resolveStack,
    locatable,
    toggleReveal,
    moveToBattlefield,
    adjustPT,
    adjustAllCounters,
    openCounters,
    triggerCards,
    locateCard,
    peekZone,
    sendReaction,
  };
}
