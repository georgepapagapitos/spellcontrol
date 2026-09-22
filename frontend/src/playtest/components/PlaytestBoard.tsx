import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Eraser,
  Flag,
  Gavel,
  Keyboard,
  LayoutGrid,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  RotateCcw,
  Rows3,
  ScrollText,
  Settings,
} from 'lucide-react';
import { useConfirm } from '@/lib/use-confirm';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';
import type {
  Designation,
  LibraryReveal,
  ManaColor,
  PlaytestCard,
  PlaytestState,
  Zone,
} from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore } from '@/store/decks';
import { effectiveMulliganType, usePlaytestStore } from '../store';

/** The table's mulligan rule, said once in the opening-hand takeover. Same
 *  three variants as the lobby's own picker (`MULLIGAN_TYPES`). */
/**
 * How long the seat on turn has been on it, under the turn number. Shown only
 * when the table turned the timer on in the lobby — it is a readout, never a
 * limit: nothing expires and nobody is forced to pass. Ticks off the wall
 * clock (`useNow`) rather than game state, so a table thinking hard still
 * sees the number move.
 */
function TurnTimer({ startedAt }: { startedAt: number }) {
  const now = useNow(true);
  return (
    <span className="playtest-turn-chip__clock" aria-label="Time on this turn">
      {formatClock(Math.max(0, now - startedAt))}
    </span>
  );
}

const MULLIGAN_TABLE_NOTE: Record<MulliganType, string> = {
  commander: 'Table rule: the first mulligan is free.',
  london: 'Table rule: London mulligans.',
  free: 'Table rule: free mulligans. Nothing goes to the bottom.',
};
import { useNarrowViewport } from '../hooks/use-narrow-viewport';
import { applyTableSkin, readFelt, writeFelt } from '../lib/table-skin';
import { useTurnSweep } from '../hooks/use-turn-sweep';
import { useTablePointer } from '../hooks/use-table-pointer';
import { useHoverTarget } from '../hooks/use-hover-target';
import { useTablePings } from '../hooks/use-table-pings';
import { TablePings } from './TablePings';
import { StackPanel, type StackPanelItem } from './StackPanel';
import { isTypingTarget, useRegisterShortcuts } from '@/lib/shortcut-registry';
import { useOnlineTable } from '../hooks/use-online-table';
import { usePlayStore } from '@/store/play';
import { useTakeback } from '../hooks/use-takeback';
import { OpponentRail } from './OpponentRail';
import {
  OpenSeatQuadrant,
  OpponentQuadrant,
  MAX_GRID_OPPONENTS,
  TABLE_GRID_QUERY,
  opponentPreviewId,
} from './OpponentQuadrant';
import { OpponentBoardModal } from './OpponentBoardModal';
import { TableMoments } from './TableMoments';
import { TriggerReminder, type TriggerCard } from './TriggerReminder';
import { matchTriggers } from '../lib/triggers';
import { TableTicker, TableTickerDock, tickerSeatName } from './TableTicker';
import { TakebackModePicker } from './TakebackModePicker';
import { TakebackPendingBanner } from './TakebackPendingBanner';
import { TakebackConsentPrompt } from './TakebackConsentPrompt';
import { toast } from '@/store/toasts';
import { autoPlace } from '../lib/auto-place';
import { makePlaytestCollision } from '../lib/attach-drop';
import { handSlotFromDroppableId, hostFromDroppableId } from '../lib/zones';
import { haptics } from '@/lib/haptics';
import { suppressNativeContextMenu } from '@/lib/suppress-context-menu';
import { cachedCardThumb } from '@/lib/card-thumbs';
import { Battlefield } from './Battlefield';
import { Hand } from './Hand';
import { HandCardMenu } from './HandCardMenu';
import { CardHoverPreview } from './CardHoverPreview';
import { HandDrawer, SHORT_LANDSCAPE_QUERY } from './HandDrawer';
import { useMediaQuery } from '@/lib/use-media-query';
import { ZonePile } from './ZonePile';
import { ZoneViewerModal } from './ZoneViewerModal';
import { TableContextMenu, type TableMenuItem } from './TableContextMenu';
import { LogDock } from './LogDock';
import { Modal } from '@/components/Modal';
import { EndGameDialog } from '@/components/play/EndGameDialog';
import { useRulesReferenceStore } from '@/store/rules-reference';
import { GameMenuSheet, type GameMenuSection } from './GameMenuSheet';
import { cardsToBottom, GAME_PHASES, type MulliganType } from '@/lib/game-state';
import { formatClock } from '@/lib/game-clock';
import { useNow } from '@/lib/use-now';
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
import { TableSettingsSheet, type SettingLink } from './TableSettingsSheet';
import { TableArrows } from './TableArrows';
import { PhaseChip } from '@/components/play/PhaseChip';
import { ReactionPicker } from './ReactionPicker';
import { HoldButton } from './HoldButton';
import { HoldBanner } from './HoldBanner';
import { TableSignals } from './TableSignals';
import { TAKEBACK_MODE_LABEL } from '../lib/takeback';
import { REACTION_EMOTES } from '../lib/table-signals';
import { CardContextMenu, type CardMenuPage } from './CardContextMenu';
import { CardInfoDialog } from './CardInfoDialog';
import { MobileZonesPanel } from './MobileZonesPanel';
import { CountPage } from './CountPage';
import { OpeningHandSheet } from './OpeningHandSheet';
import { PlaytestCardFace } from './PlaytestCardFace';
import { ScrySheet } from './ScrySheet';
import { TokenCreator } from './TokenCreator';
import { DiceRoller } from './DiceRoller';
import { PlaytestStatsSheet } from './PlaytestStatsSheet';
import { PlaytestLogSheet } from './PlaytestLogSheet';
import { ResistanceBanner } from './ResistanceBanner';
import { ResistancePicker } from './ResistancePicker';
import { DesignationsPicker } from './DesignationsPicker';
import { RESISTANCE_LEVEL_ANNOUNCE, RESISTANCE_LEVEL_LABEL } from '../lib/resistance';
import { PlaytestSessionSummary } from './PlaytestSessionSummary';
import { resolveTokenArt } from '../lib/token-art';
import { commanderTaxAmount, MOVE_DESTINATIONS, ZONE_VIEWER_LABEL } from '../lib/zones';
import { LifeStrip } from './LifeStrip';
import { ManaPool } from './ManaPool';
import { useSealMoment } from '@/components/shared/SealMoment';

interface Props {
  state: PlaytestState;
  /** B6-04: rendered as a compact "back" control folded into the ActionBar's
   *  own row, shown only in the short-landscape tier — the standalone
   *  `.playtest-page__header` this duplicates is a full 44px+ touch-target
   *  row on its own, and hiding it there is the single highest-leverage way
   *  to keep the battlefield at a usable height without shrinking any
   *  control below its 44px floor. Optional so PlaytestBoard's existing
   *  tests (no header context) don't need to supply it. */
  backLabel?: string;
  onBack?(): void;
}

type ViewerMode = { zone: Zone } | null;
type ContextState = { cardId: string; x: number; y: number; page?: CardMenuPage } | null;
type HandMenuState = { cardId: string; x: number; y: number } | null;

// Backfill for a session snapshot saved before the mana pool existed —
// `state.manaPool` is optional for exactly that reason (see types.ts).
const ZERO_MANA_POOL: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/** Desktop-density card box — matches playtest.css's base `--pt-card-w`/
 *  `--pt-card-h`. Used only as a fallback when the battlefield hasn't
 *  mounted yet (can't read the live custom property). */
