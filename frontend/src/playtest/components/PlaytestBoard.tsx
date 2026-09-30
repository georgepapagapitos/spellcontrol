import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Crown,
  Eraser,
  Flag,
  Gavel,
  Keyboard,
  LayoutGrid,
  LogOut,
  Maximize2,
  Minimize2,
  Move,
  RotateCcw,
  Rows3,
  ScrollText,
  Settings,
  Undo2,
} from 'lucide-react';
import { useConfirm } from '@/components/overlays/use-confirm';
import { WedgeHintStrip } from '@/components/deck/WedgeHintStrip';
import { dismissPlaytestDragHint, shouldShowPlaytestDragHint } from '@/lib/home/wedge-hints';
import {
  DndContext,
  DragOverlay,
  getClientRect,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';
import type { Designation, PlaytestCard, PlaytestState, Zone } from '@/lib/playtest';
import { effectiveBracket, useDecksStore } from '@/store/decks';
import { effectiveMulliganType, usePlaytestStore } from '../store';

import { PHONE_QUERY, useNarrowViewport } from '../hooks/use-narrow-viewport';
import { applyTableSkin, readFelt, writeFelt } from '../lib/table-skin';
import { readSnap, readTurnAlert, writeSnap, writeTurnAlert } from '../lib/table-prefs';
import { useTurnAlert } from '../hooks/use-turn-alert';
import { useTurnSweep } from '../hooks/use-turn-sweep';
import { useTablePointer } from '../hooks/use-table-pointer';
import { useHoverTarget } from '../hooks/use-hover-target';
import { useTablePings } from '../hooks/use-table-pings';
import { TablePings } from './TablePings';
import { StackPanel } from './StackPanel';
import { isTypingTarget, useRegisterShortcuts } from '@/components/app-shell/shortcut-registry';
import { useOnlineTable } from '../hooks/use-online-table';
import { useOnlineHorde } from '../hooks/use-online-horde';
import { Button } from '@/components/shared/Button';
import { usePlayStore } from '@/store/play';
import { useTakeback } from '../hooks/use-takeback';
import { OpponentRail } from './OpponentRail';
import {
  OpenSeatQuadrant,
  OpponentQuadrant,
  MAX_GRID_OPPONENTS,
  TABLE_GRID_QUERY,
} from './OpponentQuadrant';
import { OpponentBoardModal } from './OpponentBoardModal';
import { TableMoments } from './TableMoments';
import { TableFinishedBanner } from './TableFinishedBanner';
import { TriggerReminder } from './TriggerReminder';
import { TableTicker, TableTickerDock, tickerSeatName } from './TableTicker';
import { TakebackModePicker } from './TakebackModePicker';
import { TakebackPendingBanner } from './TakebackPendingBanner';
import { TakebackConsentPrompt } from './TakebackConsentPrompt';
import { toast } from '@/store/toasts';
import { autoPlace } from '../lib/auto-place';
import { makePlaytestCollision } from '../lib/attach-drop';
import { clampGroupDelta } from '../lib/group-drag';
import { haptics } from '@/lib/util/haptics';
import { suppressNativeContextMenu } from '@/lib/play/suppress-context-menu';
import { cachedCardThumb } from '@/lib/cards/card-thumbs';
import { Battlefield } from './Battlefield';
import { Hand } from './Hand';
import { HandCardMenu } from './HandCardMenu';
import { CardHoverPreview } from './CardHoverPreview';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { ZoneViewerModal } from './ZoneViewerModal';
import { SEPARATOR, TableContextMenu, type MenuEntry } from './TableContextMenu';
import { LogDock } from './LogDock';
import { EndGameDialog } from '@/components/play/EndGameDialog';
import { useRulesReferenceStore } from '@/store/rules-reference';
import { GameMenuSheet, type GameMenuSection } from './GameMenuSheet';
import { cardsToBottom, GAME_PHASES, nextHostSeat } from '@/lib/play/game-state';
import {
  SHORTCUTS,
  formatChord,
  loadOverrides,
  resolveBindings,
  saveOverrides,
  shortcutFor,
  type ShortcutId,
  type ShortcutOverrides,
} from '../lib/shortcuts';
import { ShortcutsSheet } from './ShortcutsSheet';
import { TableSettingsSheet, type SettingLink, type SettingToggle } from './TableSettingsSheet';
import { TableArrows } from './TableArrows';
import { TAKEBACK_MODE_LABEL } from '../lib/takeback';
import { REACTION_EMOTES, REACTION_LABEL } from '../lib/table-signals';
import { CustomCountersDialog } from './CustomCountersDialog';
import { useDeckTokens } from '@/components/deck/use-deck-tokens';
import type { MadeToken } from './menu-entries';
import { MobileZonesPanel } from './MobileZonesPanel';
import { OpeningHandSheet } from './OpeningHandSheet';
import { RotatePrompt } from './RotatePrompt';
import { PlaytestCardFace } from './PlaytestCardFace';
import { ScrySheet } from './ScrySheet';
import { TokenCreator } from './TokenCreator';
import { DiceRoller } from './DiceRoller';
import { PlaytestStatsSheet } from './PlaytestStatsSheet';
import { PlaytestLogSheet } from './PlaytestLogSheet';
import { ResistanceBanner } from './ResistanceBanner';
import { ResistancePicker } from './ResistancePicker';
import { HordeHalf } from './horde/HordeHalf';
import { HordeBand } from './horde/HordeBand';
import { HordeSoloBanner } from './horde/HordeSoloBanner';
import { HordeActionsProvider } from './horde/horde-actions';
import { isHordeTurnDue } from '../lib/horde-solo';
import { hordeLevelLabel, hordeStatusText, measureHordeRect } from '../lib/horde-view';
import type { Rect } from '../lib/auto-place';
import { DesignationsPicker } from './DesignationsPicker';
import { RESISTANCE_LEVEL_ANNOUNCE, RESISTANCE_LEVEL_LABEL } from '../lib/resistance';
import { PlaytestSessionSummary } from './PlaytestSessionSummary';
import { resolveTokenArt } from '../lib/token-art';
import { taxCommanders, ZONE_VIEWER_LABEL } from '../lib/zones';
import { LifeStrip } from './LifeStrip';
import { ManaPool } from './ManaPool';
import { useCardZoom } from '../hooks/use-card-zoom';
import {
  applyDragEnd,
  measureBattlefield,
  measureBattlefieldRect,
  resolveActiveDrag,
  resolveDragGroup,
} from '../lib/board-drag';
import {
  FALLBACK_DROP_POS,
  FIXED_SHORTCUTS,
  MULLIGAN_TABLE_NOTE,
  NO_OPPONENTS,
  readHoldHintSeen,
  writeHoldHintSeen,
  ZERO_MANA_POOL,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  zoneOfCard,
  type ContextState,
  type HandMenuState,
  type ViewerMode,
} from '../lib/board-support';
import {
  buildCardLookup,
  buildOpponentPreviewNames,
  buildPreviewSrcs,
  deriveOnlineHorde,
} from './board/board-derive';
import { BoardCardContextMenu } from './board/BoardCardContextMenu';
import { BoardCardInfo } from './board/BoardCardInfo';
import { BoardHordeSheets } from './board/BoardHordeSheets';
import { PeekModal } from './board/PeekModal';
import { buildPileMenuItems } from './board/pile-menu-items';
import { TableCornerActions } from './board/TableCornerActions';
import { TablePiles } from './board/TablePiles';
import { useCardActions } from './board/use-card-actions';

interface Props {
  state: PlaytestState;
  /** The page's way back: the game menu's "Back to …" row and the opening
   *  hand's exit. The page has no header row of its own (E450), so this is
   *  the only one. Optional so PlaytestBoard's tests don't need to supply it. */
  backLabel?: string;
  onBack?(): void;
}

export function PlaytestBoard({ state, backLabel, onBack }: Props) {
  const dispatch = usePlaytestStore((s) => s.dispatch);
  const phase = usePlaytestStore((s) => s.phase);
  const mulliganCount = usePlaytestStore((s) => s.mulliganCount);
  const keepOpeningHand = usePlaytestStore((s) => s.keepOpeningHand);
  const mulliganOpeningHand = usePlaytestStore((s) => s.mulliganOpeningHand);
  const finalizeBottom = usePlaytestStore((s) => s.finalizeBottom);
  const freeMulligan = usePlaytestStore((s) => s.freeMulligan);
  const setFreeMulligan = usePlaytestStore((s) => s.setFreeMulligan);
  const tableMulliganType = usePlaytestStore((s) => s.tableMulliganType);
  const setTableMulliganType = usePlaytestStore((s) => s.setTableMulliganType);
  const onDraw = usePlaytestStore((s) => s.onDraw);
  const setOnDraw = usePlaytestStore((s) => s.setOnDraw);
  const resistanceLevel = usePlaytestStore((s) => s.resistanceLevel);
  const setResistanceLevel = usePlaytestStore((s) => s.setResistanceLevel);
  const resistanceOptions = usePlaytestStore((s) => s.resistanceOptions);
  const setResistanceOptions = usePlaytestStore((s) => s.setResistanceOptions);
  const lastResistanceEvent = usePlaytestStore((s) => s.lastResistanceEvent);
  const lastSessionRecord = usePlaytestStore((s) => s.lastSessionRecord);
  // Solo Horde (E387 PR 5) — see lib/horde-solo.ts and horde-view.ts. Never
  // exists at an online table (gated at every render site below), so these
  // reads cost nothing there beyond the subscription itself.
  const horde = usePlaytestStore((s) => s.horde);
  const hordeLoad = usePlaytestStore((s) => s.hordeLoad);
  const disarmHorde = usePlaytestStore((s) => s.disarmHorde);
  const startHordeTurn = usePlaytestStore((s) => s.startHordeTurn);
  const confirmHordeReveal = usePlaytestStore((s) => s.confirmHordeReveal);
  const [showHordeSetup, setShowHordeSetup] = useState(false);
  // The card menu and damage sheet ONLY ever render here, never inside
  // `HordeHalf`/`HordeBand` — see `HordeOverlays`'s own doc comment for why
  // (a `filter` on the half's container quietly trapped their fixed-position
  // overlay to the felt's own box).
  const [hordeCardMenuId, setHordeCardMenuId] = useState<string | null>(null);
  const [hordeDamageOpen, setHordeDamageOpen] = useState(false);
  const hordeFeltRef = useRef<HTMLDivElement>(null);
  // Visible whenever there is a fight to show OR one is mid (re-)load — the
  // Reset "Play again" path re-arms the same settings, and the half/band
  // must show a loading line rather than blink away and back (design point 9).
  const hordeVisible = horde !== null || hordeLoad.status !== 'idle';
  const gameLog = usePlaytestStore((s) => s.gameLog);
  const playtestDeckId = usePlaytestStore((s) => s.deckId);
  // A shared or public deck is NOT in the viewer's decks store — it is
  // adapted per page and handed to the session, which parks it on the
  // playtest store as `externalDeck`. Looking only in the decks store is how
  // the board silently lost the deck on every `/d/:slug/playtest` and
  // `/s/:token/playtest` visit: the hand's card previews and the token
  // picker's "Deck tokens" grid both went empty with no error to show for
  // it. External wins, because when it exists it IS the deck being played.
  const externalDeck = usePlaytestStore((s) => s.externalDeck);
  const ownDeck = useDecksStore((s) =>
    playtestDeckId ? s.decks.find((d) => d.id === playtestDeckId) : undefined
  );
  const deck = externalDeck ?? ownDeck;
  const navigate = useNavigate();

  // Build a map from each PlaytestCard instance id back to the underlying
  // ScryfallCard, so the OpeningHandSheet can pass full card data to the
  // shared CardPreview component without changing reducer types. The keys
  // mirror what `deckToPlaytestInit` produces (slotId#copy for mainboard,
  // cmd-<scryfallId> for commanders, sb-<slotId> for the sideboard).
  // The commanders the coins above the command zone track, gold then silver
  // in the deck's own order (see `taxCommanders`).
  const taxCards = useMemo(
    () =>
      taxCommanders(
        state,
        [deck?.commander?.id, deck?.partnerCommander?.id].flatMap((id) => (id ? [`cmd-${id}`] : []))
      ),
    [state, deck?.commander?.id, deck?.partnerCommander?.id]
  );

  const cardLookup = useMemo(() => buildCardLookup(deck), [deck]);

  // Fed to `findBannedCards` by the horde setup sheet — this deck's own
  // ban-list warnings (E387 PR 5).
  const hordeDeckCardNames = useMemo(() => deck?.cards.map((c) => c.card.name) ?? [], [deck]);

  const { confirm, dialog: confirmDialog } = useConfirm();

  const battlefieldRef = useRef<HTMLDivElement | null>(null);
  const [viewer, setViewer] = useState<ViewerMode>(null);
  const [ctx, setCtx] = useState<ContextState>(null);
  /** The card whose Custom counters dialog is open. */
  const [countersFor, setCountersFor] = useState<string | null>(null);
  const [handMenu, setHandMenu] = useState<HandMenuState>(null);
  // "View information" on a battlefield permanent or a card in hand — one
  // card, read in a centered dialog (`CardInfoDialog`). Browsing a whole zone
  // is still the shared `CardPreview` carousel (OpeningHandSheet /
  // ZoneViewerModal); a single card is not a carousel.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  /** The hand card a finger tapped, enlarged in the hover slot. */
  const [tappedPreviewId, setTappedPreviewId] = useState<string | null>(null);
  // Until a card menu has been opened on this device, a tapped card says a
  // hold opens it (the tap that used to is the preview now). Per device, like
  // card size: the gesture is the device's, not the account's.
  const [holdHintSeen, setHoldHintSeen] = useState(readHoldHintSeen);
  const retireHoldHint = useCallback(() => {
    setHoldHintSeen(true);
    writeHoldHintSeen();
  }, []);
  // Drag-to-play discovery hint (E484, see lib/home/wedge-hints.ts) — dismissed
  // locally too, same reasoning as the binder hint in CardSearchPanel: the
  // strip disappears on click without waiting on a re-render, and
  // dismissPlaytestDragHint()'s localStorage write makes "never again" durable.
  const [dragHintDismissed, setDragHintDismissed] = useState(false);
  const retireDragHint = useCallback(() => {
    setDragHintDismissed(true);
    dismissPlaytestDragHint();
  }, []);
  const [tokenCreator, setTokenCreator] = useState(false);
  const [showScry, setShowScry] = useState(false);
  // Which end of the library the scry sheet is looking at (P vs Shift+P).
  const [scryFrom, setScryFrom] = useState<'top' | 'bottom'>('top');
  // A single card off one end of the library, looked at without moving it —
  // the "is my top card a land" check that a whole scry sheet is too much
  // ceremony for. Holds the card itself, not an index, so the panel can't
  // end up showing a different card than the one that was peeked.
  const [peek, setPeek] = useState<{
    card: PlaytestCard;
    where: 'top' | 'bottom' | 'random';
    zone: Zone;
  } | null>(null);
  const [showStats, setShowStats] = useState(false);
  // The corner hamburger's drawer, and the host-only winner picker it opens.
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [endingTable, setEndingTable] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // Whether the log was opened from the table feed's button, which lands it
  // on the Table view rather than the last chip picked.
  const [logOnTable, setLogOnTable] = useState(false);
  // Highest resistance-entry seq seen so far — drives the ActionBar's unread
  // dot; not persisted, a soft nice-to-have that resets on remount.
  const [lastSeenLogSeq, setLastSeenLogSeq] = useState(0);
  const [showDice, setShowDice] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Seat layout: `auto` is the breakpoint's own answer (grid at the widest
  // tier, rail below it). Choosing one pins it until it is switched back —
  // a player who wants every seat equal at 1280px, or their own board big
  // at 1600px, should be able to say so.
  const [layoutPref, setLayoutPref] = useState<'auto' | 'grid' | 'rail'>('auto');
  const [showTableSettings, setShowTableSettings] = useState(false);
  const isNarrow = useNarrowViewport();
  // Card size: a multiplier on the tier's card box (density-driven at the
  // desk, thumb-sized below 1024px), persisted per device and applied on
  // <body> (where `--pt-card-w` lives so the drag overlay inherits it). 1 is
  // the size the tier computes.
  const { zoom, stepZoom, setZoomTo } = useCardZoom(battlefieldRef, isNarrow);
  // Rebindable keys, persisted per device (lib/shortcuts). Every place that
  // prints a key — the corner buttons, the table menu, the sheet — reads the
  // same table, so a rebound key never lies on screen.
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>(() =>
    loadOverrides()
  );
  const bindings = useMemo(() => resolveBindings(shortcutOverrides), [shortcutOverrides]);
  const keyFor = (id: ShortcutId) => (bindings[id] ? formatChord(bindings[id]) : undefined);
  const changeShortcuts = useCallback((next: ShortcutOverrides) => {
    setShortcutOverrides(next);
    saveOverrides(next);
  }, []);
  // Fullscreen is the browser's state, not ours; mirror it for the menu label.
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null
  );
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const [showResistancePicker, setShowResistancePicker] = useState(false);
  const [showDesignations, setShowDesignations] = useState(false);
  const [showTakebackSettings, setShowTakebackSettings] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Battlefield selection + copy buffer (E226). Deliberately UI state, not
  // reducer state: selecting a card isn't a game action and must never land
  // on the 50-deep undo stack.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // Touch has no shift/⌘ modifier, so building a selection was desktop-only.
  // Select mode makes a plain tap toggle selection instead of tapping the
  // card — same selection state, reached without a keyboard.
  const [selectMode, setSelectMode] = useState(false);
  const [clipboard, setClipboard] = useState<readonly string[]>([]);
  const [lifePanelOpen, setLifePanelOpen] = useState(false);
  // Table-tier chrome: the right-click menu on bare felt, and the mana
  // tracker's collapsed-when-empty state (M, or the "Mana" chip).
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);
  // Which zone pile's menu is open, and where. Same menu component the felt
  // uses; the pile just supplies its own title and its own items.
  const [pileMenu, setPileMenu] = useState<{
    zone: Zone;
    x: number;
    y: number;
    /** Set when a button opened it rather than a pointer (the Hand button). */
    origin?: 'bottom-end';
  } | null>(null);
  const [manaOpen, setManaOpen] = useState(false);
  // "View board" from an online opponent's LifeStrip panel — opens the same
  // full-board inspector OpponentRail's own tap-to-open already uses.
  const [viewingBoardSeat, setViewingBoardSeat] = useState<number | null>(null);
  // Banner dismissal is tracked by event id so a new opponent response (even
  // with an identical message) re-shows and re-announces the banner.
  const [dismissedResistanceId, setDismissedResistanceId] = useState<number | null>(null);
  // Session-summary dismissal (E141) tracked by record id, same pattern as
  // the resistance banner above — a new record (even an identical-looking
  // one from a later game) re-shows.
  const [dismissedSessionRecordId, setDismissedSessionRecordId] = useState<string | null>(null);
  /* A phone, specifically. `isNarrow` is the tier boundary the CSS uses for
     sizing (≤1023px covers a tablet too); this one answers the narrower
     question of whether four card-width piles fit along the bottom beside
     the hand. On a tablet they do. A phone on its side is wider than the
     phone line, so this asks about its height too. */
  const isPhone = useMediaQuery(PHONE_QUERY);
  // How this device's table looks (E347): a per-device preference, like card
  // size — it never leaves the device and nothing about it is published.
  const [felt, setFelt] = useState(readFelt);
  useEffect(() => applyTableSkin(felt), [felt]);
  const [snap, setSnap] = useState(readSnap);
  const [turnAlert, setTurnAlert] = useState(readTurnAlert);
  // The conditional multiplayer seam (see use-online-table.ts): non-null only
  // when there's an active online game AND this device holds a seat in it.
  // Publishes `state` internally; solo playtest never touches it beyond this
  // one hook call, and null here means the rail below never renders.
  const onlineTable = useOnlineTable(state);
  // The horde felt's live box, for `useOnlineHorde`'s `autoPlace` calls —
  // measured on mount and on resize/layout-mode changes (isNarrow swaps
  // which component owns `hordeFeltRef`), never on every render.
  const [onlineHordeRect, setOnlineHordeRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!onlineTable) return;
    const measure = () =>
      setOnlineHordeRect(hordeFeltRef.current ? measureHordeRect(hordeFeltRef.current) : null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [onlineTable, isNarrow]);
  // A horde at an online table (E387 online co-op, lane F2): replays the
  // table's horde log and adds the team-turn surface. Non-null exactly when
  // this seat's game is a horde game — every render site below gates on it
  // the same way solo Horde gates on `horde !== null`.
  const onlineHorde = useOnlineHorde(onlineTable, onlineHordeRect);
  const isOnlineHordeTable = onlineHorde !== null;
  useTurnAlert(onlineTable !== null && onlineTable.activeSeat === onlineTable.mySeat, turnAlert);
  // A finished table can never resolve a wait that depends on the rest of
  // the table doing something (E351 follow-up) — see `openingOnline` below,
  // the one place that wait lives.
  const tableFinished = usePlayStore((s) => s.online?.status === 'finished');
  // A Horde table the host has sent back to the lobby (Rematch) is set up in
  // the lobby, not on the board: both the host and every survivor go there,
  // the way a table that hasn't started never shows the board at all.
  const hordeTableBackInLobby = usePlayStore(
    (s) => s.online?.format === 'horde' && s.online.status === 'lobby'
  );
  useEffect(() => {
    if (onlineTable && hordeTableBackInLobby) navigate('/play/online');
  }, [onlineTable, hordeTableBackInLobby, navigate]);
  // The card a per-card shortcut acts on when nothing is selected — see
  // hooks/use-hover-target. A ref, not state: it changes on every card the
  // pointer crosses and is only ever read inside a keydown.
  const hoverTarget = useHoverTarget();

  // Arrows: a point that stays. W with one card selected starts one from it;
  // the next card tapped — yours, a quadrant's, or one in an opponent's
  // inspector — is where it lands. Everyone at the table sees it until its
  // author clears theirs (Shift+W, or the game menu). Online only: an arrow
  // with nobody to see it is a note to yourself, and the log already is one.
  const sendSignal = usePlayStore((s) => s.sendSignal);
  const onlineArrows = usePlayStore((s) => s.onlineArrows);
  const [arrowFrom, setArrowFrom] = useState<{ seat: number; cardId: string } | null>(null);
  const beginArrow = useCallback(
    (cardIds: ReadonlySet<string>) => {
      if (!onlineTable) return false;
      if (cardIds.size !== 1) {
        toast.show({ message: 'Select the one card the arrow starts from, then press W.' });
        return;
      }
      setArrowFrom({ seat: onlineTable.mySeat, cardId: [...cardIds][0] });
      haptics.tap();
    },
    [onlineTable]
  );
  const finishArrow = useCallback(
    (toSeat: number, toCardId?: string) => {
      if (!arrowFrom) return;
      void sendSignal({
        kind: 'arrow',
        op: 'add',
        fromSeat: arrowFrom.seat,
        fromCardId: arrowFrom.cardId,
        toSeat,
        ...(toCardId !== undefined && { toCardId }),
      });
      setArrowFrom(null);
      haptics.tap();
    },
    [arrowFrom, sendSignal]
  );
  const clearMyArrows = useCallback(() => {
    if (!onlineTable) return false;
    void sendSignal({ kind: 'arrow', op: 'clear' });
    setArrowFrom(null);
  }, [onlineTable, sendSignal]);
  const myArrowCount = onlineTable
    ? onlineArrows.filter((a) => a.seat === onlineTable.mySeat).length
    : 0;
  // Pings: tapping a card rings it, on every screen at the table, in the
  // colour of the seat that tapped it. The lightest way to say "this one"
  // — no ticker line, no state, gone in a second. Solo still rings locally
  // (`send` null), because the ring is also the feedback that a tap landed.
  const sendPing = useMemo(() => {
    if (!onlineTable) return null;
    const seat = onlineTable.mySeat;
    return (cardId: string) => {
      void sendSignal({ kind: 'ping', targetSeat: seat, cardId });
    };
  }, [onlineTable, sendSignal]);
  const { pings, ping } = useTablePings(onlineTable?.mySeat ?? null, sendPing);

  const takeback = useTakeback(onlineTable);
  // Desktop seat grid (STYLE_GUIDE "Desktop table with opponents: 2x2, not a
  // rail"): at 1024px and up (the same "table chrome" floor `isNarrow` already
  // draws), an online table with opponents lays every seat out as an equal
  // quadrant instead of a board plus a rail — an opponent's battlefield is the
  // point of the table, and it stays a real board at any width that tier can
  // physically hold it at. Capped at three opponents — a 2x2 grid holds four
  // seats, and a fifth would have to hide one, which the rail exists precisely
  // never to do. Below 1024, on phones, and at a five-seat pod, the rail is
  // still the answer.
  const wideTable = useMediaQuery(TABLE_GRID_QUERY);
  const opponents = onlineTable?.opponents ?? NO_OPPONENTS;
  // A five-seat pod and the narrow tiers are still rail-only whatever the
  // preference says: the grid physically holds four seats, and forcing it
  // would hide one — which is the thing the rail exists never to do.
  // A horde table's teammates always sit in the rail (STYLE_GUIDE "Horde at
  // an online table"): the horde itself takes the grid's "opponent" role, so
  // there is no second board worth a quadrant, and the toggle degrades to
  // the same "This table only fits the rail." toast a 5-seat pod gets.
  const gridFits =
    !isOnlineHordeTable &&
    !isNarrow &&
    opponents.length > 0 &&
    opponents.length <= MAX_GRID_OPPONENTS;
  const gridMode = gridFits && (layoutPref === 'auto' ? wideTable : layoutPref === 'grid');
  const toggleLayout = useCallback(() => {
    if (!gridFits) {
      toast.show({ message: 'This table only fits the rail.', tone: 'info' });
      return;
    }
    setLayoutPref(gridMode ? 'rail' : 'grid');
    haptics.tap();
  }, [gridFits, gridMode]);
  // Both signals the rail carries today, lit on the quadrant instead.
  const sweepSeat = useTurnSweep(onlineTable?.activeSeat ?? undefined);
  const tablePointer = useTablePointer();
  // The merged play-ticker feed, for the Log sheet's Table tab. Costs no
  // extra renders in practice: ticker lines ride the same board frames the
  // `useOnlineTable` subscription above already re-renders on.
  const onlineTicker = usePlayStore((s) => s.onlineTicker);

  // The card currently under the pointer, resolved to its data + display
  // size, so the top-level <DragOverlay> can render a moving copy that
  // escapes the origin container's `overflow` clipping.
  const activeDrag = useMemo(
    () => resolveActiveDrag(state.battlefield, state.zones, state.libraryReveal, activeId),
    [activeId, state.battlefield, state.zones, state.libraryReveal]
  );

  // A battlefield drag that carries more than the card under the pointer
  // (see `resolveDragGroup`); null whenever the drag moves one card.
  const dragGroup = useMemo(
    () => resolveDragGroup(state.battlefield, activeId, selected),
    [activeId, state.battlefield, selected]
  );

  // Measure drag sources and drop targets with the box the browser actually
  // paints. dnd-kit's default is "transform-agnostic": it reads the element's
  // own `transform` and inverts it, so a card dnd-kit itself has translated
  // still measures where it started. That routine understands translate and
  // scale only — it reads a rotation matrix's `a`/`d` as scaleX/scaleY, and
  // for `rotate(90deg)` both are 0, so the box it hands back is half a card
  // up and to the left of the real one. A TAPPED permanent wears exactly that
  // rotation: its drag copy jumped off the card as you picked it up, and the
  // attach-drop target sat beside the creature rather than on it. Nothing
  // here needs the inversion — the source card is never translated (the
  // moving copy is a top-level <DragOverlay>), and the hand's fan rotation
  // lives on the slot wrapper rather than the card, so this changes the
  // measurement of tapped permanents and nothing else.
  const measuring = useMemo(
    () => ({ draggable: { measure: getClientRect }, droppable: { measure: getClientRect } }),
    []
  );

  // Any card the pointer could be dragging — battlefield or hand — by id,
  // so the collision function can tell an Aura from a creature.
  const collisionDetection = useMemo(
    () =>
      makePlaytestCollision((id) => {
        const bf = state.battlefield.find((b) => b.card.id === id);
        if (bf) return bf.card;
        const from = zoneOfCard(state.zones, id);
        return from ? state.zones[from].find((c) => c.id === id) : undefined;
      }),
    [state.battlefield, state.zones]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    // Picking a card up is done reading it: the preview must not come back
    // over the table once it lands.
    setTappedPreviewId(null);
  }

  /** Mid-drag, the cards riding along with the grabbed one follow the pointer
   *  through one custom property pair on the felt rather than through React
   *  state: every rider shares the same delta, and a `setState` per pointer
   *  move would re-render the whole board (the marquee avoids it the same
   *  way). Written here, read by `.playtest-card-slot.is-riding`. */
  function handleDragMove(event: DragMoveEvent) {
    const el = battlefieldRef.current;
    if (!el || !dragGroup) return;
    const { width, height, cardW, cardH } = getBattlefieldGeometry();
    const spanX = Math.max(1, width - cardW);
    const spanY = Math.max(1, height - cardH);
    const { dx, dy } = clampGroupDelta(
      dragGroup.cards,
      event.delta.x / spanX,
      event.delta.y / spanY
    );
    el.style.setProperty('--pt-ride-x', `${dx * spanX}px`);
    el.style.setProperty('--pt-ride-y', `${dy * spanY}px`);
  }

  function clearRideOffset() {
    const el = battlefieldRef.current;
    el?.style.removeProperty('--pt-ride-x');
    el?.style.removeProperty('--pt-ride-y');
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    clearRideOffset();
    applyDragEnd(event, { state, dispatch, selected, snap, getBattlefieldGeometry });
  }

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

  /**
   * Token-copy `sourceIds`, minting each clone's instance id here so the
   * reducer stays pure. The clipboard then re-points at the clones it just
   * made, which is what makes repeated pastes cascade across the battlefield
   * instead of restacking on the same spot.
   */
  const cloneCards = useCallback(
    (sourceIds: readonly string[]) => {
      if (sourceIds.length === 0) return;
      // Same id shape as TokenCreator's: wall-clock + entropy, so an id can't
      // collide with one already in a resumed snapshot.
      const batch = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const clones = sourceIds.map((sourceId, i) => ({ sourceId, id: `copy-${batch}-${i}` }));
      dispatch({ type: 'CLONE_BF_CARDS', clones });
      haptics.tap();
      return clones.map((c) => c.id);
    },
    [dispatch]
  );

  const handleCardContext = useCallback((cardId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setCtx({ cardId, x: e.clientX, y: e.clientY });
  }, []);

  const handleCardLongPress = useCallback(
    (cardId: string, x: number, y: number) => {
      setCtx({ cardId, x, y });
      retireHoldHint();
    },
    [retireHoldHint]
  );

  const openTableMenu = useCallback((x: number, y: number) => setTableMenu({ x, y }), []);

  const getBattlefieldGeometry = () => measureBattlefield(battlefieldRef.current);
  const getBattlefieldRect = () => measureBattlefieldRect(battlefieldRef.current);

  function placeOnBattlefield(card: PlaytestCard) {
    return autoPlace(card, state.battlefield, getBattlefieldRect());
  }

  function playFromHand(cardId: string, opts?: { tapped?: boolean; faceDown?: boolean }) {
    const handCard = state.zones.hand.find((c) => c.id === cardId);
    if (!handCard) return;
    // A face-down permanent is a 2/2 creature (morph, manifest) whatever its
    // printed type — it belongs in the creature row.
    const { x, y } = placeOnBattlefield(
      opts?.faceDown ? { ...handCard, typeLine: 'Creature' } : handCard
    );
    dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x, y, ...opts });
  }

  // Image per card instance for the hover preview — the DOM carries only ids.
  // A two-faced card previews BOTH faces, the one showing first — EDHPlay's
  // hover shows the pair, and the face you are not looking at is exactly
  // the one you cannot read off the table.
  const previewSrcs = useMemo(
    () => buildPreviewSrcs(state.battlefield, state.zones.hand, state.zones.command),
    [state.battlefield, state.zones.hand, state.zones.command]
  );
  // The opponents' permanents, by the seat-scoped id their quadrant publishes
  // as `data-preview-id`. Names, not URLs: `PublicBoard` never carries image
  // URLs (projection.ts), so the quadrant resolves art through the shared CDN
  // cache and this reads the same cache back. Safe to read synchronously
  // because `resolve` runs at POINTER time, long after the card painted.
  const opponentPreviewNames = useMemo(() => buildOpponentPreviewNames(opponents), [opponents]);
  const resolvePreview = useCallback(
    (cardId: string) => {
      const opponentCard = opponentPreviewNames.get(cardId);
      if (opponentCard) {
        const src = cachedCardThumb(opponentCard.name, 'normal');
        return src
          ? { src, counters: opponentCard.counters, pt: opponentCard.pt ?? undefined }
          : null;
      }
      return previewSrcs.get(cardId) ?? null;
    },
    [opponentPreviewNames, previewSrcs]
  );

  const handleHandCardMenu = useCallback(
    (cardId: string, x: number, y: number) => {
      setTappedPreviewId(null);
      setHandMenu({ cardId, x, y });
      retireHoldHint();
    },
    [retireHoldHint]
  );
  // A tap enlarges the card; the same card again puts it away. A card with no
  // art to enlarge would make the tap do nothing, so it opens the menu.
  const handleHandCardPreview = useCallback(
    (cardId: string, x: number, y: number) => {
      if (!resolvePreview(cardId)) return handleHandCardMenu(cardId, x, y);
      setTappedPreviewId((prev) => (prev === cardId ? null : cardId));
    },
    [resolvePreview, handleHandCardMenu]
  );
  const unpinPreview = useCallback(() => setTappedPreviewId(null), []);
  const handMenuZone = handMenu?.zone ?? 'hand';
  const handMenuCard = handMenu
    ? state.zones[handMenuZone].find((c) => c.id === handMenu.cardId)
    : null;
  // Playing with the hand revealed marks every card, the same way the
  // projection shows every card.
  const revealedIds = useMemo(
    () => new Set(state.handRevealed ? state.zones.hand.map((c) => c.id) : (state.revealed ?? [])),
    [state.handRevealed, state.zones.hand, state.revealed]
  );
  // Every card of the deck behind this session, for the token picker's
  // "Deck tokens" grid. Commanders included — a commander is as likely to
  // be the thing making tokens as anything in the ninety-nine. The sideboard
  // too, so a card fetched into the game has its Create token row.
  const deckTokenSources = useMemo(() => {
    if (!deck) return [];
    const out = deck.cards.map((slot) => slot.card);
    if (deck.commander) out.push(deck.commander);
    if (deck.partnerCommander) out.push(deck.partnerCommander);
    for (const slot of deck.sideboard ?? []) out.push(slot.card);
    return out;
  }, [deck]);
  // Which tokens each card makes, for the card menus' Create token submenu —
  // the same Scryfall relationships the token picker's "Deck tokens" grid
  // reads, resolved once for the deck.
  const deckTokens = useDeckTokens(deckTokenSources);
  const tokensMadeBy = useCallback(
    (name: string): MadeToken[] =>
      deckTokens
        .filter((t) => t.producers.includes(name))
        .map((t) => (t.typeLine ? { name: t.name, typeLine: t.typeLine } : { name: t.name })),
    [deckTokens]
  );
  const stackIdSet = useMemo(() => new Set(state.stack ?? []), [state.stack]);

  // Gone from the battlefield (moved, or taken back) closes the dialog with it.
  const countersBf = countersFor
    ? state.battlefield.find((b) => b.card.id === countersFor)
    : undefined;
  const anySheetOpen =
    phase !== 'playing' ||
    viewer !== null ||
    ctx !== null ||
    handMenu !== null ||
    tokenCreator ||
    showScry ||
    showStats ||
    // The docked log (table tier) is deliberately NOT here: it is non-modal
    // chrome, so shortcuts and the hover preview keep working beside it. The
    // narrow tier's log is a real sheet and still counts.
    (showLog && isNarrow) ||
    tableMenu !== null ||
    pileMenu !== null ||
    showDice ||
    peek !== null ||
    showShortcuts ||
    showGameMenu ||
    endingTable ||
    showTableSettings ||
    showResistancePicker ||
    showDesignations ||
    countersFor !== null ||
    showTakebackSettings ||
    lifePanelOpen ||
    Boolean(confirmDialog);

  // Shared feedback path for the takeback control — same handler behind the
  // ActionBar button click and the Z shortcut, so both give identical
  // "before they reach for it" answers (off / nothing yet / the wall's
  // reason) instead of the keyboard path silently doing nothing. useCallback
  // so the keydown effect below (which calls it) has a stable dependency.
  const handleTakebackClick = useCallback(() => {
    if (takeback.pendingRequest?.status === 'pending') return; // Cancel lives on the pending banner
    if (takeback.mode === 'off') {
      toast.show({ message: 'Takebacks are off for this game.', tone: 'info' });
      return;
    }
    if (takeback.verdict === 'none') {
      toast.show({ message: 'Nothing to take back yet.', tone: 'info' });
      return;
    }
    if (takeback.verdict === 'locked') {
      toast.show({
        message: takeback.boundaryReason ?? "That can't be taken back.",
        tone: 'info',
      });
      return;
    }
    const result = takeback.attempt();
    if (result === 'request') {
      toast.show({
        message: `Asked the table to take back: ${takeback.nextSummary ?? 'a play'}`,
        tone: 'info',
      });
    }
  }, [takeback]);

  // A request failing to raise (network, a race with the server's 409) is
  // the one takeback outcome the hook can't resolve into UI state on its
  // own — surface it once and clear it so it doesn't repeat on re-render.
  useEffect(() => {
    if (!takeback.raiseError) return;
    toast.show({ message: takeback.raiseError, tone: 'warn' });
    takeback.clearRaiseError();
  }, [takeback]);

  const hasUnreadLog = gameLog.some((e) => e.kind === 'resistance' && e.seq > lastSeenLogSeq);
  const handleOpenLog = useCallback(() => {
    setLastSeenLogSeq(gameLog.at(-1)?.seq ?? 0);
    setLogOnTable(false);
    setShowLog(true);
  }, [gameLog]);
  // The table feed's button (online, table tier): opens the same log dock on
  // its Table view, or closes it if it is open, however it was opened.
  const toggleTableLog = () => {
    if (showLog) {
      setShowLog(false);
      return;
    }
    setLastSeenLogSeq(gameLog.at(-1)?.seq ?? 0);
    setLogOnTable(true);
    setShowLog(true);
  };

  // ── Shared board actions ────────────────────────────────────────────────
  // One implementation behind each of the three ways to reach it: the table
  // menu's item, the corner cluster's button, and the key binding. A control
  // that only exists in one of those is how the old bar's actions went
  // unreachable when the bar stopped rendering.
  const activeName = onlineTable?.players.find((p) => p.seat === onlineTable.activeSeat)?.name;
  const myTurn = onlineTable !== null && onlineTable.activeSeat === onlineTable.mySeat;
  const canPassTurn = onlineTable !== null && (myTurn || onlineTable.activeSeat === null);
  // Solo Horde (E387 PR 5): while the horde is mid-turn (its reveal or its
  // attack), the chip is not pressable — same degrade as "somebody else's
  // turn" online.
  const hordeBlocksTurn = horde !== null && (horde.phase === 'reveal' || horde.phase === 'combat');
  /** Is there a turn to move on at all? Always, solo — there is nobody to
   *  wait for. */
  const canAdvanceTurn = (onlineTable === null || canPassTurn) && !hordeBlocksTurn;

  // A horde at an online table (E387 online co-op): 'setup' and 'survivors'
  // read as one "team's turn" phase everywhere the chip/half/band/rail wording
  // groups them (STYLE_GUIDE "Horde at an online table") — 'reveal'/'combat'
  // are the horde's own turn, and 'ended' overrides all of it once the
  // replay has an outcome.
  const {
    onlineHordePhase,
    onlineHordeStatusText,
    onlineHordeBandStatusText,
    onlineHordeLoadView,
    onlineHordeBlocked,
    onlineHordeExtraAction,
    onlineHordeView,
    onlineHordeOutcome,
    onlineHordePendingReveal,
  } = deriveOnlineHorde(onlineHorde);
  // The online horde's actions (lane F1's `useOnlineHorde`) route through
  // the server instead of the solo playtest store. Only the horde's own
  // mounts are wrapped, so the rest of the board is untouched.
  const withHordeActions = (node: ReactNode) => (
    <HordeActionsProvider value={onlineHorde?.actions ?? null}>{node}</HordeActionsProvider>
  );

  const libraryCount = state.zones.library.length;
  const libraryReveal = state.libraryReveal ?? 'none';
  // Exile's face-down cards, as a set for the viewer's per-card badge.
  const faceDownExile = useMemo(() => new Set(state.faceDownExile ?? []), [state.faceDownExile]);
  const doDraw = useCallback(() => {
    if (libraryCount === 0) return;
    haptics.tap();
    dispatch({ type: 'DRAW', n: 1 });
  }, [dispatch, libraryCount]);
  // The table's mulligan rule is the pod's, so it lives in the store for the
  // whole session rather than being read at the one call site — the store is
  // what decides whether a kept hand owes the bottom anything.
  const onlineMulliganType = onlineTable?.mulliganType ?? null;
  useEffect(() => {
    setTableMulliganType(onlineMulliganType);
  }, [onlineMulliganType, setTableMulliganType]);

  const doNextTurn = useCallback(() => dispatch({ type: 'NEXT_TURN' }), [dispatch]);
  // Passing your turn while the horde is due opens its reveal instead of
  // advancing (design decision: "the horde's turn starts when you pass
  // yours"). The turn chip, the Space/next-turn shortcut and the table
  // menu's "Next turn" row all route through this one function.
  const doNextTurnHordeAware = useCallback(() => {
    if (horde && isHordeTurnDue(horde, state.turn)) {
      startHordeTurn(hordeFeltRef.current ? measureHordeRect(hordeFeltRef.current) : null);
      return;
    }
    doNextTurn();
  }, [horde, state.turn, startHordeTurn, doNextTurn]);
  const doUntapAll = useCallback(() => dispatch({ type: 'UNTAP_ALL' }), [dispatch]);
  const doPassTurn = useCallback(() => {
    if (!onlineTable) return;
    haptics.tap();
    onlineTable.dispatch({ type: 'pass-turn', actorSeat: onlineTable.mySeat });
  }, [onlineTable]);
  const doReset = useCallback(async () => {
    const ok = await confirm({
      title: 'Start a new game?',
      body: 'This clears undo history and returns all cards to the starting state.',
      confirmLabel: 'Start a new game',
      danger: true,
    });
    if (ok) dispatch({ type: 'RESET' });
  }, [confirm, dispatch]);
  const concedeOnline = useCallback(async () => {
    if (!onlineTable) return;
    const ok = await confirm({
      title: 'Concede this game?',
      body: 'Your seat is marked out for everyone at the table. The game goes on without you.',
      confirmLabel: 'Concede',
      danger: true,
    });
    if (ok) {
      onlineTable.dispatch({ type: 'eliminate', seat: onlineTable.mySeat, eliminated: true });
    }
  }, [confirm, onlineTable]);
  const openRules = useRulesReferenceStore((s) => s.open);
  const leaveOnline = usePlayStore((s) => s.leaveOnline);
  const leaveTable = useCallback(async () => {
    if (!onlineTable) return;
    // A host hands the table on (E430, the server's rule); only a table
    // with nobody left to take it ends for everyone.
    const game = usePlayStore.getState().online;
    const heirSeat = game && onlineTable.isHost ? nextHostSeat(game) : null;
    const heir = heirSeat === null ? null : game?.players.find((p) => p.seat === heirSeat);
    const ok = await confirm({
      title: 'Leave the table?',
      body: !onlineTable.isHost
        ? 'You give up your seat.'
        : heir
          ? `You give up your seat, and ${heir.name} becomes host.`
          : 'You give up your seat, and the table ends for everyone.',
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok) return;
    await leaveOnline();
    navigate('/play');
  }, [confirm, onlineTable, leaveOnline, navigate]);
  // Life, at the table's own counter when seated online (the local playtest
  // life is a stand-in there — see LifeStrip's online mode).
  const adjustMyLife = useCallback(
    (delta: number) => {
      haptics.tap();
      if (onlineTable) {
        onlineTable.dispatch({
          type: 'life',
          seat: onlineTable.mySeat,
          delta,
          actorSeat: onlineTable.mySeat,
        });
      } else {
        dispatch({ type: 'ADJUST_LIFE', delta });
      }
    },
    [dispatch, onlineTable]
  );
  /**
   * Move the game on: pass the turn at a table, take the next turn solo.
   *
   * One action rather than two, because it is one intent — and because
   * Space was wired to pass-turn ALONE, which made the biggest key on the
   * keyboard do nothing at all in the mode most goldfishing happens in. A
   * key that is dead in the common case is worse than an unbound one: it
   * teaches the player it is broken.
   *
   * Returns false when there is genuinely nothing to do (somebody else's
   * turn at a table), so the keydown handler leaves the key to the browser
   * rather than swallowing it.
   */
  const advanceTurn = useCallback(() => {
    // A horde table has no individual turn to pass — Space (and the chip it
    // drives) toggles this seat's own "done with the team turn" instead.
    if (onlineHorde) {
      onlineHorde.markDone(!onlineHorde.team.iAmDone);
      return true;
    }
    if (onlineTable) {
      if (!canPassTurn) return false;
      doPassTurn();
      return true;
    }
    doNextTurnHordeAware();
    return true;
  }, [onlineHorde, onlineTable, canPassTurn, doPassTurn, doNextTurnHordeAware]);

  const advancePhase = useCallback(() => {
    if (!onlineTable) return;
    const cur = onlineTable.phase;
    const next = cur === undefined ? GAME_PHASES[0] : GAME_PHASES[GAME_PHASES.indexOf(cur) + 1];
    if (!next) return;
    onlineTable.dispatch({ type: 'phase', phase: next, actorSeat: onlineTable.mySeat });
  }, [onlineTable]);

  const {
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
  } = useCardActions({
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
  });

  // City's Blessing is a genuine one-time accomplishment (never lost this
  // game) — a stronger haptic cue than the routine tap monarch/initiative get.
  function handleSetDesignation(designation: Designation, held: boolean) {
    if (designation === 'citysBlessing') haptics.success();
    else haptics.tap();
    dispatch({ type: 'SET_DESIGNATION', designation, held });
    // Mirror monarch/initiative onto the table so its published board (and
    // every opponent's rail) agrees with what this seat just claimed/dropped.
    // City's Blessing has no table-level field (GameDesignations tracks only
    // monarch/initiative) — it stays local-only, same as solo playtest.
    if (onlineTable && (designation === 'monarch' || designation === 'initiative')) {
      onlineTable.dispatch({
        type: 'set-designation',
        designation,
        seat: held ? onlineTable.mySeat : null,
        actorSeat: onlineTable.mySeat,
      });
    }
  }

  // Resistance's only explanation used to be a hover `title` on the toggle —
  // invisible on touch. Reuse the existing opponent-announcement banner to
  // show a one-time explanation naming the picked level; a real opponent
  // event (which shares the same single-slot banner below) takes over from
  // it. Derived during render (not an effect) per React's "adjusting state
  // when a prop changes" pattern.
  const [resistanceIntro, setResistanceIntro] = useState(false);
  const [prevResistanceLevel, setPrevResistanceLevel] = useState(resistanceLevel);
  if (resistanceLevel !== prevResistanceLevel) {
    setPrevResistanceLevel(resistanceLevel);
    setResistanceIntro(resistanceLevel !== 'off');
  }
  const lastEventId = lastResistanceEvent?.id;
  const [prevEventId, setPrevEventId] = useState(lastEventId);
  if (lastEventId !== prevEventId) {
    setPrevEventId(lastEventId);
    if (lastEventId !== undefined) setResistanceIntro(false);
  }

  // The app-wide `?` overlay, where one is mounted, reads the live bindings so
  // a rebound key is what it prints.
  const registeredShortcuts = useMemo(
    () => [
      ...SHORTCUTS.filter((d) => bindings[d.id]).map((d) => ({
        keys: [formatChord(bindings[d.id])],
        description: d.label,
      })),
      ...FIXED_SHORTCUTS,
    ],
    [bindings]
  );
  useRegisterShortcuts('Playtest', registeredShortcuts);

  // Keyboard shortcuts — one handler, driven by the rebindable table in
  // lib/shortcuts. Ignored while typing or while any sheet/modal/context menu
  // is open; harmless if it never fires on touch (every action here is also
  // a button or a menu item). Keys the board doesn't know fall through so the
  // browser keeps them.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (anySheetOpen || isTypingTarget(e.target)) return;
      // Keyboard route to the table menu: the physical Context Menu key, or
      // Shift+F10 on keyboards without one. Anchored at the board's centre,
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
          // behaviour a single hovered card collapses to anyway.
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
  ]);

  // Online, keeping your opening hand doesn't start the game — the takeover
  // stays up until every other seat has kept too. A seat with no published
  // board, or one whose board predates `keptHand`, reads as still choosing.
  // `every()` on an empty list is true, so the count must be checked: seated
  // alone, the table waits for someone to join rather than counting itself in.
  // `tableFinished` short-circuits this to `undefined`: a wait for the rest
  // of the table can never resolve once the table has ended (E351 follow-up)
  // — the curtain must drop and hand the board back, not strand the player
  // behind "Waiting for X" forever.
  const openingOnline =
    onlineTable && !tableFinished
      ? {
          waitingOn: onlineTable.opponents
            .filter((o) => o.board.keptHand !== true)
            .map((o) => o.name),
          allKept:
            onlineTable.opponents.length > 0 &&
            onlineTable.opponents.every((o) => o.board.keptHand === true),
        }
      : undefined;
  // The exact complement of `OpeningHandSheet`'s own mount condition below
  // (`phase !== 'playing' || openingOnline`): the two can never both be
  // "showing" at once, so the drag hint never fights the takeover for the
  // same hand.
  const isChoosingHand = phase !== 'playing' || Boolean(openingOnline);

  // Retires the drag-to-play hint the first time a card actually leaves the
  // hand for the battlefield, however it got there (drag, or the hand card
  // menu's Play / Play tapped / Play face down). Hand length falling while
  // battlefield length rises in the same update is that move; nothing else
  // produces that pair (a discard/exile/library move drops the hand alone, a
  // token or a command-zone cast raises the battlefield alone, and a takeback
  // moves both the other way). Cheaper and less invasive than threading a
  // "this came from hand" flag through every MOVE_TO_BATTLEFIELD call site.
  const dragHintCounts = useRef({ hand: state.zones.hand.length, bf: state.battlefield.length });
  useEffect(() => {
    const prev = dragHintCounts.current;
    const hand = state.zones.hand.length;
    const bf = state.battlefield.length;
    if (!isChoosingHand && hand < prev.hand && bf > prev.bf) retireDragHint();
    dragHintCounts.current = { hand, bf };
  }, [state.zones.hand.length, state.battlefield.length, isChoosingHand, retireDragHint]);

  const dragHintCoarsePointer = useMediaQuery('(pointer: coarse)');
  const showDragHint =
    !isChoosingHand &&
    !dragHintDismissed &&
    shouldShowPlaytestDragHint(state.zones.hand.length > 0);
  const dragHintBanner = showDragHint && (
    <WedgeHintStrip
      icon={<Move width={16} height={16} aria-hidden />}
      headline="Play a card"
      detail={
        dragHintCoarsePointer
          ? 'Drag a card onto the battlefield, or hold it for the menu.'
          : 'Drag a card onto the battlefield, or right-click it for the menu.'
      }
      onDismiss={retireDragHint}
    />
  );

  // ── Table-tier chrome (≥1024px) ─────────────────────────────────────────
  // Everything the deleted rows used to offer, regrouped into the four
  // corners. Built here rather than in a component of its own because every
  // item is one of this component's own handlers — a wrapper would be thirty
  // props of pure pass-through.
  const heldDesignations = [
    state.monarch && 'Monarch',
    state.initiative && 'Initiative',
    state.citysBlessing && "City's Blessing",
  ].filter((label): label is string => Boolean(label));

  // Everything you set once and forget lives behind "Table settings" (see
  // `TableSettingsSheet`); the menu itself is actions. Library actions
  // (Shuffle, Top cards) moved onto the library pile, where the cards are,
  // and Mulligan is offered by the opening-hand takeover that owns it.
  const settingsLinks: SettingLink[] = [
    {
      label: 'Takeback rule',
      value: TAKEBACK_MODE_LABEL[takeback.mode],
      onOpen: () => {
        setShowTableSettings(false);
        setShowTakebackSettings(true);
      },
    },
    // Solo Horde (E387 PR 5): hidden at an online table, a horde never
    // exists there.
    ...(!onlineTable
      ? [
          {
            label: 'Horde',
            value: horde
              ? `${horde.config.hordeName} · ${hordeLevelLabel(horde.config.level)}`
              : 'Off',
            onOpen: () => {
              setShowTableSettings(false);
              setShowHordeSetup(true);
            },
          },
        ]
      : []),
    {
      label: 'Resistance',
      value: RESISTANCE_LEVEL_LABEL[resistanceLevel],
      onOpen: () => {
        setShowTableSettings(false);
        setShowResistancePicker(true);
      },
    },
  ];

  // Set-and-forget switches, rendered in full in the sheet. The turn alert
  // only means something where the turn can pass to you from someone else.
  const settingsToggles: SettingToggle[] = [
    {
      label: 'Snap cards to grid',
      hint: 'Cards you drop line up on a half-card grid.',
      on: snap,
      onChange: (on) => {
        setSnap(on);
        writeSnap(on);
      },
    },
    ...(onlineTable
      ? [
          {
            label: 'Turn alert',
            hint: 'A chime when the turn passes to you, and a tab title that says so.',
            on: turnAlert,
            onChange: (on: boolean) => {
              setTurnAlert(on);
              writeTurnAlert(on);
            },
          },
        ]
      : []),
  ];

  // What the drawer carries, in the order you reach for it: the things you
  // open mid-game, the things you set once, and — kept at the foot, off the
  // scroller — the ones that end a game.
  const gameMenuSections: GameMenuSection[] = [
    {
      title: 'Table',
      items: [
        { label: 'Stats', icon: BarChart3, onClick: () => setShowStats(true) },
        {
          label: 'Log',
          icon: ScrollText,
          note: hasUnreadLog ? 'New' : undefined,
          onClick: handleOpenLog,
        },
        ...(gridFits
          ? [
              {
                label: gridMode ? 'Show the rail' : 'Show the seat grid',
                icon: gridMode ? Rows3 : LayoutGrid,
                onClick: toggleLayout,
              },
            ]
          : []),
        ...(myArrowCount > 0
          ? [
              {
                label: `Clear my arrows (${myArrowCount})`,
                icon: Eraser,
                onClick: () => void clearMyArrows(),
              },
            ]
          : []),
        // The same quick-look reference the live tracker's menu opens — one
        // sheet, mounted once in Layout, so the board just asks for it.
        { label: 'Rules reference', icon: BookOpen, onClick: openRules },
        // Game state that changes hands mid-game when a card resolves, so it
        // sits with the things you open during play, not in the settings.
        {
          label: 'Designations',
          icon: Crown,
          note: heldDesignations.length > 0 ? heldDesignations.join(', ') : undefined,
          onClick: () => setShowDesignations(true),
        },
        ...(isOnlineHordeTable
          ? [
              {
                label: "Undo the horde's last step",
                icon: Undo2,
                note: onlineHorde.lastStepLabel ?? undefined,
                disabled: !onlineHorde.lastStepLabel,
                onClick: () => onlineHorde.undoLast(),
              },
            ]
          : []),
      ],
    },
    {
      title: 'Settings',
      items: [
        { label: 'Table settings', icon: Settings, onClick: () => setShowTableSettings(true) },
        { label: 'Keyboard shortcuts', icon: Keyboard, onClick: () => setShowShortcuts(true) },
        // Fullscreen is offered only where the browser offers it (not inside
        // every embedded browser).
        ...(typeof document !== 'undefined' && document.fullscreenEnabled
          ? [
              {
                label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
                icon: isFullscreen ? Minimize2 : Maximize2,
                onClick: () => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void document.documentElement.requestFullscreen();
                },
              },
            ]
          : []),
      ],
    },
  ];

  // Online, the table is shared: conceding marks this seat out for everyone,
  // ending it finishes the game for the whole pod, and leaving gives the seat
  // up. All three ask first; all three are the game's truth, not this
  // device's, so they go through the session.
  const gameMenuFooter: GameMenuSection = {
    title: 'Game',
    items: [
      ...(onBack
        ? [{ label: `Back to ${backLabel ?? 'deck'}`, icon: ArrowLeft, onClick: onBack }]
        : []),
      { label: 'Start a new game', icon: RotateCcw, danger: true, onClick: () => void doReset() },
      ...(onlineTable
        ? [
            { label: 'Concede', icon: Flag, danger: true, onClick: () => void concedeOnline() },
            // Only the host can end the table — the server enforces the same
            // rule, so nobody else is offered a button that would bounce.
            ...(onlineTable.isHost
              ? [
                  {
                    label: 'End the table for everyone',
                    icon: Gavel,
                    danger: true,
                    onClick: () => setEndingTable(true),
                  },
                ]
              : []),
            {
              label: 'Leave the table',
              icon: LogOut,
              danger: true,
              onClick: () => void leaveTable(),
            },
          ]
        : []),
    ],
  };

  // Takeback's glance cue: the count, a lock, or "Off". Read by the table
  // menu's own row, so it is resolved before that list is built.
  const takebackBadge =
    takeback.mode === 'off'
      ? 'Off'
      : takeback.verdict === 'locked'
        ? '🔒'
        : takeback.stepsAvailable > 0
          ? String(takeback.stepsAvailable)
          : null;

  // Drawing and every library peek are on the library pile (and on their own
  // keys); the log and the shortcuts sheet are in the game menu. What is left
  // is what you reach for with the pointer already on the felt.
  // EDHPlay's felt menu, row for row, then the ones this table adds.
  const tableMenuItems: MenuEntry[] = [
    canPassTurn
      ? { label: 'Pass turn', shortcut: keyFor('pass-turn'), onClick: doPassTurn }
      : {
          label: 'Next turn',
          // Solo, Space is the next turn too (EDHPlay's key for this row);
          // online and not your turn it does nothing, so Shift+N is the key.
          shortcut: keyFor(onlineTable ? 'next-turn' : 'pass-turn'),
          onClick: doNextTurnHordeAware,
        },
    { label: 'Untap all', shortcut: keyFor('untap-all'), onClick: doUntapAll },
    {
      label: manaOpen ? 'Hide mana pool' : 'Show mana pool',
      shortcut: keyFor('mana'),
      onClick: () => setManaOpen((open) => !open),
    },
    { label: 'Create token', shortcut: keyFor('token'), onClick: () => setTokenCreator(true) },
    // Cards outside the game (Wishes, Karn, Learn, companions). A menu row
    // rather than a pile: most decks have no sideboard and the rest reach
    // for it once a game, so it only appears while there is one to open.
    ...(state.zones.sideboard.length > 0
      ? [{ label: 'View sideboard', onClick: () => setViewer({ zone: 'sideboard' as const }) }]
      : []),
    {
      label: 'Roll dice or flip a coin',
      shortcut: keyFor('dice'),
      onClick: () => setShowDice(true),
    },
    { label: 'Designations', onClick: () => setShowDesignations(true) },
    ...(onlineTable
      ? [
          {
            label: 'Reactions',
            // The four with keys first, as their keys run (7 to 0).
            items: REACTION_EMOTES.map((emote, i) => ({
              label: `${emote} ${REACTION_LABEL[emote]}`,
              shortcut: i < 4 ? keyFor(`react-${i + 1}` as ShortcutId) : undefined,
              onClick: () => sendReaction(i),
            })),
          },
        ]
      : []),
    SEPARATOR,
    { label: selectMode ? 'Done selecting' : 'Select cards', onClick: toggleSelectMode },
    {
      label: takebackBadge ? `Take back (${takebackBadge})` : 'Take back',
      shortcut: keyFor('undo'),
      onClick: handleTakebackClick,
      disabled: takeback.mode === 'off' || takeback.verdict === 'none',
    },
  ];

  // The table tier's mana tracker, in its own bottom-left dock above the log
  // dock rather than inside the life panel — floating mana is something you
  // read while looking at your lands and your hand, not while looking at your
  // life total. Closed and empty it is nothing at all (six always-zero
  // steppers have no business sitting on the table all game); closed with
  // mana floating it is one "Mana · 3" chip; M or the chip opens the pool.
  const manaTotal = Object.values(state.manaPool ?? ZERO_MANA_POOL).reduce((a, b) => a + b, 0);
  const manaPool = (
    <ManaPool
      layout="column"
      pool={state.manaPool ?? ZERO_MANA_POOL}
      onAdjust={(color, delta) => {
        haptics.tap();
        dispatch({ type: 'ADJUST_MANA', color, delta });
      }}
      onEmpty={() => {
        haptics.tap();
        dispatch({ type: 'EMPTY_MANA_POOL' });
      }}
    />
  );
  const manaRow = manaOpen ? (
    manaPool
  ) : manaTotal > 0 ? (
    <button
      type="button"
      className="playtest-mana-collapsed"
      onClick={() => setManaOpen(true)}
      title="Floating mana (M)"
    >
      Mana <span className="playtest-mana-collapsed__count">{manaTotal}</span>
    </button>
  ) : null;

  const trackers = (
    <div className="playtest-trackers playtest-trackers--corner">
      <LifeStrip
        life={state.life}
        isNarrow={isNarrow}
        monarch={state.monarch}
        initiative={state.initiative}
        citysBlessing={state.citysBlessing}
        playerCounters={state.playerCounters ?? {}}
        onAdjustLife={(delta) => {
          haptics.tap();
          dispatch({ type: 'ADJUST_LIFE', delta });
        }}
        onAdjustCounter={(kind, delta) => {
          haptics.tap();
          dispatch({ type: 'SET_PLAYER_COUNTER', counter: kind, delta });
        }}
        onOpenChange={setLifePanelOpen}
        onlineTable={onlineTable}
        onViewOpponentBoard={setViewingBoardSeat}
        variant="table"
      />
    </div>
  );

  const banners = (
    <>
      {lastSessionRecord && lastSessionRecord.id !== dismissedSessionRecordId ? (
        // A Reset-triggered session end gets the E141 recap.
        <PlaytestSessionSummary
          key={lastSessionRecord.id}
          record={lastSessionRecord}
          onDismiss={() => setDismissedSessionRecordId(lastSessionRecord.id)}
        />
      ) : lastResistanceEvent && lastResistanceEvent.id !== dismissedResistanceId ? (
        <ResistanceBanner
          key={lastResistanceEvent.id}
          message={lastResistanceEvent.message}
          onDismiss={() => setDismissedResistanceId(lastResistanceEvent.id)}
        />
      ) : (
        resistanceIntro &&
        resistanceLevel !== 'off' && (
          <ResistanceBanner
            key="resistance-intro"
            message={RESISTANCE_LEVEL_ANNOUNCE[resistanceLevel]}
            onDismiss={() => setResistanceIntro(false)}
          />
        )
      )}
    </>
  );

  const pendingBanner = takeback.pendingRequest && (
    <TakebackPendingBanner
      request={takeback.pendingRequest}
      onCancel={takeback.cancelPending}
      message={takeback.pendingOutcomeMessage ?? undefined}
    />
  );

  // Whoever holds the TOP-RIGHT cell sits under the viewport-fixed turn/menu
  // stack: the right column at two seats, the second of the upper pair at
  // three or four. That quadrant insets its battlefield so no permanent of
  // theirs can render beneath the stack (see OpponentQuadrant.css).
  const topRightSeat = (opponents.length === 1 ? opponents[0] : opponents[1])?.board.seat;
  const renderQuadrant = (opp: (typeof opponents)[number]) => (
    <OpponentQuadrant
      key={opp.board.seat}
      opp={opp}
      active={onlineTable?.activeSeat === opp.board.seat}
      sweeping={sweepSeat === opp.board.seat}
      pointed={tablePointer?.targetSeat === opp.board.seat}
      watching={viewingBoardSeat === opp.board.seat}
      underTurnStack={opp.board.seat === topRightSeat}
      onOpen={() => setViewingBoardSeat(opp.board.seat)}
      onPickCard={arrowFrom ? (cardId) => finishArrow(opp.board.seat, cardId) : undefined}
    />
  );

  const cornerActions = (
    <TableCornerActions
      onlineTable={onlineTable}
      onlineHorde={onlineHorde}
      onlineHordePhase={onlineHordePhase}
      isOnlineHordeTable={isOnlineHordeTable}
      hordeBlocksTurn={hordeBlocksTurn}
      isNarrow={isNarrow}
      turn={state.turn}
      canAdvanceTurn={canAdvanceTurn}
      advanceTurn={advanceTurn}
      activeName={activeName}
      keyFor={keyFor}
      showGameMenu={showGameMenu}
      onOpenGameMenu={() => setShowGameMenu(true)}
      hasUnreadLog={hasUnreadLog}
      takebackPending={Boolean(takeback.pendingRequest)}
      selectMode={selectMode}
      selectedCount={selected.size}
      onToggleSelectMode={toggleSelectMode}
    />
  );

  const pileMenuItems = (zone: Zone): MenuEntry[] =>
    buildPileMenuItems(zone, {
      state,
      dispatch,
      onlineTable,
      keyFor,
      libraryCount,
      libraryReveal,
      doDraw,
      peekZone,
      setViewer,
      setPileMenu,
      setScryFrom,
      setShowScry,
    });

  const openPileMenu = (zone: Zone) => (x: number, y: number) => setPileMenu({ zone, x, y });

  /** A token onto the battlefield — from the token picker, or a card menu's
   *  Create token row. */
  const createToken = ({ name, typeLine, imageUrl }: MadeToken & { imageUrl?: string }) => {
    const id = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tokenCard: PlaytestCard = {
      id,
      name,
      isToken: true,
      // Carried through so auto-placement puts a creature token in the
      // creature row rather than guessing from the name.
      ...(typeLine !== undefined && { typeLine }),
      ...(imageUrl !== undefined && { imageUrl }),
    };
    const { x, y } = placeOnBattlefield(tokenCard);
    dispatch({ type: 'CREATE_TOKEN', card: tokenCard, x, y });
    // A token picked from the grid already brought its art. Anything else
    // needs resolving, and that never blocks the token appearing — the
    // placeholder renders immediately and the art swaps in when (if) it lands.
    if (imageUrl) return;
    void resolveTokenArt(name).then((url) => {
      if (url) dispatch({ type: 'SET_CARD_IMAGE', cardId: id, imageUrl: url });
    });
  };

  /** Out of the command zone onto the battlefield — the reducer bumps that
   *  commander's own tax. */
  const castCommander = (card: PlaytestCard) => {
    const pos = placeOnBattlefield(card);
    dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: card.id, x: pos.x, y: pos.y });
  };

  /** Where a randomly selected card goes from the peek dialog. */
  const handlePeekMove = (
    card: PlaytestCard,
    to: 'hand' | 'battlefield' | 'graveyard' | 'exile'
  ) => {
    if (to === 'battlefield') {
      const pos = placeOnBattlefield(card);
      dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: card.id, x: pos.x, y: pos.y });
    } else {
      dispatch({ type: 'MOVE_TO_ZONE', cardId: card.id, to });
    }
  };

  /* Which piles stand on the felt, and which live behind the edge tab. Four
     card-width tiles plus a hand do not fit a PHONE, and the two that earn
     the room are the ones you touch every turn: the library (its click
     draws) and the graveyard. Exile and the command zone are a tap away in
     the tab — the same split EDHPlay makes, for the same reason. A tablet
     has the width for all four, so it keeps them. */
  const piles = (
    <TablePiles
      state={state}
      dispatch={dispatch}
      libraryCount={libraryCount}
      libraryReveal={libraryReveal}
      faceDownExile={faceDownExile}
      taxCards={taxCards}
      isPhone={isPhone}
      handMenuOpen={pileMenu?.zone === 'hand'}
      onOpenHandMenu={(x, y) => setPileMenu({ zone: 'hand', x, y, origin: 'bottom-end' })}
      doDraw={doDraw}
      openPileMenu={openPileMenu}
      onViewZone={(zone) => setViewer({ zone })}
      onCommanderMenu={(cardId, x, y) => setHandMenu({ cardId, x, y, zone: 'command' })}
    />
  );

  return (
    <div
      className={`playtest-board${isNarrow ? ' playtest-board--narrow' : ''}${
        selectMode ? ' is-selecting' : ''
      }`}
      // The catch-all below the card/felt handlers, which open the real menus:
      // by the time it runs the board has had its say, and everything it did
      // not claim (badges, zone piles, chrome, gaps) loses the native menu too.
      onContextMenu={suppressNativeContextMenu}
    >
      {/* All three portal to <body> (see their own doc comments) so placement
          here only decides conditional gating, not layout. */}
      {onlineTable && <TakebackConsentPrompt onlineTable={onlineTable} />}
      {onlineTable && <TableMoments onlineTable={onlineTable} />}
      {onlineTable && <TableFinishedBanner />}
      <TriggerReminder
        cards={triggerCards}
        beat={onlineTable?.phase ?? null}
        turn={state.turn}
        myTurn={onlineTable === null || myTurn}
        onLocate={locateCard}
      />
      {onlineTable &&
        viewingBoardSeat != null &&
        (() => {
          const opp = onlineTable.opponents.find((o) => o.board.seat === viewingBoardSeat);
          return opp ? (
            <OpponentBoardModal
              opp={opp}
              active={onlineTable.activeSeat === viewingBoardSeat}
              onClose={() => setViewingBoardSeat(null)}
              onArrowTarget={
                arrowFrom
                  ? (cardId) => {
                      finishArrow(opp.board.seat, cardId);
                      setViewingBoardSeat(null);
                    }
                  : undefined
              }
            />
          ) : null;
        })()}
      {arrowFrom && (
        <div className="playtest-arrow-mode" role="status">
          <span>
            Arrow from{' '}
            <b>
              {state.battlefield.find((b) => b.card.id === arrowFrom.cardId)?.card.name ??
                'your card'}
            </b>
            . Tap the card it points to.
          </span>
          <Button onClick={() => setArrowFrom(null)}>Cancel</Button>
        </div>
      )}
      {onlineTable && <TableArrows mySeat={onlineTable.mySeat} />}
      <TablePings pings={pings} mySeat={onlineTable?.mySeat ?? null} />
      {/* Renders nothing on an empty stack, which is most of a game. */}
      <StackPanel
        items={stackItems}
        onDrawArrow={(id) => beginArrow(new Set([id]))}
        onCopy={(id) => copyOntoStack([id])}
        onResolve={(id) => resolveStack(id)}
        arrowKey={keyFor('arrow')}
        copyKey={keyFor('stack-copy')}
        resolveKey={keyFor('stack-resolve')}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={measuring}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          clearRideOffset();
        }}
      >
        <div
          className={`playtest-main${gridMode ? ' playtest-main--grid' : ''}${
            gridMode && opponents.length === 1 ? ' playtest-main--seats-2' : ''
          }${(!onlineTable ? hordeVisible : isOnlineHordeTable) && !isNarrow ? ' playtest-main--horde' : ''}${
            isOnlineHordeTable && !isNarrow ? ' playtest-main--horde-rail' : ''
          }`}
        >
          {onlineTable && !gridMode && (
            <OpponentRail
              opponents={
                onlineHorde
                  ? onlineTable.opponents.map((opp) => ({
                      ...opp,
                      status: (onlineTable.players.find((p) => p.seat === opp.board.seat)
                        ?.connected === false
                        ? 'Offline'
                        : onlineHorde.team.done.includes(opp.board.seat)
                          ? 'Done'
                          : 'Playing') as 'Playing' | 'Done' | 'Offline',
                    }))
                  : onlineTable.opponents
              }
              activeSeat={onlineTable.activeSeat ?? undefined}
            >
              <TableTicker onlineTable={onlineTable} />
            </OpponentRail>
          )}
          {/* Grid order is the table's seating: your own board is bottom-left,
              so with two seats the single opponent sits beside you and with
              three or four the others fill the row above. */}
          {gridMode && opponents.length > 1 && opponents.slice(0, 2).map(renderQuadrant)}
          {/* Solo Horde never exists at an online table, and a horde at an
              online table (E387 online co-op, lane F2) never exists solo —
              `hordeUiActive` below is exactly one or the other. The desktop
              half sits above your board (fixed two-row grid via
              `.playtest-main--horde`, plus a rail column online);
              the phone band folds above it inline. */}
          {(!onlineTable ? hordeVisible : isOnlineHordeTable) &&
            withHordeActions(
              isNarrow ? (
                <HordeBand
                  horde={onlineTable ? onlineHordeView : horde}
                  hordeLoad={onlineHordeLoadView}
                  playerTurn={onlineTable ? (onlineHorde?.team.survivorTurn ?? 1) : state.turn}
                  feltRef={hordeFeltRef}
                  onCardMenu={setHordeCardMenuId}
                  onOpenDamage={() => setHordeDamageOpen(true)}
                  statusText={onlineHordeBandStatusText}
                  blocked={onlineHordeBlocked}
                  extraAction={onlineHordeExtraAction}
                />
              ) : (
                <HordeHalf
                  horde={onlineTable ? onlineHordeView : horde}
                  hordeLoad={onlineHordeLoadView}
                  playerTurn={onlineTable ? (onlineHorde?.team.survivorTurn ?? 1) : state.turn}
                  feltRef={hordeFeltRef}
                  onCardMenu={setHordeCardMenuId}
                  onOpenDamage={() => setHordeDamageOpen(true)}
                  statusText={onlineHordeStatusText}
                  blocked={onlineHordeBlocked}
                />
              )
            )}
          <div
            ref={battlefieldRef}
            // Solo play has no seat order, so every turn is yours and the
            // ring is always lit — the same expression the trigger reminder
            // already reads the board's turn with.
            className={`playtest-battlefield-wrap${onlineTable === null || myTurn ? ' is-my-turn' : ''}`}
            data-seat-anchor={onlineTable?.mySeat}
          >
            <Battlefield
              cards={state.battlefield}
              selectedIds={selected}
              ridingIds={dragGroup?.riding}
              stackIds={stackIdSet}
              onBackgroundClick={clearSelection}
              onMarqueeSelect={selectArea}
              onBackgroundContextMenu={openTableMenu}
              onCardClick={handleCardClick}
              onCardContextMenu={handleCardContext}
              onCardLongPress={handleCardLongPress}
              onAdjustPT={(cardId, power, toughness) =>
                dispatch({ type: 'ADJUST_PT', cardId, power, toughness })
              }
              onStepCounter={(cardId, counter, delta) =>
                dispatch({ type: 'SET_COUNTER', cardId, counter, delta })
              }
            />
            {/* The four corner clusters, floating over the felt rather than
                taking rows off the board's height — at EVERY width. A phone
                used to get a different board entirely: a title bar, eleven
                buttons in two rows, a life row and a mana row, which between
                them ate 40% of the screen before a single card was played.
                The felt is the thing worth the pixels, so the phone gets the
                same table the desktop does, sized for a thumb. */}
            {
              <>
                <div className="playtest-banners">
                  {pendingBanner}
                  {banners}
                  {dragHintBanner}
                  {!isNarrow &&
                    (onlineTable
                      ? onlineHordeView &&
                        withHordeActions(<HordeSoloBanner horde={onlineHordeView} />)
                      : horde && <HordeSoloBanner horde={horde} />)}
                </div>
                {trackers}
                {cornerActions}
                {/* The ticker's home when there is no rail to hold it: the top
                    right of your own quadrant, so the feed stays visible
                    without parking chrome over somebody else's board. */}
                {gridMode && onlineTable && (
                  <div className="playtest-ticker-dock">
                    <TableTicker onlineTable={onlineTable} />
                  </div>
                )}
                {piles}
                <Hand
                  cards={state.zones.hand}
                  fan
                  onCardMenu={handleHandCardMenu}
                  onCardPreview={handleHandCardPreview}
                  revealedIds={revealedIds}
                />
              </>
            }
          </div>
          {gridMode &&
            (opponents.length === 1
              ? opponents.map(renderQuadrant)
              : opponents.slice(2).map(renderQuadrant))}
          {gridMode && opponents.length === 2 && <OpenSeatQuadrant />}
        </div>
        <CardHoverPreview
          suspended={activeId !== null || anySheetOpen}
          resolve={resolvePreview}
          pinned={tappedPreviewId}
          onUnpin={unpinPreview}
          holdHint={!holdHintSeen}
        />
        {/* Above `--z-overlay` so a card dragged out of a sheet renders over
            the sheet, not behind it. */}
        {/* `playtest-drag-overlay` centres the copy in the wrapper, which
            dnd-kit sizes from the source's box. For a TAPPED card that box is
            the rotated one — width and height swapped — while the copy inside
            keeps the printed card's size and rotates about its own centre, so
            left at the wrapper's top-left it sits half the difference off the
            card. A no-op for an untapped card: the two boxes are the same. */}
        <DragOverlay dropAnimation={null} zIndex={1200} className="playtest-drag-overlay">
          {activeDrag && (
            <PlaytestCardFace
              card={activeDrag.card}
              bf={activeDrag.bf}
              size={activeDrag.size}
              className="playtest-card--dragging"
              style={{ transform: activeDrag.bf?.tapped ? 'rotate(90deg)' : undefined }}
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Bottom-left dock column (table tier; the narrow tier keeps the log
          sheet and puts mana in the trackers row). Mana sits above the log,
          above the table feed's button, and they stack with flexbox rather than
          arithmetic: the log's height is content-driven and capped at a MAX,
          and it is unmounted entirely when closed — any hand-computed offset
          is wrong in both directions (an early one put the mana column off
          the top of the screen). The dock mounts for an online table even
          with no mana and the log closed: the table log toggle (#2073) has
          to stay reachable, not appear only when something else is open. */}
      {(manaRow || showLog || onlineTable) && (
        <div className="playtest-left-dock">
          {manaRow && <div className="playtest-mana-dock">{manaRow}</div>}
          {showLog && (
            <LogDock
              log={gameLog}
              popoutHref={playtestDeckId ? `/decks/${playtestDeckId}/playtest/log` : undefined}
              table={
                onlineTable
                  ? { items: onlineTicker, nameFor: (seat) => tickerSeatName(onlineTable, seat) }
                  : undefined
              }
              phase={
                onlineTable
                  ? {
                      current: onlineTable.phase,
                      mine: onlineTable.activeSeat === onlineTable.mySeat,
                      onSet: (p) =>
                        onlineTable.dispatch({
                          type: 'phase',
                          phase: p,
                          actorSeat: onlineTable.mySeat,
                        }),
                    }
                  : undefined
              }
              startOnTable={logOnTable}
              onClose={() => setShowLog(false)}
            />
          )}
          {onlineTable && (
            <TableTickerDock onlineTable={onlineTable} open={showLog} onToggle={toggleTableLog} />
          )}
        </div>
      )}

      {tableMenu && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          items={tableMenuItems}
          onClose={() => setTableMenu(null)}
        />
      )}

      {pileMenu && (
        <TableContextMenu
          x={pileMenu.x}
          y={pileMenu.y}
          // One menu, two presentations: a cursor-anchored popover where
          // there is a cursor, the shared bottom sheet where there is a thumb.
          origin={pileMenu.origin}
          title={ZONE_VIEWER_LABEL[pileMenu.zone]}
          items={pileMenuItems(pileMenu.zone)}
          onClose={() => setPileMenu(null)}
        />
      )}

      {isPhone && (
        <MobileZonesPanel
          zones={state.zones}
          hiddenIds={faceDownExile}
          commanderTax={state.commanderTax}
          taxCards={taxCards}
          onAdjustTax={(cardId, delta) => dispatch({ type: 'ADJUST_COMMANDER_TAX', cardId, delta })}
          onOpenZone={(zone) => setViewer({ zone })}
          // The sheet variant is anchored by the viewport, not the pointer,
          // so the coordinates are unused here — 0,0 says so.
          onMenu={(zone) => setPileMenu({ zone, x: 0, y: 0 })}
        />
      )}

      {viewer && (
        <ZoneViewerModal
          zone={viewer.zone}
          cards={state.zones[viewer.zone]}
          commanderTax={state.commanderTax}
          onClose={() => setViewer(null)}
          onMove={(cardId, to, toIndex) => {
            if (to === 'battlefield') {
              const c = state.zones[viewer.zone].find((card) => card.id === cardId) ?? null;
              const pos = c ? placeOnBattlefield(c) : FALLBACK_DROP_POS;
              dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x: pos.x, y: pos.y });
            } else {
              dispatch({ type: 'MOVE_TO_ZONE', cardId, to, toIndex });
            }
          }}
          onShuffleAfter={
            viewer.zone === 'library'
              ? () => {
                  dispatch({ type: 'SHUFFLE_LIBRARY' });
                  setViewer(null);
                }
              : undefined
          }
          hiddenIds={viewer.zone === 'exile' ? faceDownExile : undefined}
          libraryCount={libraryCount}
          onShuffleIntoLibrary={
            viewer.zone === 'graveyard' || viewer.zone === 'exile'
              ? () => {
                  dispatch({
                    type: 'SHUFFLE_ZONE_INTO_LIBRARY',
                    zone: viewer.zone as 'graveyard' | 'exile',
                  });
                  setViewer(null);
                }
              : undefined
          }
          cardLookup={cardLookup}
        />
      )}

      {ctx && (
        <BoardCardContextMenu
          ctx={ctx}
          battlefield={state.battlefield}
          libraryCount={libraryCount}
          cardLookup={cardLookup}
          selected={selected}
          onlineTable={onlineTable}
          dispatch={dispatch}
          keyFor={keyFor}
          tokensMadeBy={tokensMadeBy}
          createToken={createToken}
          tapSelection={tapSelection}
          moveSelection={moveSelection}
          cloneCards={cloneCards}
          beginArrow={beginArrow}
          copyOntoStack={copyOntoStack}
          putOnStack={putOnStack}
          adjustAllCounters={adjustAllCounters}
          onPreview={setPreviewCardId}
          onOpenCustomCounters={setCountersFor}
          onClose={() => setCtx(null)}
        />
      )}

      {handMenu && handMenuCard && (
        <HandCardMenu
          x={handMenu.x}
          y={handMenu.y}
          cardName={handMenuCard.name}
          zone={handMenuZone}
          libraryCount={libraryCount}
          tokens={tokensMadeBy(handMenuCard.name)}
          onCreateToken={createToken}
          keyFor={keyFor}
          onClose={() => setHandMenu(null)}
          onPreview={
            cardLookup?.has(handMenu.cardId) ? () => setPreviewCardId(handMenu.cardId) : undefined
          }
          onPlay={(opts) => {
            if (handMenuZone === 'command') {
              castCommander(handMenuCard);
              return;
            }
            playFromHand(handMenu.cardId, opts);
          }}
          onMoveTo={(zone, toIndex) =>
            dispatch({ type: 'MOVE_TO_ZONE', cardId: handMenu.cardId, to: zone, toIndex })
          }
          revealed={(state.revealed ?? []).includes(handMenu.cardId)}
          // With the whole hand revealed there is nothing one card can add.
          onToggleReveal={
            onlineTable && !state.handRevealed
              ? () => dispatch({ type: 'TOGGLE_REVEAL', cardId: handMenu.cardId })
              : undefined
          }
          onPutOnStack={() => putOnStack([handMenu.cardId])}
          onMove={
            handMenuZone === 'hand'
              ? (direction) => {
                  const from = state.zones.hand.findIndex((c) => c.id === handMenu.cardId);
                  if (from >= 0)
                    dispatch({
                      type: 'REORDER_HAND',
                      cardId: handMenu.cardId,
                      toIndex: from + direction,
                    });
                }
              : undefined
          }
          canMoveEarlier={state.zones.hand.findIndex((c) => c.id === handMenu.cardId) > 0}
          canMoveLater={
            state.zones.hand.findIndex((c) => c.id === handMenu.cardId) <
            state.zones.hand.length - 1
          }
        />
      )}

      {previewCardId && (
        <BoardCardInfo
          previewCardId={previewCardId}
          cardLookup={cardLookup}
          state={state}
          onClose={() => setPreviewCardId(null)}
        />
      )}

      {tokenCreator && (
        <TokenCreator
          deckCards={deckTokenSources}
          onClose={() => setTokenCreator(false)}
          onCreate={(token) => {
            createToken(token);
            setTokenCreator(false);
          }}
        />
      )}

      {showScry && (
        <ScrySheet
          library={state.zones.library}
          from={scryFrom}
          onClose={() => setShowScry(false)}
          onResolve={(resolution) => {
            haptics.tap();
            dispatch({ type: 'RESOLVE_TOP', ...resolution });
          }}
        />
      )}

      {peek && <PeekModal peek={peek} onClose={() => setPeek(null)} onMoveTo={handlePeekMove} />}
      {showDice && <DiceRoller onClose={() => setShowDice(false)} />}
      {showTableSettings && (
        <TableSettingsSheet
          // Every tier has a size to set (user, 2026-09-25: permanents read
          // small on a phone). Below 1024px the hand keeps its own size, so
          // the hint names only what follows.
          zoom={{
            value: zoom,
            min: ZOOM_MIN,
            max: ZOOM_MAX,
            step: ZOOM_STEP,
            hint: isNarrow ? 'Your hand keeps its own size.' : 'The = and − keys step it too.',
            onZoom: setZoomTo,
          }}
          skin={{
            felt,
            onFelt: (id) => {
              setFelt(id);
              writeFelt(id);
            },
          }}
          toggles={settingsToggles}
          links={settingsLinks}
          onClose={() => setShowTableSettings(false)}
        />
      )}
      {showShortcuts && (
        <ShortcutsSheet
          overrides={shortcutOverrides}
          onChange={changeShortcuts}
          onClose={() => setShowShortcuts(false)}
        />
      )}

      {showResistancePicker && (
        <ResistancePicker
          level={resistanceLevel}
          options={resistanceOptions}
          bracket={deck ? (effectiveBracket(deck) ?? null) : null}
          onSave={(level, options) => {
            // Options first: re-arming at a new level reads them from the
            // store, and a level that didn't change keeps its opponent.
            setResistanceOptions(options);
            if (level !== resistanceLevel) setResistanceLevel(level);
          }}
          onClose={() => setShowResistancePicker(false)}
        />
      )}

      {countersBf && (
        <CustomCountersDialog
          cardName={countersBf.card.name}
          counters={countersBf.counters}
          onApply={(deltas) => {
            for (const [counter, delta] of Object.entries(deltas))
              dispatch({ type: 'SET_COUNTER', cardId: countersBf.card.id, counter, delta });
            setCountersFor(null);
          }}
          onClose={() => setCountersFor(null)}
        />
      )}

      {showDesignations && (
        <DesignationsPicker
          monarch={state.monarch}
          initiative={state.initiative}
          citysBlessing={state.citysBlessing}
          onSet={handleSetDesignation}
          onClose={() => setShowDesignations(false)}
        />
      )}

      {showTakebackSettings && (
        <TakebackModePicker
          mode={takeback.mode}
          onSelect={takeback.setMode}
          onClose={() => setShowTakebackSettings(false)}
          online={onlineTable !== null}
        />
      )}

      {(phase !== 'playing' || openingOnline) && (
        <OpeningHandSheet
          phase={phase}
          online={openingOnline}
          horde={
            onlineTable
              ? undefined
              : {
                  label: horde
                    ? `Horde: ${horde.config.hordeName}, ${hordeLevelLabel(horde.config.level)}`
                    : 'Fight a horde',
                  desc: horde
                    ? `${horde.config.hordeName}, ${hordeLevelLabel(horde.config.level)}. ${hordeStatusText(horde, state.turn)}.`
                    : 'A deck that plays itself attacks you every turn.',
                  onOpen: () => setShowHordeSetup(true),
                }
          }
          hand={state.zones.hand}
          mulliganCount={mulliganCount}
          cardsOwedToBottom={cardsToBottom(
            effectiveMulliganType(freeMulligan, tableMulliganType),
            mulliganCount
          )}
          tableMulligan={onlineMulliganType ? MULLIGAN_TABLE_NOTE[onlineMulliganType] : undefined}
          cardLookup={cardLookup}
          deckName={deck?.name}
          freeMulligan={freeMulligan}
          onFreeMulliganChange={setFreeMulligan}
          onDraw={onDraw}
          onOnDrawChange={setOnDraw}
          exitLabel={backLabel}
          onExit={
            onBack ?? (() => navigate(playtestDeckId ? `/decks/${playtestDeckId}` : '/decks'))
          }
          onKeep={keepOpeningHand}
          onMulligan={mulliganOpeningHand}
          onConfirmBottom={finalizeBottom}
        />
      )}

      {/* Solo Horde (E387 PR 5) — a horde never exists at an online table.
          Mounted AFTER `OpeningHandSheet`, not before it: both use the same
          `.card-picker-root` overlay layer, and that layer has no z-index
          ordering of its own — later in the DOM paints (and receives
          pointer events) on top. The setup sheet opens FROM the opening-hand
          takeover's own row, so it has to out-rank the takeover it was
          opened from, the same way a sheet opened from within a component
          (e.g. this file's own CardPreview, mounted last in its return)
          always sits after its opener. Mounted before this comment once,
          which put "Fight the horde" under the takeover and ate the click. */}
      <BoardHordeSheets
        onlineTable={onlineTable}
        onlineHorde={onlineHorde}
        onlineHordeView={onlineHordeView}
        onlineHordeOutcome={onlineHordeOutcome}
        onlineHordePendingReveal={onlineHordePendingReveal}
        horde={horde}
        hordeLoad={hordeLoad}
        hordeDeckCardNames={hordeDeckCardNames}
        hordeFeltRef={hordeFeltRef}
        showHordeSetup={showHordeSetup}
        resistanceOn={resistanceLevel !== 'off'}
        hordeCardMenuId={hordeCardMenuId}
        hordeDamageOpen={hordeDamageOpen}
        turn={state.turn}
        dispatch={dispatch}
        disarmHorde={disarmHorde}
        confirmHordeReveal={confirmHordeReveal}
        leaveTable={leaveTable}
        withHordeActions={withHordeActions}
        onCloseSetup={() => setShowHordeSetup(false)}
        onCloseCardMenu={() => setHordeCardMenuId(null)}
        onCloseDamage={() => setHordeDamageOpen(false)}
      />

      {showStats && (
        <PlaytestStatsSheet
          state={state}
          deck={deck}
          cardLookup={cardLookup}
          mulliganCount={mulliganCount}
          onClose={() => setShowStats(false)}
        />
      )}

      {showGameMenu && (
        <GameMenuSheet
          sections={gameMenuSections}
          footer={gameMenuFooter}
          onClose={() => setShowGameMenu(false)}
        />
      )}

      {/* Ending the table is the host saying the game is over, so it records a
          result: the same winner picker /play ends a game with. */}
      {endingTable && onlineTable && (
        <EndGameDialog
          game={{ players: onlineTable.players }}
          onCancel={() => setEndingTable(false)}
          onConfirm={(winnerSeat) => {
            setEndingTable(false);
            onlineTable.dispatch({ type: 'end', winnerSeat });
            navigate('/play');
          }}
        />
      )}

      {showLog && isNarrow && (
        <PlaytestLogSheet
          log={gameLog}
          table={
            onlineTable
              ? {
                  items: onlineTicker,
                  nameFor: (seat) => tickerSeatName(onlineTable, seat),
                }
              : undefined
          }
          onClose={() => setShowLog(false)}
        />
      )}

      <RotatePrompt fullscreen={isFullscreen} />

      {confirmDialog}
    </div>
  );
}
