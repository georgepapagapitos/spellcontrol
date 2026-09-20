import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
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
import type { Designation, ManaColor, PlaytestCard, PlaytestState, Zone } from '@/lib/playtest';
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
import { useTurnSweep } from '../hooks/use-turn-sweep';
import { useTablePointer } from '../hooks/use-table-pointer';
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
import { TableTicker, tickerSeatName } from './TableTicker';
import { TakebackModePicker } from './TakebackModePicker';
import { TakebackPendingBanner } from './TakebackPendingBanner';
import { TakebackConsentPrompt } from './TakebackConsentPrompt';
import { toast } from '@/store/toasts';
import { autoPlace } from '../lib/auto-place';
import { makePlaytestCollision } from '../lib/attach-drop';
import { hostFromDroppableId } from '../lib/zones';
import { haptics } from '@/lib/haptics';
import { cachedCardThumb } from '@/lib/card-thumbs';
import { Battlefield } from './Battlefield';
import { Hand } from './Hand';
import { HandCardMenu } from './HandCardMenu';
import { CardHoverPreview } from './CardHoverPreview';
import { HandDrawer, SHORT_LANDSCAPE_QUERY } from './HandDrawer';
import { useMediaQuery } from '@/lib/use-media-query';
import { ZonePile } from './ZonePile';
import { ZoneViewerModal } from './ZoneViewerModal';
import { ActionBar } from './ActionBar';
import { TableContextMenu, type TableMenuItem } from './TableContextMenu';
import { LogDock } from './LogDock';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
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
import { TableSettingsSheet } from './TableSettingsSheet';
import { TableArrows } from './TableArrows';
import { PhaseChip } from '@/components/play/PhaseChip';
import { ReactionPicker } from './ReactionPicker';
import { HoldButton } from './HoldButton';
import { HoldBanner } from './HoldBanner';
import { TableSignals } from './TableSignals';
import { TAKEBACK_MODE_LABEL } from '../lib/takeback';
import { CardContextMenu } from './CardContextMenu';
import { MobileZonesPanel } from './MobileZonesPanel';
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
import { commanderTaxAmount } from '../lib/zones';
import { LifeStrip } from './LifeStrip';
import { ManaPool } from './ManaPool';
import { useSealMoment } from '@/components/shared/SealMoment';
import { CardPreview } from '@/components/CardPreview';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';

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
type ContextState = { cardId: string; x: number; y: number } | null;
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
  const deck = useDecksStore((s) =>
    playtestDeckId ? s.decks.find((d) => d.id === playtestDeckId) : undefined
  );
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
  // B6-07: card previewed from a battlefield permanent's context menu — a
  // single-card CardPreview, same shared component OpeningHandSheet/
  // ZoneViewerModal use.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [tokenCreator, setTokenCreator] = useState(false);
  const [showScry, setShowScry] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // Highest resistance-entry seq seen so far — drives the ActionBar's unread
  // dot; not persisted, a soft nice-to-have that resets on remount.
  const [lastSeenLogSeq, setLastSeenLogSeq] = useState(0);
  const [showDice, setShowDice] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
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
  // The conditional multiplayer seam (see use-online-table.ts): non-null only
  // when there's an active online game AND this device holds a seat in it.
  // Publishes `state` internally; solo playtest never touches it beyond this
  // one hook call, and null here means the rail below never renders.
  const onlineTable = useOnlineTable(state);

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
  const takeback = useTakeback(onlineTable);
  // Desktop seat grid (STYLE_GUIDE "Desktop table with opponents: 2x2, not a
  // rail"): at 1440px and up, an online table with opponents lays every seat
  // out as an equal quadrant instead of a board plus a rail. Capped at three
  // opponents — a 2x2 grid holds four seats, and a fifth would have to hide
  // one, which the rail exists precisely never to do. Below 1440, on phones,
  // and at a five-seat pod, the rail is still the answer.
  const wideTable = useMediaQuery(TABLE_GRID_QUERY);
  const opponents = onlineTable?.opponents ?? NO_OPPONENTS;
  const gridMode =
    !isNarrow && wideTable && opponents.length > 0 && opponents.length <= MAX_GRID_OPPONENTS;
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
  // Modifier-click builds a selection; a plain click is still the tap gesture
  // and drops any selection, so nothing lingers invisibly after you move on.
  const handleCardClick = useCallback(
    (cardId: string, e: React.MouseEvent | React.KeyboardEvent) => {
      // Drawing an arrow: this tap is where it lands, not a tap of the card.
      if (arrowFrom && onlineTable) {
        finishArrow(onlineTable.mySeat, cardId);
        return;
      }
      if (selectMode || e.shiftKey || e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (!next.delete(cardId)) next.add(cardId);
          return next;
        });
        return;
      }
      setSelected((prev) => (prev.size === 0 ? prev : new Set()));
      dispatch({ type: 'TAP', cardId });
    },
    [dispatch, selectMode, arrowFrom, onlineTable, finishArrow]
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

  // Batch actions over the selection (Archidekt/Moxfield `T` parity). Each
  // card is its own reducer step — the takeback trail counts them, which is
  // honest: a "tap all" of five creatures is five taps at the table too.
  const selectedCards = state.battlefield.filter((b) => selected.has(b.card.id));
  const anySelectedUntapped = selectedCards.some((b) => !b.tapped);
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
    (to: Zone) => {
      for (const id of selected) dispatch({ type: 'MOVE_TO_ZONE', cardId: id, to });
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
    const reservedBottom = isNarrow ? 0 : Math.min(0.5, (cardH * 1.3) / height);
    // And the life panel floats over the top-left: the first permanent used
    // to land straight under it. Its box is ~1.1 card heights tall.
    const reservedTop = isNarrow ? 0 : Math.min(0.3, (cardH * 1.1) / height);
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
    showDice ||
    showShortcuts ||
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

  const libraryCount = state.zones.library.length;
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
      title: 'Reset the game?',
      body: 'This clears undo history and returns all cards to the starting state.',
      confirmLabel: 'Reset',
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
  const advancePhase = useCallback(() => {
    if (!onlineTable) return;
    const cur = onlineTable.phase;
    const next = cur === undefined ? GAME_PHASES[0] : GAME_PHASES[GAME_PHASES.indexOf(cur) + 1];
    if (!next) return;
    onlineTable.dispatch({ type: 'phase', phase: next, actorSeat: onlineTable.mySeat });
  }, [onlineTable]);

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
      const hasSelection = selected.size > 0;
      const moveSelectionToLibrary = (top: boolean) => {
        for (const cardId of selected) {
          dispatch({ type: 'MOVE_TO_ZONE', cardId, to: 'library', ...(top ? { toIndex: 0 } : {}) });
        }
        setSelected(new Set());
        haptics.tap();
      };
      const focus = (n: number) => {
        const opp = onlineTable?.opponents[n - 1];
        if (opp) setViewingBoardSeat(opp.board.seat);
      };
      // `false` from a handler means "nothing to act on": the key is left to
      // the browser (so ⌘C over real text still copies text, and Space on a
      // focused button still presses it).
      const handlers: Record<ShortcutId, () => boolean | void> = {
        menu: () => {
          if (arrowFrom) setArrowFrom(null);
          else clearSelection();
        },
        arrow: () => beginArrow(selected),
        'arrows-clear': () => (myArrowCount > 0 ? clearMyArrows() : false),
        shortcuts: () => setShowShortcuts(true),
        'pass-turn': () => {
          if (e.target instanceof HTMLElement && e.target.closest('button')) return false;
          if (!canPassTurn) return false;
          doPassTurn();
        },
        'next-turn': doNextTurn,
        draw: () => (libraryCount === 0 ? false : doDraw()),
        'untap-all': doUntapAll,
        'advance-phase': () => (onlineTable ? advancePhase() : false),
        'life-up': () => adjustMyLife(1),
        'life-down': () => adjustMyLife(-1),
        shuffle: () => dispatch({ type: 'SHUFFLE_LIBRARY' }),
        scry: () => (libraryCount === 0 ? false : setShowScry(true)),
        dice: () => setShowDice(true),
        token: () => setTokenCreator(true),
        mana: () => setManaOpen((open) => !open),
        log: () => (showLog && !isNarrow ? setShowLog(false) : handleOpenLog()),
        undo: handleTakebackClick,
        'select-all': () => {
          if (state.battlefield.length === 0) return false;
          setSelected(new Set(state.battlefield.map((b) => b.card.id)));
          setSelectMode(true);
        },
        'tap-selection': () => (hasSelection ? tapSelection() : false),
        copy: () => (hasSelection ? setClipboard([...selected]) : false),
        paste: () => {
          if (clipboard.length === 0) return false;
          const made = cloneCards(clipboard);
          if (made) setClipboard(made);
        },
        clone: () => (hasSelection ? void cloneCards([...selected]) : false),
        transform: () => {
          if (!hasSelection) return false;
          for (const cardId of selected) dispatch({ type: 'TRANSFORM', cardId });
        },
        'counter-plus': () => {
          if (!hasSelection) return isNarrow ? false : stepZoom(1);
          for (const cardId of selected)
            dispatch({ type: 'SET_COUNTER', cardId, counter: '+1/+1', delta: 1 });
        },
        'counter-minus': () => {
          if (!hasSelection) return isNarrow ? false : stepZoom(-1);
          for (const cardId of selected)
            dispatch({ type: 'SET_COUNTER', cardId, counter: '-1/-1', delta: 1 });
        },
        'to-hand': () => (hasSelection ? moveSelection('hand') : false),
        'to-graveyard': () => (hasSelection ? moveSelection('graveyard') : false),
        'to-exile': () => (hasSelection ? moveSelection('exile') : false),
        'to-library-top': () => (hasSelection ? moveSelectionToLibrary(true) : false),
        'to-library-bottom': () => (hasSelection ? moveSelectionToLibrary(false) : false),
        'focus-1': () => focus(1),
        'focus-2': () => focus(2),
        'focus-3': () => focus(3),
        'focus-4': () => focus(4),
        'focus-5': () => focus(5),
        'focus-6': () => focus(6),
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
    tapSelection,
    moveSelection,
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

  const gameMenuItems: OverflowMenuItem[] = [
    ...(onBack ? [{ label: `Back to ${backLabel ?? 'deck'}`, onClick: onBack }] : []),
    { label: 'Stats', onClick: () => setShowStats(true) },
    { label: hasUnreadLog ? 'Log (new events)' : 'Log', onClick: handleOpenLog },
    { label: 'Top cards', onClick: () => setShowScry(true), disabled: libraryCount === 0 },
    { label: 'Shuffle', onClick: () => dispatch({ type: 'SHUFFLE_LIBRARY' }) },
    {
      label: 'Mulligan',
      onClick: () => {
        haptics.warning();
        dispatch({ type: 'MULLIGAN' });
      },
    },
    {
      label:
        heldDesignations.length > 0
          ? `Designations: ${heldDesignations.join(', ')}`
          : 'Designations',
      onClick: () => setShowDesignations(true),
    },
    {
      label: `Resistance: ${RESISTANCE_LEVEL_LABEL[resistanceLevel]}`,
      onClick: () => setShowResistancePicker(true),
    },
    {
      label: `Takeback rule: ${TAKEBACK_MODE_LABEL[takeback.mode]}`,
      onClick: () => setShowTakebackSettings(true),
    },
    { label: 'Keyboard shortcuts', onClick: () => setShowShortcuts(true) },
    // The narrow tier sizes cards for a thumb; only the wide tier has a size
    // to set (the sheet's slider, or = and − on the keys).
    ...(!isNarrow
      ? [
          {
            label: `Card size: ${Math.round(zoom * 100)}%`,
            onClick: () => setShowTableSettings(true),
          },
        ]
      : []),
    // Fullscreen is offered only where the browser offers it (not inside the
    // native shell, and not in every embedded WebView).
    ...(typeof document !== 'undefined' && document.fullscreenEnabled
      ? [
          {
            label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
            onClick: () => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen();
            },
          },
        ]
      : []),
    { label: 'Reset', onClick: () => void doReset(), danger: true },
    // Online, the table is shared: conceding marks this seat out for everyone
    // and leaving gives the seat up. Both ask first; both are the game's
    // truth, not this device's, so they go through the session.
    ...(onlineTable
      ? [
          ...(myArrowCount > 0
            ? [{ label: `Clear my arrows (${myArrowCount})`, onClick: () => void clearMyArrows() }]
            : []),
          { label: 'Concede', danger: true, onClick: () => void concedeOnline() },
          { label: 'Leave the table', danger: true, onClick: () => void leaveTable() },
        ]
      : []),
  ];

  const tableMenuItems: TableMenuItem[] = [
    { label: 'Draw', shortcut: keyFor('draw'), onClick: doDraw, disabled: libraryCount === 0 },
    canPassTurn
      ? { label: 'Pass turn', shortcut: keyFor('pass-turn'), onClick: doPassTurn }
      : { label: 'Next turn', shortcut: keyFor('next-turn'), onClick: doNextTurn },
    { label: 'Untap all', shortcut: keyFor('untap-all'), onClick: doUntapAll },
    {
      label: 'Top cards',
      shortcut: keyFor('scry'),
      onClick: () => setShowScry(true),
      disabled: libraryCount === 0,
    },
    { label: 'Create token', shortcut: keyFor('token'), onClick: () => setTokenCreator(true) },
    { label: 'Roll dice', shortcut: keyFor('dice'), onClick: () => setShowDice(true) },
    { label: selectMode ? 'Done selecting' : 'Select cards', onClick: toggleSelectMode },
    ...(onlineTable ? [{ label: 'Reactions', onClick: () => setReactionToken((t) => t + 1) }] : []),
    { label: 'Log', shortcut: keyFor('log'), onClick: handleOpenLog },
    {
      label: 'Keyboard shortcuts',
      shortcut: keyFor('shortcuts'),
      onClick: () => setShowShortcuts(true),
    },
  ];

  // Takeback copy, shared with the ActionBar's own (narrow) button.
  const takebackTitle =
    takeback.mode === 'off'
      ? 'Takebacks are off for this game.'
      : takeback.verdict === 'locked'
        ? (takeback.boundaryReason ?? undefined)
        : takeback.verdict === 'none'
          ? 'Nothing to take back yet.'
          : `Take back (${takeback.stepsAvailable} available) (Z)`;
  const takebackBadge =
    takeback.mode === 'off'
      ? 'Off'
      : takeback.verdict === 'locked'
        ? '🔒'
        : takeback.stepsAvailable > 0
          ? String(takeback.stepsAvailable)
          : null;

  // The table tier's mana row, folded into the life panel as its last row.
  // Closed and empty it is nothing at all (six always-zero steppers have no
  // business sitting on the table all game); closed with mana floating it is
  // one "Mana · 3" chip; M or the chip opens the real pool.
  const manaTotal = Object.values(state.manaPool ?? ZERO_MANA_POOL).reduce((a, b) => a + b, 0);
  const manaPool = (
    <ManaPool
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
    <div className={`playtest-trackers${isNarrow ? '' : ' playtest-trackers--corner'}`}>
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
        variant={isNarrow ? 'strip' : 'table'}
        footer={isNarrow ? undefined : manaRow}
      />
      {isNarrow && manaPool}
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
      <OverflowMenu
        items={gameMenuItems}
        ariaLabel="Game menu"
        align="right"
        triggerClassName="playtest-corner-btn"
        panelClassName="playtest-zone-menu-popover"
        trigger={
          <>
            <Menu width={20} height={20} aria-hidden />
            {hasUnreadLog && <span className="playtest-corner__dot" aria-hidden />}
          </>
        }
      />
      <div className="playtest-turn-chip">
        <span className="playtest-turn-chip__label">Turn</span>
        <span className="playtest-turn-chip__value">{state.turn}</span>
        {onlineTable?.turnTimerEnabled && onlineTable.turnStartedAt != null && (
          <TurnTimer startedAt={onlineTable.turnStartedAt} />
        )}
      </div>
      {onlineTable ? (
        canPassTurn ? (
          <button type="button" className="playtest-corner-btn is-primary" onClick={doPassTurn}>
            Pass turn {keyFor('pass-turn') && <kbd>{keyFor('pass-turn')}</kbd>}
          </button>
        ) : (
          <span className="playtest-corner-waiting" aria-live="polite">
            {activeName ? `${activeName}'s turn` : 'Not your turn'}
          </span>
        )
      ) : (
        <button type="button" className="playtest-corner-btn is-primary" onClick={doNextTurn}>
          Next turn {keyFor('next-turn') && <kbd>{keyFor('next-turn')}</kbd>}
        </button>
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
      <button
        type="button"
        className={`playtest-corner-btn${takeback.pendingRequest ? ' is-pending' : ''}`}
        onClick={handleTakebackClick}
        aria-label={takeback.pendingRequest ? 'Take back: waiting for approval' : undefined}
        title={takebackTitle}
      >
        Take back
        {takebackBadge && (
          // The count / lock / "Off" is a glance cue; the button's own title
          // already says the same thing in words, so don't read it twice.
          <span className="playtest-corner-btn__badge" aria-hidden>
            {takebackBadge}
          </span>
        )}
      </button>
      <button
        type="button"
        className={`playtest-corner-btn${selectMode ? ' is-active' : ''}`}
        onClick={toggleSelectMode}
        aria-pressed={selectMode}
        title="Select several cards to act on together"
      >
        {selectMode ? 'Done' : 'Select'}
        {selectMode && selected.size > 0 && (
          <span className="playtest-corner-btn__badge">{selected.size}</span>
        )}
      </button>
      <TableSignals />
    </div>
  );

  const piles = (
    <aside className="playtest-piles">
      <ZonePile
        zone="library"
        label="Library"
        cards={state.zones.library}
        onClick={() => setViewer({ zone: 'library' })}
        action={{ label: 'Draw', shortcut: 'D', onClick: doDraw, disabled: libraryCount === 0 }}
      />
      <ZonePile
        zone="graveyard"
        label="Graveyard"
        cards={state.zones.graveyard}
        onClick={() => setViewer({ zone: 'graveyard' })}
      />
      <ZonePile
        zone="exile"
        label="Exile"
        cards={state.zones.exile}
        onClick={() => setViewer({ zone: 'exile' })}
      />
      <ZonePile
        zone="command"
        label="Command"
        cards={state.zones.command}
        commanderTax={state.commanderTax}
        onClick={() => setViewer({ zone: 'command' })}
      />
    </aside>
  );

  return (
    <div
      className={`playtest-board${isNarrow ? ' playtest-board--narrow' : ''}${
        selectMode ? ' is-selecting' : ''
      }`}
    >
      {isNarrow && (
        <ActionBar
          turn={state.turn}
          libraryCount={libraryCount}
          isNarrow={isNarrow}
          backLabel={backLabel}
          onBack={onBack}
          onDraw={doDraw}
          onShuffle={() => dispatch({ type: 'SHUFFLE_LIBRARY' })}
          onMulligan={() => {
            haptics.warning();
            dispatch({ type: 'MULLIGAN' });
          }}
          onUntapAll={doUntapAll}
          onNextTurn={doNextTurn}
          takeback={{
            stepsAvailable: takeback.stepsAvailable,
            verdict: takeback.verdict,
            mode: takeback.mode,
            boundaryReason: takeback.boundaryReason,
            isPending: takeback.pendingRequest !== null,
            onClick: handleTakebackClick,
            onOpenSettings: () => setShowTakebackSettings(true),
          }}
          onReset={doReset}
          onScry={() => setShowScry(true)}
          onCreateToken={() => setTokenCreator(true)}
          onOpenStats={() => setShowStats(true)}
          onOpenLog={handleOpenLog}
          onOpenDice={() => setShowDice(true)}
          onOpenResistance={() => setShowResistancePicker(true)}
          onOpenDesignations={() => setShowDesignations(true)}
          resistanceLevel={resistanceLevel}
          monarch={state.monarch}
          initiative={state.initiative}
          citysBlessing={state.citysBlessing}
          selectMode={selectMode}
          onToggleSelectMode={toggleSelectMode}
          selectionSize={selected.size}
          hasUnreadLog={hasUnreadLog}
          online={
            onlineTable && {
              phase: onlineTable.phase,
              activeSeat: onlineTable.activeSeat,
              mySeat: onlineTable.mySeat,
              activeName,
              dispatch: onlineTable.dispatch,
              onPassTurn: doPassTurn,
            }
          }
        />
      )}
      {isNarrow && trackers}
      {isNarrow && banners}
      {sealMoment}
      {/* All three portal to <body> (see their own doc comments) so placement
          here only decides conditional gating, not layout. */}
      {onlineTable && <TakebackConsentPrompt onlineTable={onlineTable} />}
      {onlineTable && <TableMoments onlineTable={onlineTable} />}
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
      {isNarrow && pendingBanner}
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
              onBackgroundClick={clearSelection}
              onBackgroundContextMenu={isNarrow ? undefined : openTableMenu}
              onCardClick={handleCardClick}
              onCardContextMenu={handleCardContext}
              onCardLongPress={handleCardLongPress}
            />
            {/* Selection readout. Renders nothing at all when nothing is selected,
            so it never displaces the board — and a selection can only exist on a
            device with modifier keys, which is exactly where the shortcuts it
            names are usable. */}
            {selected.size > 0 && (
              <div className="playtest-selection" role="status">
                <span className="playtest-selection__count">
                  {selected.size} selected
                  {clipboard.length > 0 && ` · ${clipboard.length} copied`}
                </span>
                <button type="button" onClick={tapSelection}>
                  {anySelectedUntapped ? 'Tap' : 'Untap'} <kbd>T</kbd>
                </button>
                <button type="button" onClick={() => moveSelection('graveyard')}>
                  Graveyard
                </button>
                <button type="button" onClick={() => moveSelection('exile')}>
                  Exile
                </button>
                <button type="button" onClick={() => moveSelection('hand')}>
                  Hand
                </button>
                <button type="button" onClick={() => setClipboard([...selected])}>
                  Copy <kbd>Ctrl/⌘C</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const made = cloneCards(clipboard);
                    if (made) setClipboard(made);
                  }}
                  disabled={clipboard.length === 0}
                >
                  Paste <kbd>Ctrl/⌘V</kbd>
                </button>
                <button type="button" onClick={clearSelection}>
                  Clear <kbd>Esc</kbd>
                </button>
              </div>
            )}
            {/* The table tier's four corner clusters, floating over the felt
                rather than taking rows off the board's height. */}
            {!isNarrow && (
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
                <Hand
                  cards={state.zones.hand}
                  fan
                  onCardClick={handleHandCardClick}
                  onCardMenu={handleHandCardMenu}
                />
              </>
            )}
          </div>
          {gridMode &&
            (opponents.length === 1
              ? opponents.map(renderQuadrant)
              : opponents.slice(2).map(renderQuadrant))}
          {gridMode && opponents.length === 2 && <OpenSeatQuadrant />}
        </div>
        {isNarrow &&
          (shortLandscape ? (
            <HandDrawer
              cards={state.zones.hand}
              open={handOpen}
              onOpen={() => setHandOpen(true)}
              onClose={() => setHandOpen(false)}
              onCardClick={handleHandCardClick}
              onCardMenu={handleHandCardMenu}
            />
          ) : (
            <Hand
              cards={state.zones.hand}
              onCardClick={handleHandCardClick}
              onCardMenu={handleHandCardMenu}
            />
          ))}
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

      {/* Non-modal docked log (table tier). The narrow tier keeps the sheet. */}
      {showLog && !isNarrow && (
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

      {tableMenu && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          variant="floating"
          items={tableMenuItems}
          onClose={() => setTableMenu(null)}
        />
      )}

      {isNarrow && (
        <MobileZonesPanel
          zones={state.zones}
          commanderTax={state.commanderTax}
          onOpenZone={(zone) => setViewer({ zone })}
          onShuffleLibrary={() => dispatch({ type: 'SHUFFLE_LIBRARY' })}
          onScry={() => setShowScry(true)}
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
          onClose={() => setCtx(null)}
          onTap={() => {
            dispatch({ type: 'TAP', cardId: ctx.cardId });
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
          onAddCounter={(k) =>
            dispatch({ type: 'SET_COUNTER', cardId: ctx.cardId, counter: k, delta: 1 })
          }
          onRemoveCounter={(k) =>
            dispatch({ type: 'SET_COUNTER', cardId: ctx.cardId, counter: k, delta: -1 })
          }
          onAddSticker={(text) => dispatch({ type: 'ADD_STICKER', cardId: ctx.cardId, text })}
          onRemoveSticker={(index) =>
            dispatch({ type: 'REMOVE_STICKER', cardId: ctx.cardId, index })
          }
          onMoveTo={(zone, toIndex) => {
            dispatch({ type: 'MOVE_TO_ZONE', cardId: ctx.cardId, to: zone, toIndex });
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
        />
      )}

      {previewCardId &&
        cardLookup?.has(previewCardId) &&
        (() => {
          const enriched = scryfallToEnrichedCard(cardLookup.get(previewCardId)!);
          const zoneLabel = state.zones.hand.some((c) => c.id === previewCardId)
            ? 'Hand'
            : 'Battlefield';
          return (
            <CardPreview
              source="playtest"
              cards={[enriched]}
              index={0}
              binderName="Playtest"
              sectionLabels={[zoneLabel]}
              pageNumbers={[1]}
              totalPages={1}
              onIndexChange={() => {}}
              onClose={() => setPreviewCardId(null)}
            />
          );
        })()}

      {tokenCreator && (
        <TokenCreator
          onClose={() => setTokenCreator(false)}
          onCreate={(name) => {
            const id = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const tokenCard: PlaytestCard = { id, name, isToken: true };
            const { x, y } = placeOnBattlefield(tokenCard);
            dispatch({ type: 'CREATE_TOKEN', card: tokenCard, x, y });
            setTokenCreator(false);
            // Never block token creation on the network — the text-box
            // placeholder renders immediately above; art swaps in when (if)
            // it resolves.
            void resolveTokenArt(name).then((imageUrl) => {
              if (imageUrl) dispatch({ type: 'SET_CARD_IMAGE', cardId: id, imageUrl });
            });
          }}
        />
      )}

      {showScry && (
        <ScrySheet
          library={state.zones.library}
          onClose={() => setShowScry(false)}
          onResolve={(resolution) => {
            haptics.tap();
            dispatch({ type: 'RESOLVE_TOP', ...resolution });
          }}
        />
      )}

      {showDice && <DiceRoller onClose={() => setShowDice(false)} />}
      {showTableSettings && (
        <TableSettingsSheet
          zoom={zoom}
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          onZoom={setZoomTo}
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
