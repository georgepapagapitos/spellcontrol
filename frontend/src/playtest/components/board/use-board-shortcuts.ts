import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { PlaytestAction, PlaytestState, Zone } from '@/lib/playtest';
import { isTypingTarget } from '@/components/app-shell/shortcut-registry';
import { haptics } from '@/lib/util/haptics';
import type { OnlineTable } from '../../hooks/use-online-table';
import type { ViewerMode } from '../../lib/board-support';
import { shortcutFor, type ShortcutId } from '../../lib/shortcuts';
import type { useCardActions } from './use-card-actions';

type CardActions = ReturnType<typeof useCardActions>;

type BoardShortcutsInput = {
  anySheetOpen: boolean;
  bindings: Parameters<typeof shortcutFor>[1];
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  isNarrow: boolean;
  libraryCount: number;
  hoverTarget: { readonly current: string | null };
  // Selection and clipboard.
  selected: ReadonlySet<string>;
  clipboard: readonly string[];
  clearSelection: () => void;
  cloneCards: (sourceIds: readonly string[]) => string[] | undefined;
  setSelected: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setSelectMode: (on: boolean) => void;
  setClipboard: (ids: readonly string[]) => void;
  // Arrows.
  arrowFrom: unknown;
  setArrowFrom: (from: null) => void;
  beginArrow: (cardIds: ReadonlySet<string>) => boolean | void;
  clearMyArrows: () => boolean | void;
  myArrowCount: number;
  // Turn, takeback, log and layout.
  handleTakebackClick: () => void;
  handleOpenLog: () => void;
  showLog: boolean;
  setShowLog: (open: boolean) => void;
  canPassTurn: boolean;
  advanceTurn: () => boolean;
  doDraw: () => void;
  doNextTurn: () => void;
  doNextTurnHordeAware: () => boolean;
  doPassTurn: () => void;
  doUntapAll: () => void;
  advancePhase: () => void;
  adjustMyLife: (delta: number) => void;
  toggleLayout: () => void;
  stepZoom: (dir: 1 | -1) => void;
  // Sheets the keys open.
  setTableMenu: (at: { x: number; y: number }) => void;
  setViewingBoardSeat: (seat: number) => void;
  setShowShortcuts: (open: boolean) => void;
  setViewer: (viewer: ViewerMode) => void;
  setScryFrom: (from: 'top' | 'bottom') => void;
  setShowScry: (open: boolean) => void;
  setShowDice: (open: boolean) => void;
  setTokenCreator: (open: boolean) => void;
  setManaOpen: Dispatch<SetStateAction<boolean>>;
} & Pick<
  CardActions,
  | 'locatable'
  | 'putOnStack'
  | 'copyOntoStack'
  | 'resolveStack'
  | 'toggleReveal'
  | 'moveToBattlefield'
  | 'adjustPT'
  | 'adjustAllCounters'
  | 'openCounters'
  | 'peekZone'
  | 'sendReaction'
>;

/**
 * The board's keyboard map: one handler, driven by the rebindable table in
 * lib/shortcuts. Ignored while typing or while any sheet/modal/context menu
 * is open; harmless if it never fires on touch (every action here is also
 * a button or a menu item). Keys the board doesn't know fall through so the
 * browser keeps them.
 */