const FALLBACK_CARD_W = 90;
const FALLBACK_CARD_H = 126;
/** Near-top-left placement used when a drop lands on the battlefield but
 *  dnd-kit couldn't report a translated rect (e.g. a keyboard-sensor drop) —
 *  the fraction-space analogue of the old fixed `x: 40, y: 40` pixel default. */
/** Stable empty roster: a fresh `[]` per render would re-run every memo that
 *  depends on the opponent list on every render of a solo board. */
const NO_OPPONENTS: readonly [] = [];

const FALLBACK_DROP_POS = { x: 0.05, y: 0.05 };

/** B6-16: the desktop keydown handler below is the actual implementation —
 *  this just makes those shortcuts discoverable via the app's `?` overlay. */
/** The two keys the binding table doesn't own: they open menus, not actions. */
const FIXED_SHORTCUTS = [
  { keys: ['Shift+Enter'], description: 'Open the focused card’s menu' },
  { keys: ['Shift+F10'], description: 'Open the table menu' },
];

function parseDraggable(id: string): { source: 'bf' | 'hand' | 'zone'; cardId: string } | null {
  const m = /^(bf|hand|zone):(.+)$/.exec(id);
  if (!m) return null;
  return { source: m[1] as 'bf' | 'hand' | 'zone', cardId: m[2] };
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
  const lastResistanceEvent = usePlaytestStore((s) => s.lastResistanceEvent);
  const lastSessionRecord = usePlaytestStore((s) => s.lastSessionRecord);
  const lastSessionAggregates = usePlaytestStore((s) => s.lastSessionAggregates);
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
  // cmd-<scryfallId> for commanders).
  const cardLookup = useMemo(() => {
    if (!deck) return undefined;
    const map = new Map<string, ScryfallCard>();
    deck.cards.forEach((slot, i) => {
      map.set(`${slot.slotId}#${i}`, slot.card);
    });
    if (deck.commander) map.set(`cmd-${deck.commander.id}`, deck.commander);
    if (deck.partnerCommander) map.set(`cmd-${deck.partnerCommander.id}`, deck.partnerCommander);
    return map;
  }, [deck]);

  const { confirm, dialog: confirmDialog } = useConfirm();

  const battlefieldRef = useRef<HTMLDivElement | null>(null);
  // Short landscape (E264): the hand collapses to a 44px drawer strip so the
  // battlefield keeps its height; `handOpen` is the drawer's sheet.
  const shortLandscape = useMediaQuery(SHORT_LANDSCAPE_QUERY);
  const [handOpen, setHandOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerMode>(null);
  const [ctx, setCtx] = useState<ContextState>(null);
  const [handMenu, setHandMenu] = useState<HandMenuState>(null);
  // "View information" on a battlefield permanent or a card in hand — one
  // card, read in a centered dialog (`CardInfoDialog`). Browsing a whole zone
  // is still the shared `CardPreview` carousel (OpeningHandSheet /
  // ZoneViewerModal); a single card is not a carousel.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
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
  // Card size on the wide tier: a multiplier on the density-driven card box,
  // persisted per device and applied on <body> (where `--pt-card-w` lives so
  // the drag overlay inherits it). 1 is the density the tier computes.
  const [zoom, setZoom] = useState(() => readZoom());
  useEffect(() => {
    document.body.style.setProperty('--pt-zoom', String(zoom));
    return () => {
      document.body.style.removeProperty('--pt-zoom');
    };
  }, [zoom]);
  const stepZoom = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const next =
        Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + dir * ZOOM_STEP)) * 10) / 10;
      writeZoom(next);
      return next;
    });
  }, []);
  const setZoomTo = useCallback((z: number) => {
    const next = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
    writeZoom(next);
    setZoom(next);
  }, []);
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
  const [pileMenu, setPileMenu] = useState<{ zone: Zone; x: number; y: number } | null>(null);
  const [manaOpen, setManaOpen] = useState(false);
  // Bumped to open the online ReactionPicker from the table menu.
  const [reactionToken, setReactionToken] = useState(0);
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
  const isNarrow = useNarrowViewport();
  // How this device's table looks (E347): a per-device preference, like card
  // size — it never leaves the device and nothing about it is published.
  const [felt, setFelt] = useState(readFelt);
  useEffect(() => applyTableSkin(felt), [felt]);
  /** A mouse (and therefore a right-click and a keyboard) is driving the
   *  board — the one place a click can mean "select" without stranding a
   *  player who has no other way to tap a permanent. */
  const mouseDriven = useMediaQuery('(hover: hover) and (pointer: fine)');
  // The conditional multiplayer seam (see use-online-table.ts): non-null only
  // when there's an active online game AND this device holds a seat in it.
  // Publishes `state` internally; solo playtest never touches it beyond this
  // one hook call, and null here means the rail below never renders.
  const onlineTable = useOnlineTable(state);
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
  const gridFits = !isNarrow && opponents.length > 0 && opponents.length <= MAX_GRID_OPPONENTS;
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
  const activeDrag = useMemo(() => {
    const parsed = activeId ? parseDraggable(activeId) : null;
    if (!parsed) return null;
    if (parsed.source === 'bf') {
      const bf = state.battlefield.find((b) => b.card.id === parsed.cardId);
      return bf ? { card: bf.card, bf, size: 'md' as const } : null;
    }
    if (parsed.source === 'hand') {
      const c = state.zones.hand.find((card) => card.id === parsed.cardId);
      return c ? { card: c, bf: undefined, size: 'sm' as const } : null;
    }
    return null;
  }, [activeId, state.battlefield, state.zones.hand]);

  // Any card the pointer could be dragging — battlefield or hand — by id,
  // so the collision function can tell an Aura from a creature.
  const collisionDetection = useMemo(
    () =>
      makePlaytestCollision(
        (id) =>
          state.battlefield.find((b) => b.card.id === id)?.card ??
          state.zones.hand.find((c) => c.id === id)
      ),
    [state.battlefield, state.zones.hand]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const parsed = parseDraggable(String(event.active.id));
    if (!parsed) return;
    const overId = event.over?.id ? String(event.over.id) : null;

    // Arranging the hand: one hand card dropped onto another takes its place.
    const slotId = handSlotFromDroppableId(overId);
    if (slotId && parsed.source === 'hand') {
      const toIndex = state.zones.hand.findIndex((c) => c.id === slotId);
      if (toIndex >= 0) {
        dispatch({ type: 'REORDER_HAND', cardId: parsed.cardId, toIndex });
        haptics.tap();
      }
      return;
    }

    const hostId = hostFromDroppableId(overId);
    if (hostId) {
      // Drag-to-attach (Aura / Equipment / Fortification — see attach-drop.ts).
      // From hand: cast it straight onto the creature — enter the battlefield,
      // then attach; the reducer snaps it to the host.
      if (parsed.source === 'hand') {
        setHandOpen(false);
        dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, ...FALLBACK_DROP_POS });
      }
      dispatch({ type: 'ATTACH', cardId: parsed.cardId, targetId: hostId });
      haptics.tap();
      return;
    }

    if (parsed.source === 'bf') {
      if (overId === 'battlefield' || overId === null) {
        const bf = state.battlefield.find((b) => b.card.id === parsed.cardId);
        if (!bf) return;
        // event.delta is a pixel pointer delta; bf.x/y are fractions of the
        // battlefield box, so convert through the same (container - card)
        // denominator the renderer's `left: calc(x * (100% - cardW))` uses.
        const { width, height, cardW, cardH } = getBattlefieldGeometry();
        const x = bf.x + event.delta.x / Math.max(1, width - cardW);
        const y = bf.y + event.delta.y / Math.max(1, height - cardH);
        dispatch({ type: 'MOVE_BF_POSITION', cardId: parsed.cardId, x, y });
        return;
      }
      const zoneMatch = /^zone:(.+)$/.exec(overId);
      if (overId === 'hand') {
        dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to: 'hand' });
      } else if (zoneMatch) {
        dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to: zoneMatch[1] as Zone });
      }
      return;
    }

    if (overId === 'battlefield') {
      // A card dragged out of the short-landscape hand sheet: the play is the
      // dismissal, same as a tap.
      if (parsed.source === 'hand') setHandOpen(false);
      const { width, height, left, top, cardW, cardH } = getBattlefieldGeometry();
      const translated = event.active.rect.current.translated;
      if (width > 0 && translated) {
        const x = (translated.left - left) / Math.max(1, width - cardW);
        const y = (translated.top - top) / Math.max(1, height - cardH);
        dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, x, y });
      } else {
        dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, ...FALLBACK_DROP_POS });
      }
      return;
    }

    if (overId === 'hand') {
      dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to: 'hand' });
      return;
    }
    const zoneMatch = overId ? /^zone:(.+)$/.exec(overId) : null;
    if (zoneMatch) {
      dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to: zoneMatch[1] as Zone });
    }
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
  // has neither key nor right-click, so on a touch device a tap still taps.
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
      // A plain click with a mouse says nothing beyond the ring it just put
      // round the card: it leaves the selection exactly as it found it, so a
      // stray click can neither tap a permanent nor throw away a box you
      // spent a gesture building.
      if (mouseDriven) return;
      setSelected((prev) => (prev.size === 0 ? prev : new Set()));
      dispatch({ type: 'TAP', cardId });
    },
    [dispatch, selectMode, arrowFrom, onlineTable, finishArrow, ping, mouseDriven]
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

  const handleCardLongPress = useCallback((cardId: string, x: number, y: number) => {
    setCtx({ cardId, x, y });
  }, []);

  const openTableMenu = useCallback((x: number, y: number) => setTableMenu({ x, y }), []);

  // Single read of "how big is the board, how big is a card right now" —
  // `--pt-card-w`/`--pt-card-h` are the density-driving custom properties
  // (playtest.css), so this stays correct across the 320–1440px range without
  // the caller needing to know which breakpoint is active. Falls back to the
  // desktop density before the battlefield has mounted.
  // The positioned surface is inset `--pt-edge` on each side of the wrap
  // this ref measures (playtest.css: room for a tapped card's rotation), so
  // the width and left edge here are the wrap's minus that inset — the box
  // the cards' `left: calc(x * (100% - w))` actually resolves against.
  function getBattlefieldGeometry() {
    const el = battlefieldRef.current;
    const rect = el?.getBoundingClientRect();
    const cs = el ? getComputedStyle(el) : null;
    const cardW = parseFloat(cs?.getPropertyValue('--pt-card-w') ?? '') || FALLBACK_CARD_W;
    const cardH = parseFloat(cs?.getPropertyValue('--pt-card-h') ?? '') || FALLBACK_CARD_H;
    const edge = Math.max(0, (cardH - cardW) / 2);
    return {
      width: rect ? Math.max(0, rect.width - 2 * edge) : 0,
      height: rect?.height ?? 0,
      left: (rect?.left ?? 0) + edge,
      top: rect?.top ?? 0,
      cardW,
      cardH,
    };
  }

  function getBattlefieldRect() {
    const { width, height, cardW, cardH } = getBattlefieldGeometry();
    if (!(width > 0 && height > 0)) return null;
    // At the table tier the hand fan and the zone piles float OVER the board's
    // bottom edge, so auto-placement has to keep that band clear or a freshly
    // played land lands under the fan. One card height plus the fan's own
    // chrome ≈ 1.3 card heights; narrow keeps its rows beside the board and
    // reserves nothing.
    const reservedBottom = Math.min(0.5, (cardH * 1.3) / height);
    // And the life panel floats over the top-left: the first permanent used
    // to land straight under it. Its box is ~1.1 card heights tall.
    const reservedTop = Math.min(0.3, (cardH * 1.1) / height);
    return { width, height, cardW, cardH, reservedBottom, reservedTop };
  }

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

  function handleHandCardClick(cardId: string) {
    playFromHand(cardId);
  }

  // Image per card instance for the hover preview — the DOM carries only ids.
  const previewSrcs = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of state.battlefield) {
      const src = b.showBackFace && b.card.backImageUrl ? b.card.backImageUrl : b.card.imageUrl;
      if (src && !b.faceDown) m.set(b.card.id, src);
    }
    for (const c of state.zones.hand) if (c.imageUrl) m.set(c.id, c.imageUrl);
    return m;
  }, [state.battlefield, state.zones.hand]);
  // The opponents' permanents, by the seat-scoped id their quadrant publishes
  // as `data-preview-id`. Names, not URLs: `PublicBoard` never carries image
  // URLs (projection.ts), so the quadrant resolves art through the shared CDN
  // cache and this reads the same cache back. Safe to read synchronously
  // because `resolve` runs at POINTER time, long after the card painted.
  const opponentPreviewNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const opp of opponents) {
      for (const bf of opp.board.battlefield) {
        if (bf.faceDown || !bf.card.name) continue;
        m.set(opponentPreviewId(opp.board.seat, bf.card.id), bf.card.name);
      }
    }
    return m;
  }, [opponents]);
  const resolvePreview = useCallback(
    (cardId: string) => {
      const opponentCard = opponentPreviewNames.get(cardId);
      if (opponentCard) return cachedCardThumb(opponentCard, 'normal') ?? null;
      return previewSrcs.get(cardId) ?? null;
    },
    [opponentPreviewNames, previewSrcs]
  );

  const handleHandCardMenu = useCallback((cardId: string, x: number, y: number) => {
    setHandMenu({ cardId, x, y });
  }, []);
  const handMenuCard = handMenu ? state.zones.hand.find((c) => c.id === handMenu.cardId) : null;
  const revealedIds = useMemo(() => new Set(state.revealed ?? []), [state.revealed]);
  // Every card of the deck behind this session, for the token picker's
  // "Deck tokens" grid. Commanders included — a commander is as likely to
  // be the thing making tokens as anything in the ninety-nine.
  const deckTokenSources = useMemo(() => {
    if (!deck) return [];
    const out = deck.cards.map((slot) => slot.card);
    if (deck.commander) out.push(deck.commander);
    if (deck.partnerCommander) out.push(deck.partnerCommander);
    return out;
  }, [deck]);
  const stackIdSet = useMemo(() => new Set(state.stack ?? []), [state.stack]);

  const ctxCard = ctx ? state.battlefield.find((b) => b.card.id === ctx.cardId) : null;
  // Candidate hosts exclude the card itself and its current host (re-attaching
  // to where it already is would be a no-op menu entry).
  const attachTargets = ctxCard
    ? state.battlefield
        .filter((b) => b.card.id !== ctxCard.card.id && b.card.id !== ctxCard.attachedTo)
        .map((b) => ({ id: b.card.id, name: b.card.name }))
    : [];
  const attachedHostName = ctxCard?.attachedTo
    ? state.battlefield.find((b) => b.card.id === ctxCard.attachedTo)?.card.name
    : undefined;

  const anySheetOpen =
    phase !== 'playing' ||
    handOpen ||
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
    setShowLog(true);
  }, [gameLog]);

  // ── Shared board actions ────────────────────────────────────────────────
  // One implementation behind each of the three ways to reach it: the table
  // menu's item, the corner cluster's button, and the key binding. A control
  // that only exists in one of those is how the old bar's actions went
  // unreachable when the bar stopped rendering.
  const activeName = onlineTable?.players.find((p) => p.seat === onlineTable.activeSeat)?.name;
  const myTurn = onlineTable !== null && onlineTable.activeSeat === onlineTable.mySeat;
  const canPassTurn = onlineTable !== null && (myTurn || onlineTable.activeSeat === null);
  /** Is there a turn to move on at all? Always, solo — there is nobody to
   *  wait for. */
  const canAdvanceTurn = onlineTable === null || canPassTurn;

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
    const ok = await confirm({
      title: 'Leave the table?',
      body: 'You give up your seat. If you host, the table ends for everyone.',
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
        dispatch({ type: 'ADJUST_LIFE', player: 'self', delta });
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
    if (onlineTable) {
      if (!canPassTurn) return false;
      doPassTurn();
      return true;
    }
    doNextTurn();
    return true;
  }, [onlineTable, canPassTurn, doPassTurn, doNextTurn]);

  const advancePhase = useCallback(() => {
    if (!onlineTable) return;
    const cur = onlineTable.phase;
    const next = cur === undefined ? GAME_PHASES[0] : GAME_PHASES[GAME_PHASES.indexOf(cur) + 1];
    if (!next) return;
    onlineTable.dispatch({ type: 'phase', phase: next, actorSeat: onlineTable.mySeat });
  }, [onlineTable]);

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
  const stackItems: StackPanelItem[] = useMemo(() => {
    const mine: StackPanelItem[] = (stackIds ?? []).flatMap((id) => {
      const bf = state.battlefield.find((b) => b.card.id === id);
      if (!bf) return [];
      return [
        {
          id,
          name: bf.card.name,
          imageUrl:
            bf.showBackFace && bf.card.backImageUrl ? bf.card.backImageUrl : bf.card.imageUrl,
          manaCost: bf.card.manaCost,
          isToken: bf.card.isToken === true,
          seat: onlineTable?.mySeat ?? null,
          seatName: onlineTable ? 'You' : undefined,
          mine: true,
        },
      ];
    });
    if (!onlineTable) return mine;
    const theirs: StackPanelItem[] = [];
    for (const opp of onlineTable.opponents) {
      for (const id of opp.board.stack ?? []) {
        const bf = opp.board.battlefield.find((b) => b.card.id === id);
        if (!bf || bf.faceDown) continue;
        theirs.push({
          id: opponentPreviewId(opp.board.seat, id),
          name: bf.card.name ?? 'A spell',
          // An opponent's board never carries image URLs (projection.ts) —
          // the art comes back out of the shared CDN cache by name.
          imageUrl: bf.card.name
            ? (cachedCardThumb(bf.card.name, 'normal') ?? undefined)
            : undefined,
          isToken: bf.card.isToken === true,
          seat: opp.board.seat,
          seatName: opp.name,
          mine: false,
        });
      }
    }
    return [...mine, ...theirs];
  }, [stackIds, state.battlefield, onlineTable]);

  /**
   * Mark cards as waiting to resolve. A card still in hand is played first
   * — "casting" it — because the stack only ever names permanents in play.
   */
  const putOnStack = useCallback(
    (cardIds: readonly string[]) => {
      const usable = cardIds.filter(
        (id) =>
          state.battlefield.some((b) => b.card.id === id) ||
          state.zones.hand.some((c) => c.id === id)
      );
      if (usable.length === 0) return false;
      for (const cardId of usable) {
        const handCard = state.zones.hand.find((c) => c.id === cardId);
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
    (cardIds: readonly string[], op: 'inc' | 'dec' | 'double') => {
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

  /** Open the counters UI for one card — the card menu's Counters page, which
   *  is where counters already live, rather than a second panel that does the
   *  same job. Anchored at the card itself, since a key has no cursor. */
  const openCounters = useCallback((cardId: string) => {
    const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
    const r = el?.getBoundingClientRect();
    setCtx({
      cardId,
      x: r ? r.left + r.width / 2 : window.innerWidth / 2,
      y: r ? r.top + r.height / 2 : window.innerHeight / 2,
      page: 'counters',
    });
    return true;
  }, []);

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
  const triggerCards = useMemo<TriggerCard[]>(() => {
    if (!cardLookup) return [];
    const out: TriggerCard[] = [];
    for (const bf of state.battlefield) {
      if (bf.faceDown || bf.phased) continue;
      const sc = cardLookup.get(bf.card.id);
      if (!sc) continue;
      const faces = sc.card_faces;
      const text = bf.showBackFace
        ? (faces?.[1]?.oracle_text ?? sc.oracle_text)
        : (sc.oracle_text ?? faces?.[0]?.oracle_text);
      const hits = matchTriggers(text);
      if (hits.length > 0) out.push({ id: bf.card.id, name: bf.card.name, hits });
    }
    return out;
  }, [cardLookup, state.battlefield]);

  /** Bring one card into view and select it, so a name in the reminder leads
   *  to the permanent it names. Selection, not a ping: a ping is a table
   *  signal, and your own bookkeeping is nobody else's business. */
  const locateCard = useCallback((cardId: string) => {
    setSelected(new Set([cardId]));
    document
      .querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

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
    [state.zones]
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

  // Table-defeated moment (E138): the goldfish payoff — every opponent flips
  // to defeated. Fires only on the false→true transition observed while
  // mounted (a `prev === null` first render, e.g. resuming an
  // already-defeated snapshot, never fires) — mirrors DeckDisplay's
  // deck-complete guard. RESET clears `tableDefeatedTurn` back to null, so a
  // fresh game can legitimately earn the celebration again.
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  const tableDefeatedTurn = state.tableDefeatedTurn;
  const [showTableDefeatedBanner, setShowTableDefeatedBanner] = useState(false);
  const prevTableDefeatedRef = useRef<number | null>(tableDefeatedTurn);
  useEffect(() => {
    if (prevTableDefeatedRef.current === null && tableDefeatedTurn !== null) {
      setShowTableDefeatedBanner(true);
      haptics.eliminate();
      const colors = [
        ...new Set([
          ...(deck?.commander?.color_identity ?? []),
          ...(deck?.partnerCommander?.color_identity ?? []),
        ]),
      ];
      fireSealMoment(colors);
    }
    prevTableDefeatedRef.current = tableDefeatedTurn;
  }, [tableDefeatedTurn, deck, fireSealMoment]);

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
        'next-turn': doNextTurn,
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
        'size-up': () =>
          bfTargets.length > 0 ? stepCounter('+1/+1') : isNarrow ? false : stepZoom(1),
        'size-down': () =>
          bfTargets.length > 0 ? stepCounter('-1/-1') : isNarrow ? false : stepZoom(-1),
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
  const openingOnline = onlineTable
    ? {
        waitingOn: onlineTable.opponents
          .filter((o) => o.board.keptHand !== true)
          .map((o) => o.name),
        allKept:
          onlineTable.opponents.length > 0 &&
          onlineTable.opponents.every((o) => o.board.keptHand === true),
      }
    : undefined;

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
    {
      label: 'Resistance',
      value: RESISTANCE_LEVEL_LABEL[resistanceLevel],
      onOpen: () => {
        setShowTableSettings(false);
        setShowResistancePicker(true);
      },
    },
    {
      label: 'Designations',
      value: heldDesignations.length > 0 ? heldDesignations.join(', ') : 'None',
      onOpen: () => {
        setShowTableSettings(false);
        setShowDesignations(true);
      },
    },
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
  const tableMenuItems: TableMenuItem[] = [
    canPassTurn
      ? { label: 'Pass turn', shortcut: keyFor('pass-turn'), onClick: doPassTurn }
      : { label: 'Next turn', shortcut: keyFor('next-turn'), onClick: doNextTurn },
    { label: 'Untap all', shortcut: keyFor('untap-all'), onClick: doUntapAll },
    {
      label: manaOpen ? 'Hide mana pool' : 'Mana pool',
      shortcut: keyFor('mana'),
      onClick: () => setManaOpen((open) => !open),
    },
    { label: 'Create token', shortcut: keyFor('token'), onClick: () => setTokenCreator(true) },
    { label: 'Roll dice', shortcut: keyFor('dice'), onClick: () => setShowDice(true) },
    { label: selectMode ? 'Done selecting' : 'Select cards', onClick: toggleSelectMode },
    {
      label: takebackBadge ? `Take back (${takebackBadge})` : 'Take back',
      shortcut: keyFor('undo'),
      onClick: handleTakebackClick,
      disabled: takeback.mode === 'off' || takeback.verdict === 'none',
    },
    ...(onlineTable ? [{ label: 'Reactions', onClick: () => setReactionToken((t) => t + 1) }] : []),
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
        opponents={state.opponents}
        commanderDamageThreshold={state.commanderDamageThreshold}
        isNarrow={isNarrow}
        monarch={state.monarch}
        initiative={state.initiative}
        citysBlessing={state.citysBlessing}
        playerCounters={state.playerCounters ?? {}}
        onAdjustLife={(player, delta) => {
          haptics.tap();
          dispatch({ type: 'ADJUST_LIFE', player, delta });
        }}
        onAdjustCommanderDamage={(opponent, delta) => {
          haptics.tap();
          dispatch({ type: 'ADJUST_COMMANDER_DAMAGE', opponent, delta });
        }}
        onAdjustCounter={(player, kind, delta) => {
          haptics.tap();
          dispatch({ type: 'SET_PLAYER_COUNTER', player, counter: kind, delta });
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
      {showTableDefeatedBanner && lastSessionRecord ? (
        // The richer E141 recap supersedes the plain "Table defeated" line —
        // it already names the kill turn plus mulligans/interaction survived.
        <PlaytestSessionSummary
          key={lastSessionRecord.id}
          record={lastSessionRecord}
          aggregates={lastSessionAggregates}
          onDismiss={() => setShowTableDefeatedBanner(false)}
        />
      ) : showTableDefeatedBanner ? (
        <ResistanceBanner
          key={`table-defeated-${tableDefeatedTurn}`}
          message={`Table defeated: turn ${tableDefeatedTurn}`}
          onDismiss={() => setShowTableDefeatedBanner(false)}
        />
      ) : lastSessionRecord && lastSessionRecord.id !== dismissedSessionRecordId ? (
        // A Reset-triggered session end (no table defeat) still gets a recap.
        <PlaytestSessionSummary
          key={lastSessionRecord.id}
          record={lastSessionRecord}
          aggregates={lastSessionAggregates}
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
    <div className="playtest-corner playtest-corner--tr">
      <button
        type="button"
        className="playtest-corner-btn"
        aria-label="Game menu"
        title="Game menu"
        aria-haspopup="dialog"
        aria-expanded={showGameMenu}
        onClick={() => setShowGameMenu(true)}
      >
        <Menu width={20} height={20} aria-hidden />
        {hasUnreadLog && <span className="playtest-corner__dot" aria-hidden />}
      </button>
      {/* The turn count IS the control: pressing it moves the game on, the
          same thing Space does. A "Next turn" button sitting beside a turn
          counter was two pieces of chrome saying one thing. When it is not
          your turn there is nothing to press, so it degrades to a readout
          that says whose turn it is instead. */}
      {canAdvanceTurn ? (
        <button
          type="button"
          className="playtest-turn-chip playtest-turn-chip--action"
          onClick={advanceTurn}
          aria-label={[
            onlineTable ? 'Pass the turn' : 'Next turn',
            `turn ${state.turn}`,
            keyFor('pass-turn'),
          ]
            .filter(Boolean)
            .join(', ')}
        >
          <span className="playtest-turn-chip__label" aria-hidden>
            Turn
          </span>
          <span className="playtest-turn-chip__value" aria-hidden>
            {state.turn}
          </span>
          {onlineTable?.turnTimerEnabled && onlineTable.turnStartedAt != null && (
            <TurnTimer startedAt={onlineTable.turnStartedAt} />
          )}
        </button>
      ) : (
        <div className="playtest-turn-chip" aria-live="polite">
          <span className="playtest-turn-chip__label">
            {activeName ? `${activeName}'s turn` : 'Turn'}
          </span>
          <span className="playtest-turn-chip__value">{state.turn}</span>
          {onlineTable?.turnTimerEnabled && onlineTable.turnStartedAt != null && (
            <TurnTimer startedAt={onlineTable.turnStartedAt} />
          )}
        </div>
      )}
      {onlineTable && (
        <PhaseChip
          phase={onlineTable.phase}
          activeSeat={onlineTable.activeSeat}
          mySeat={onlineTable.mySeat}
          dispatch={onlineTable.dispatch}
        />
      )}
      {/* Both self-gate on an online, seated game (see their own docs). */}
      <ReactionPicker openToken={reactionToken} />
      <HoldButton />
      <HoldBanner />
      {/* Take back and Select used to sit here too. Both are in the table
          menu (right-click) and on their own keys, and neither is reached
          often enough to hold a permanent button over the felt — the corner
          keeps the one control you press every turn. A pending takeback is
          the exception: while the table is deciding, it is the only thing
          you want to see. */}
      {takeback.pendingRequest && (
        <span className="playtest-corner-waiting" aria-live="polite">
          Take back: waiting for the table
        </span>
      )}
      {selectMode && (
        <button
          type="button"
          className="playtest-corner-btn is-active"
          onClick={toggleSelectMode}
          aria-pressed
          title="Stop selecting"
        >
          Done
          {selected.size > 0 && <span className="playtest-corner-btn__badge">{selected.size}</span>}
        </button>
      )}
      <TableSignals />
    </div>
  );

  /**
   * Empty this whole zone into another. Every destination the card menu's
   * "Move to" offers, minus the zone the cards are already in — and minus
   * the battlefield, which `MOVE_DESTINATIONS` already leaves out and which
   * has no sensible layout for N cards landing at once.
   */
  const moveAllItems = (from: Zone): TableMenuItem[] =>
    MOVE_DESTINATIONS.filter((d) => d.key !== from).map((d) => {
      // Everyone watched these cards go in, so a block that keeps its order
      // would hand the caster a known deck order. The row says so, because
      // "my graveyard is now the top of my library, in order" is a very
      // different promise from what actually happens.
      const random = d.key === 'library';
      return {
        label: random ? `${d.label}, random order` : d.label,
        onClick: () =>
          dispatch({ type: 'MOVE_ALL_TO', from, to: d.key, toIndex: d.toIndex, random }),
      };
    });

  /**
   * A pile's menu. Every action that belongs to a zone lives here, on the
   * zone, reachable by right-click, the Context Menu key or the tile's
   * kebab — they used to be spread across the game menu and the table menu,
   * which is how both grew past reading. Rows print their key, so the menu
   * is also where the library's shortcuts are discovered.
   */
  const pileMenuItems = (zone: Zone): TableMenuItem[] => {
    const empty = state.zones[zone].length === 0;
    const moveAll = { label: 'Move all to', items: moveAllItems(zone), disabled: empty };
    if (zone !== 'library') {
      return [
        {
          label: `View the ${zone === 'command' ? 'command zone' : zone}`,
          onClick: () => setViewer({ zone }),
          disabled: empty,
        },
        ...(zone === 'graveyard' || zone === 'exile'
          ? [
              {
                label: 'Select a random card',
                onClick: () => void peekZone('random', zone),
                disabled: empty,
              },
              {
                label: 'Shuffle into the library',
                onClick: () => dispatch({ type: 'SHUFFLE_ZONE_INTO_LIBRARY', zone }),
                disabled: empty,
              },
            ]
          : []),
        moveAll,
      ];
    }

    /** Set the standing reveal, or clear it by picking the mode it is in. */
    const setReveal = (reveal: LibraryReveal) => () =>
      dispatch({
        type: 'SET_LIBRARY_REVEAL',
        reveal: libraryReveal === reveal ? 'none' : reveal,
      });

    return [
      { label: 'Draw a card', shortcut: keyFor('draw'), onClick: doDraw, disabled: empty },
      {
        label: 'Draw several',
        disabled: empty,
        content: (
          <CountPage
            max={libraryCount}
            initial={2}
            label={(n) => `Draw ${n} card${n === 1 ? '' : 's'}`}
            onConfirm={(n) => {
              setPileMenu(null);
              dispatch({ type: 'DRAW', n });
            }}
          />
        ),
      },
      {
        // Bulk mill and bulk exile: take N off the top without looking at
        // them one by one, which is what the scry sheet behind View is for.
        label: 'Move top cards to',
        disabled: empty,
        items: [
          {
            label: 'Graveyard',
            content: (
              <CountPage
                max={libraryCount}
                label={(n) => `Mill ${n} card${n === 1 ? '' : 's'}`}
                onConfirm={(n) => {
                  setPileMenu(null);
                  dispatch({ type: 'MOVE_TOP_N', n, to: 'graveyard' });
                }}
              />
            ),
          },
          {
            label: 'Exile',
            content: (
              <CountPage
                max={libraryCount}
                label={(n) => `Exile ${n} card${n === 1 ? '' : 's'}`}
                onConfirm={(n) => {
                  setPileMenu(null);
                  dispatch({ type: 'MOVE_TOP_N', n, to: 'exile' });
                }}
              />
            ),
          },
          {
            label: 'Exile face down',
            content: (
              <CountPage
                max={libraryCount}
                label={(n) => `Exile ${n} card${n === 1 ? '' : 's'} face down`}
                onConfirm={(n) => {
                  setPileMenu(null);
                  dispatch({ type: 'MOVE_TOP_N', n, to: 'exile', faceDown: true });
                }}
              />
            ),
          },
        ],
      },
      {
        // Five ways of looking, grouped rather than spent as five rows on the
        // root — the keys are the ones the board already listens for.
        label: 'View',
        disabled: empty,
        items: [
          { label: 'Top card', onClick: () => void peekZone('top') },
          { label: 'Bottom card', onClick: () => void peekZone('bottom') },
          {
            // The sheet picks the mode (scry / surveil / mill) and the count,
            // so the row stays generic — a fixed "Scry 3" would mislead.
            label: 'Top X cards',
            shortcut: keyFor('scry'),
            onClick: () => {
              setScryFrom('top');
              setShowScry(true);
            },
          },
          {
            label: 'Bottom X cards',
            shortcut: keyFor('scry-bottom'),
            onClick: () => {
              setScryFrom('bottom');
              setShowScry(true);
            },
          },
          {
            label: 'All',
            shortcut: keyFor('view-library'),
            onClick: () => setViewer({ zone: 'library' }),
          },
        ],
      },
      {
        label: 'Shuffle',
        shortcut: keyFor('shuffle'),
        onClick: () => dispatch({ type: 'SHUFFLE_LIBRARY' }),
      },
      { label: 'Select a random card', onClick: () => void peekZone('random'), disabled: empty },
      // Showing something to the table needs a table. Solo, every "Everyone"
      // is an audience of nobody, so the one-shot reveals are not offered at
      // all and the standing one collapses to its private half.
      ...(onlineTable
        ? [
            {
              label: 'Reveal top card',
              disabled: empty,
              items: [
                {
                  // One-shot, and an event rather than a mode: the ticker
                  // line naming the card is the whole of it.
                  label: 'Everyone',
                  onClick: () => dispatch({ type: 'REVEAL_TOP_CARD' }),
                },
                { label: 'Me', onClick: () => void peekZone('top') },
              ],
            },
            {
              // No "Me": you can already read your own library with All.
              label: 'Reveal library',
              disabled: empty,
              items: [
                { label: 'Everyone', pressed: libraryReveal === 'all', onClick: setReveal('all') },
              ],
            },
            {
              label: 'Play with top revealed',
              disabled: empty,
              items: [
                { label: 'Everyone', pressed: libraryReveal === 'top', onClick: setReveal('top') },
                { label: 'Me', pressed: libraryReveal === 'top-me', onClick: setReveal('top-me') },
              ],
            },
          ]
        : [
            {
              // Solo this is simply "keep my top card face up", so it is the
              // private mode and a plain toggle rather than a choice of
              // audience. It stays private if this seat later joins a table.
              label: 'Play with top revealed',
              pressed: libraryReveal === 'top-me',
              onClick: setReveal('top-me'),
              disabled: empty,
            },
          ]),
      moveAll,
    ];
  };

  const openPileMenu = (zone: Zone) => (x: number, y: number) => setPileMenu({ zone, x, y });

  /* Which piles stand on the felt, and which live behind the edge tab. Four
     card-width tiles plus a hand do not fit a phone, and the two that earn
     the room are the ones you touch every turn: the library (its click
     draws) and the graveyard. Exile and the command zone are a tap away in
     the tab — the same split EDHPlay makes, for the same reason. Every width
     above the phone has room for all four. */
  const piles = (
    <aside className="playtest-piles">
      <ZonePile
        zone="library"
        label="Library"
        cards={state.zones.library}
        // The library's click draws. It is the one pile with an action taken
        // often enough to own the click outright, which is what frees the
        // menu to hold everything else (and what EDHPlay does, so the habit
        // players arrive with is the right one here).
        click={{ label: 'Draw a card', onClick: doDraw, disabled: libraryCount === 0 }}
        onMenu={openPileMenu('library')}
        revealTop={libraryReveal === 'top' || libraryReveal === 'top-me'}
      />
      <ZonePile
        zone="graveyard"
        label="Graveyard"
        cards={state.zones.graveyard}
        click={{ label: 'View the graveyard', onClick: () => setViewer({ zone: 'graveyard' }) }}
        onMenu={openPileMenu('graveyard')}
      />
      {!isNarrow && (
        <>
          <ZonePile
            zone="exile"
            label="Exile"
            cards={state.zones.exile}
            click={{ label: 'View exile', onClick: () => setViewer({ zone: 'exile' }) }}
            onMenu={openPileMenu('exile')}
          />
          <ZonePile
            zone="command"
            label="Command"
            cards={state.zones.command}
            commanderTax={state.commanderTax}
            click={{
              label: 'View the command zone',
              onClick: () => setViewer({ zone: 'command' }),
            }}
            onMenu={openPileMenu('command')}
            // Clicking a commander casts it. It is the command zone's one
            // obvious action (the viewer's primary is already "Cast"), and
            // with partners the pile cannot guess which of the two you meant
            // — so the choice IS the click. The reducer bumps that
            // commander's own tax.
            onCastCommander={(card) => {
              const pos = placeOnBattlefield(card);
              dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: card.id, x: pos.x, y: pos.y });
            }}
          />
        </>
      )}
    </aside>
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
      {sealMoment}
      {/* All three portal to <body> (see their own doc comments) so placement
          here only decides conditional gating, not layout. */}
      {onlineTable && <TakebackConsentPrompt onlineTable={onlineTable} />}
      {onlineTable && <TableMoments onlineTable={onlineTable} />}
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
          <button type="button" className="btn" onClick={() => setArrowFrom(null)}>
            Cancel
          </button>
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
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div
          className={`playtest-main${gridMode ? ' playtest-main--grid' : ''}${
            gridMode && opponents.length === 1 ? ' playtest-main--seats-2' : ''
          }`}
        >
          {onlineTable && !gridMode && (
            <OpponentRail
              opponents={onlineTable.opponents}
              activeSeat={onlineTable.activeSeat ?? undefined}
            >
              <TableTicker onlineTable={onlineTable} />
            </OpponentRail>
          )}
          {/* Grid order is the table's seating: your own board is bottom-left,
              so with two seats the single opponent sits beside you and with
              three or four the others fill the row above. */}
          {gridMode && opponents.length > 1 && opponents.slice(0, 2).map(renderQuadrant)}
          <div
            ref={battlefieldRef}
            className={`playtest-battlefield-wrap${myTurn ? ' is-my-turn' : ''}`}
            data-seat-anchor={onlineTable?.mySeat}
          >
            <Battlefield
              cards={state.battlefield}
              selectedIds={selected}
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
                {!shortLandscape && (
                  <Hand
                    cards={state.zones.hand}
                    fan
                    reorderable
                    onCardClick={handleHandCardClick}
                    onCardMenu={handleHandCardMenu}
                    revealedIds={revealedIds}
                  />
                )}
              </>
            }
          </div>
          {gridMode &&
            (opponents.length === 1
              ? opponents.map(renderQuadrant)
              : opponents.slice(2).map(renderQuadrant))}
          {gridMode && opponents.length === 2 && <OpenSeatQuadrant />}
        </div>
        {shortLandscape && (
          <HandDrawer
            cards={state.zones.hand}
            open={handOpen}
            onOpen={() => setHandOpen(true)}
            onClose={() => setHandOpen(false)}
            onCardClick={handleHandCardClick}
            onCardMenu={handleHandCardMenu}
            revealedIds={revealedIds}
          />
        )}
        <CardHoverPreview suspended={activeId !== null || anySheetOpen} resolve={resolvePreview} />
        {/* Above `--z-overlay` so a card dragged out of the hand sheet renders
            over the sheet, not behind it. */}
        <DragOverlay dropAnimation={null} zIndex={1200}>
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
          above the table log toggle, and they stack with flexbox rather than
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
              onClose={() => setShowLog(false)}
            />
          )}
          {onlineTable && <TableTickerDock onlineTable={onlineTable} />}
        </div>
      )}

      {tableMenu && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          variant={isNarrow ? 'sheet' : 'floating'}
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
          variant={isNarrow ? 'sheet' : 'floating'}
          title={ZONE_VIEWER_LABEL[pileMenu.zone]}
          items={pileMenuItems(pileMenu.zone)}
          onClose={() => setPileMenu(null)}
        />
      )}

      {isNarrow && (
        <MobileZonesPanel
          zones={state.zones}
          commanderTax={state.commanderTax}
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

      {ctx && ctxCard && (
        <CardContextMenu
          x={ctx.x}
          y={ctx.y}
          libraryCount={libraryCount}
          cardName={ctxCard.card.name}
          stickers={ctxCard.stickers}
          counters={ctxCard.counters}
          // Every other permanent is a candidate host; the reducer additionally
          // rejects anything that would close an attachment cycle.
          attachTargets={attachTargets}
          attachedToName={attachedHostName}
          onAttach={(targetId) => {
            dispatch({ type: 'ATTACH', cardId: ctx.cardId, targetId });
            setCtx(null);
          }}
          tax={commanderTaxAmount(state.commanderTax, ctxCard.card.id)}
          onPreview={
            cardLookup?.has(ctxCard.card.id)
              ? () => {
                  setPreviewCardId(ctxCard.card.id);
                  setCtx(null);
                }
              : undefined
          }
          canTransform={Boolean(ctxCard.card.backImageUrl)}
          tapped={ctxCard.tapped}
          faceDown={ctxCard.faceDown}
          phased={ctxCard.phased ?? false}
          variant={isNarrow ? 'sheet' : 'floating'}
          initialPage={ctx.page}
          keyFor={keyFor}
          onClose={() => setCtx(null)}
          // Every action here reads the selection the same way the copy does:
          // open the menu on a card that is part of it and the menu is the
          // selection's menu, which is what the "N cards selected" heading
          // says. Open it on a card outside the selection and it is that
          // card's menu alone.
          onTap={() => {
            if (selected.has(ctx.cardId) && selected.size > 1) tapSelection();
            else dispatch({ type: 'TAP', cardId: ctx.cardId });
            setCtx(null);
          }}
          onFlip={() => {
            dispatch({ type: 'FLIP_FACE', cardId: ctx.cardId });
            setCtx(null);
          }}
          onTransform={() => {
            dispatch({ type: 'TRANSFORM', cardId: ctx.cardId });
            setCtx(null);
          }}
          onTogglePhased={() => {
            haptics.tap();
            dispatch({ type: 'TOGGLE_PHASED', cardId: ctx.cardId });
            setCtx(null);
          }}
          // Acting on a card that's part of the live selection copies the
          // whole selection — otherwise just the card you opened the menu on.
          selectionSize={selected.has(ctx.cardId) ? selected.size : 1}
          onDuplicate={() => {
            cloneCards(selected.has(ctx.cardId) ? [...selected] : [ctx.cardId]);
            setCtx(null);
          }}
          pt={ctxCard.pt}
          onAdjustPT={(power, toughness) =>
            dispatch({ type: 'ADJUST_PT', cardId: ctx.cardId, power, toughness })
          }
          onDrawArrow={
            onlineTable
              ? () => {
                  beginArrow(new Set([ctx.cardId]));
                  setCtx(null);
                }
              : undefined
          }
          onPutOnStack={(copy) => {
            const ids = selected.has(ctx.cardId) ? [...selected] : [ctx.cardId];
            if (copy) copyOntoStack(ids);
            else putOnStack(ids);
            setCtx(null);
          }}
          onAddCounter={(k) =>
            dispatch({ type: 'SET_COUNTER', cardId: ctx.cardId, counter: k, delta: 1 })
          }
          onAdjustAllCounters={(op) => adjustAllCounters([ctx.cardId], op)}
          onRemoveCounter={(k) =>
            dispatch({ type: 'SET_COUNTER', cardId: ctx.cardId, counter: k, delta: -1 })
          }
          onAddSticker={(text) => dispatch({ type: 'ADD_STICKER', cardId: ctx.cardId, text })}
          onRemoveSticker={(index) =>
            dispatch({ type: 'REMOVE_STICKER', cardId: ctx.cardId, index })
          }
          onMoveTo={(zone, toIndex) => {
            if (selected.has(ctx.cardId) && selected.size > 1) moveSelection(zone, toIndex);
            else dispatch({ type: 'MOVE_TO_ZONE', cardId: ctx.cardId, to: zone, toIndex });
            setCtx(null);
          }}
        />
      )}

      {handMenu && handMenuCard && (
        <HandCardMenu
          x={handMenu.x}
          y={handMenu.y}
          cardName={handMenuCard.name}
          variant={isNarrow ? 'sheet' : 'floating'}
          keyFor={keyFor}
          onClose={() => setHandMenu(null)}
          onPreview={
            cardLookup?.has(handMenu.cardId) ? () => setPreviewCardId(handMenu.cardId) : undefined
          }
          onPlay={(opts) => {
            setHandOpen(false);
            playFromHand(handMenu.cardId, opts);
          }}
          onMoveTo={(zone, toIndex) =>
            dispatch({ type: 'MOVE_TO_ZONE', cardId: handMenu.cardId, to: zone, toIndex })
          }
          revealed={(state.revealed ?? []).includes(handMenu.cardId)}
          onToggleReveal={
            onlineTable
              ? () => dispatch({ type: 'TOGGLE_REVEAL', cardId: handMenu.cardId })
              : undefined
          }
          onPutOnStack={() => putOnStack([handMenu.cardId])}
          onMove={(direction) => {
            const from = state.zones.hand.findIndex((c) => c.id === handMenu.cardId);
            if (from >= 0)
              dispatch({
                type: 'REORDER_HAND',
                cardId: handMenu.cardId,
                toIndex: from + direction,
              });
          }}
          canMoveEarlier={state.zones.hand.findIndex((c) => c.id === handMenu.cardId) > 0}
          canMoveLater={
            state.zones.hand.findIndex((c) => c.id === handMenu.cardId) <
            state.zones.hand.length - 1
          }
        />
      )}

      {previewCardId &&
        cardLookup?.has(previewCardId) &&
        (() => {
          const card = cardLookup.get(previewCardId)!;
          // The permanent behind the inspected card, when it's on the
          // battlefield — the dialog prints its live state (tapped, counters,
          // attachments) between the type line and the card's rules text.
          const bf = state.battlefield.find((b) => b.card.id === previewCardId);
          const host = bf?.attachedTo
            ? state.battlefield.find((b) => b.card.id === bf.attachedTo)?.card.name
            : undefined;
          return (
            <CardInfoDialog
              card={card}
              status={{
                card: bf?.card ?? { id: previewCardId, name: card.name },
                bf,
                attachedToName: host,
                tax: commanderTaxAmount(state.commanderTax, previewCardId),
              }}
              onClose={() => setPreviewCardId(null)}
            />
          );
        })()}

      {tokenCreator && (
        <TokenCreator
          deckCards={deckTokenSources}
          onClose={() => setTokenCreator(false)}
          onCreate={({ name, typeLine, imageUrl }) => {
            const id = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const tokenCard: PlaytestCard = {
              id,
              name,
              isToken: true,
              // Carried through so auto-placement puts a creature token in
              // the creature row rather than guessing from the name.
              ...(typeLine !== undefined && { typeLine }),
              ...(imageUrl !== undefined && { imageUrl }),
            };
            const { x, y } = placeOnBattlefield(tokenCard);
            dispatch({ type: 'CREATE_TOKEN', card: tokenCard, x, y });
            setTokenCreator(false);
            // A token picked from the grid already brought its art. Only a
            // name typed by hand needs resolving, and that never blocks the
            // token appearing — the placeholder renders immediately and the
            // art swaps in when (if) it lands.
            if (imageUrl) return;
            void resolveTokenArt(name).then((url) => {
              if (url) dispatch({ type: 'SET_CARD_IMAGE', cardId: id, imageUrl: url });
            });
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

      {peek && (
        <Modal
          onClose={() => setPeek(null)}
          labelledBy="playtest-peek-title"
          className="playtest-peek"
        >
          <h2 id="playtest-peek-title" className="playtest-peek__title">
            {peek.where === 'top'
              ? 'Top of library'
              : peek.where === 'bottom'
                ? 'Bottom of library'
                : 'Random card selected'}
          </h2>
          {/* Looking at an end of the library moves nothing — that is the
              whole point of this over the scry sheet. A RANDOM card is a
              different job: the effects that pick one (a discard, an exile)
              then do something to it, so that one offers somewhere to put
              it and "Put back" as the way out. */}
          <PlaytestCardFace card={peek.card} size="lg" />
          <p className="playtest-peek__name">{peek.card.name}</p>
          {peek.where === 'random' ? (
            <div className="playtest-peek__moves">
              <span className="playtest-peek__moves-label" id="playtest-peek-moves">
                Move to
              </span>
              <div
                className="playtest-peek__moves-row"
                role="group"
                aria-labelledby="playtest-peek-moves"
              >
                {(['hand', 'battlefield', 'graveyard', 'exile'] as const).map((to) => (
                  <button
                    key={to}
                    type="button"
                    className="btn"
                    onClick={() => {
                      const card = peek.card;
                      setPeek(null);
                      if (to === 'battlefield') {
                        const pos = placeOnBattlefield(card);
                        dispatch({
                          type: 'MOVE_TO_BATTLEFIELD',
                          cardId: card.id,
                          x: pos.x,
                          y: pos.y,
                        });
                      } else {
                        dispatch({ type: 'MOVE_TO_ZONE', cardId: card.id, to });
                      }
                    }}
                  >
                    {to === 'hand'
                      ? 'Hand'
                      : to === 'battlefield'
                        ? 'Battlefield'
                        : to === 'graveyard'
                          ? 'Graveyard'
                          : 'Exile'}
                  </button>
                ))}
              </div>
              <button type="button" className="btn" onClick={() => setPeek(null)}>
                {/* Nothing moved to undo — the card never left its pile. */}
                {peek.zone === 'library' ? 'Put back' : 'Leave it'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setPeek(null)}>
              Done
            </button>
          )}
        </Modal>
      )}
      {showDice && <DiceRoller onClose={() => setShowDice(false)} />}
      {showTableSettings && (
        <TableSettingsSheet
          // The narrow tier sizes cards for a thumb; only the wide tier has a
          // size to set (this slider, or = and − on the keys).
          zoom={
            isNarrow
              ? undefined
              : { value: zoom, min: ZOOM_MIN, max: ZOOM_MAX, step: ZOOM_STEP, onZoom: setZoomTo }
          }
          skin={{
            felt,
            onFelt: (id) => {
              setFelt(id);
              writeFelt(id);
            },
          }}
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
          onSelect={setResistanceLevel}
          onClose={() => setShowResistancePicker(false)}
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

      {confirmDialog}
    </div>
  );
}

// ── Card size (wide tier) ───────────────────────────────────────────────────

const ZOOM_KEY = 'playtest-zoom-v1';
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

function readZoom(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 1;
  } catch {
    return 1;
  }
}

function writeZoom(zoom: number): void {
  try {
    if (zoom === 1) localStorage.removeItem(ZOOM_KEY);
    else localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    // A remembered size is a convenience, never a requirement.
  }
}