export function useBoardShortcuts({
  anySheetOpen,
  bindings,
  state,
  dispatch,
  onlineTable,
  isNarrow,
  libraryCount,
  hoverTarget,
  selected,
  clipboard,
  clearSelection,
  cloneCards,
  setSelected,
  setSelectMode,
  setClipboard,
  arrowFrom,
  setArrowFrom,
  beginArrow,
  clearMyArrows,
  myArrowCount,
  handleTakebackClick,
  handleOpenLog,
  showLog,
  setShowLog,
  canPassTurn,
  advanceTurn,
  doDraw,
  doNextTurn,
  doNextTurnHordeAware,
  doPassTurn,
  doUntapAll,
  advancePhase,
  adjustMyLife,
  toggleLayout,
  stepZoom,
  setTableMenu,
  setViewingBoardSeat,
  setShowShortcuts,
  setViewer,
  setScryFrom,
  setShowScry,
  setShowDice,
  setTokenCreator,
  setManaOpen,
  locatable,
  putOnStack,
  copyOntoStack,
  resolveStack,
  toggleReveal,
  moveToBattlefield,
  adjustPT,
  adjustAllCounters,
  openCounters,
  peekZone,
  sendReaction,
}: BoardShortcutsInput) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (anySheetOpen || isTypingTarget(e.target)) return;
      // Keyboard route to the table menu: the physical Context Menu key, or
      // Shift+F10 on keyboards without one. Anchored at the board's center,
      // since a keyboard has no cursor to open at.
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        setTableMenu({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        return;
      }
      const id = shortcutFor(e, bindings);
      if (id === null) return;
      // "The card in view": the selection when there is one, otherwise
      // whatever the pointer is resting on (or keyboard focus is inside).
      // One rule behind every per-card key, so H means the same thing
      // whether you built a selection first or just moved the mouse.
      const hovered = hoverTarget.current;
      const targets: string[] = selected.size > 0 ? [...selected] : hovered ? [hovered] : [];
      const bfTargets = targets.filter((tid) => state.battlefield.some((b) => b.card.id === tid));
      const moveTargets = (to: Zone, toIndex?: number) => {
        // Filtered rather than dispatched blind: the reducer no-ops on an id
        // it can't find, but a hovered OPPONENT card carries a seat-scoped
        // id, and swallowing the key there would look like a dead shortcut
        // instead of falling through to the browser.
        const movable = targets.filter((tid) => locatable(tid));
        if (movable.length === 0) return false;
        for (const cardId of movable) {
          dispatch({ type: 'MOVE_TO_ZONE', cardId, to, ...(toIndex !== undefined && { toIndex }) });
        }
        setSelected(new Set());
        haptics.tap();
        return true;
      };
      const focus = (n: number) => {
        const opp = onlineTable?.opponents[n - 1];
        if (opp) setViewingBoardSeat(opp.board.seat);
      };
      const stepPT = (power: number, toughness: number) => adjustPT(targets, power, toughness);
      /** A ±1/±1 counter on everything targeted, or `false` when nothing is —
       *  which is what lets `=` and `-` fall through to card size. */
      const stepCounter = (counter: '+1/+1' | '-1/-1') => {
        if (bfTargets.length === 0) return false;
        for (const cardId of bfTargets)
          dispatch({ type: 'SET_COUNTER', cardId, counter, delta: 1 });
      };
      // `false` from a handler means "nothing to act on": the key is left to
      // the browser (so ⌘C over real text still copies text, and Space on a
      // focused button still presses it).
      const handlers: Record<ShortcutId, () => boolean | void> = {
        menu: () => {
          // Escape only ever backs out of something: an armed arrow, then a
          // selection. With nothing to back out of it does NOTHING and the
          // key falls through — it used to open the table menu instead,
          // which made the universal "get me out of this" key summon a
          // panel in the middle of the felt. The menu's own ways in are
          // unchanged: right-click, the Context Menu key, Shift+F10 and the
          // corner button.
          if (arrowFrom) setArrowFrom(null);
          else if (selected.size > 0) clearSelection();
          else return false;
        },
        arrow: () => beginArrow(new Set(targets)),
        'arrows-clear': () => (myArrowCount > 0 ? clearMyArrows() : false),
        shortcuts: () => setShowShortcuts(true),
        'pass-turn': () => {
          // Space on a focused button presses that button; it is not ours
          // to steal.
          if (e.target instanceof HTMLElement && e.target.closest('button')) return false;
          return advanceTurn();
        },
        'next-turn': doNextTurnHordeAware,
        draw: () => (libraryCount === 0 ? false : doDraw()),
        'untap-all': doUntapAll,
        'advance-phase': () => (onlineTable ? advancePhase() : false),
        'life-up': () => adjustMyLife(1),
        'life-down': () => adjustMyLife(-1),
        shuffle: () => dispatch({ type: 'SHUFFLE_LIBRARY' }),
        'view-library': () => (libraryCount === 0 ? false : setViewer({ zone: 'library' })),
        scry: () => {
          if (libraryCount === 0) return false;
          setScryFrom('top');
          setShowScry(true);
        },
        'scry-bottom': () => {
          if (libraryCount === 0) return false;
          setScryFrom('bottom');
          setShowScry(true);
        },
        'view-top-card': () => peekZone('top'),
        'view-bottom-card': () => peekZone('bottom'),
        dice: () => setShowDice(true),
        token: () => setTokenCreator(true),
        mana: () => setManaOpen((open) => !open),
        log: () => (showLog && !isNarrow ? setShowLog(false) : handleOpenLog()),
        undo: handleTakebackClick,
        'stack-add': () => putOnStack(targets),
        'stack-copy': () => copyOntoStack(targets),
        'stack-resolve': () => resolveStack(),
        'select-all': () => {
          if (state.battlefield.length === 0) return false;
          setSelected(new Set(state.battlefield.map((b) => b.card.id)));
          setSelectMode(true);
        },
        'tap-selection': () => {
          if (bfTargets.length === 0) return false;
          // Any untapped in the group taps them all, matching the selection
          // behavior a single hovered card collapses to anyway.
          const tapped = state.battlefield.some((b) => bfTargets.includes(b.card.id) && !b.tapped);
          for (const cardId of bfTargets) dispatch({ type: 'TAP', cardId, tapped });
          haptics.tap();
        },
        copy: () => (selected.size > 0 ? setClipboard([...selected]) : false),
        paste: () => {
          if (clipboard.length === 0) return false;
          const made = cloneCards(clipboard);
          if (made) setClipboard(made);
        },
        clone: () => (bfTargets.length > 0 ? void cloneCards(bfTargets) : false),
        transform: () => {
          if (bfTargets.length === 0) return false;
          for (const cardId of bfTargets) dispatch({ type: 'TRANSFORM', cardId });
        },
        'face-down': () => {
          if (bfTargets.length === 0) return false;
          for (const cardId of bfTargets) dispatch({ type: 'FLIP_FACE', cardId });
          haptics.tap();
        },
        reveal: () => toggleReveal(targets),
        'to-battlefield': () => moveToBattlefield(targets),
        counters: () => (bfTargets.length > 0 ? openCounters(bfTargets[0]) : false),
        // `=` and `-` read the context, which is EDHPlay's own mapping and
        // what this board did before the keyboard map split them into four
        // keys: with a card under the pointer (or a selection) they are
        // ±1/±1 counters, with nothing targeted they size the cards. The two
        // never compete in play — you reach for a counter with a card under
        // the pointer, and for card size while looking at the whole board —
        // and the shifted `plus` / `_` below stay bound as the unambiguous
        // way to force a counter whatever the pointer is over.
        'size-up': () => (bfTargets.length > 0 ? stepCounter('+1/+1') : stepZoom(1)),
        'size-down': () => (bfTargets.length > 0 ? stepCounter('-1/-1') : stepZoom(-1)),
        'counter-plus': () => stepCounter('+1/+1'),
        'counter-minus': () => stepCounter('-1/-1'),
        'counters-all-inc': () => adjustAllCounters(bfTargets, 'inc'),
        'counters-all-double': () => adjustAllCounters(bfTargets, 'double'),
        'counters-all-dec': () => adjustAllCounters(bfTargets, 'dec'),
        'power-inc': () => stepPT(1, 0),
        'toughness-inc': () => stepPT(0, 1),
        'power-dec': () => stepPT(-1, 0),
        'toughness-dec': () => stepPT(0, -1),
        'to-hand': () => moveTargets('hand'),
        'to-graveyard': () => moveTargets('graveyard'),
        'to-exile': () => moveTargets('exile'),
        'to-library-top': () => moveTargets('library', 0),
        'to-library-bottom': () => moveTargets('library'),
        'toggle-layout': () => toggleLayout(),
        'focus-1': () => focus(1),
        'focus-2': () => focus(2),
        'focus-3': () => focus(3),
        'focus-4': () => focus(4),
        'focus-5': () => focus(5),
        'focus-6': () => focus(6),
        'react-1': () => sendReaction(0),
        'react-2': () => sendReaction(1),
        'react-3': () => sendReaction(2),
        'react-4': () => sendReaction(3),
      };
      if (handlers[id]() === false) return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    anySheetOpen,
    bindings,
    handleTakebackClick,
    handleOpenLog,
    canPassTurn,
    advanceTurn,
    doDraw,
    doNextTurn,
    doNextTurnHordeAware,
    doPassTurn,
    doUntapAll,
    advancePhase,
    adjustMyLife,
    libraryCount,
    selected,
    clipboard,
    cloneCards,
    clearSelection,
    dispatch,
    onlineTable,
    showLog,
    isNarrow,
    state.battlefield,
    stepZoom,
    arrowFrom,
    beginArrow,
    clearMyArrows,
    myArrowCount,
    hoverTarget,
    locatable,
    putOnStack,
    copyOntoStack,
    resolveStack,
    toggleReveal,
    moveToBattlefield,
    adjustPT,
    adjustAllCounters,
    openCounters,
    peekZone,
    sendReaction,
    toggleLayout,
    setTableMenu,
    setViewingBoardSeat,
    setArrowFrom,
    setShowShortcuts,
    setViewer,
    setScryFrom,
    setShowScry,
    setShowDice,
    setTokenCreator,
    setManaOpen,
    setShowLog,
    setSelected,
    setSelectMode,
    setClipboard,
  ]);
}
