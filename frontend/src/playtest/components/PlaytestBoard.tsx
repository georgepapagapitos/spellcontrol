import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { usePlaytestStore } from '../store';
import { useNarrowViewport } from '../hooks/use-narrow-viewport';
import { useOnlineTable } from '../hooks/use-online-table';
import { useTakeback } from '../hooks/use-takeback';
import { OpponentRail } from './OpponentRail';
import { TakebackModePicker } from './TakebackModePicker';
import { TakebackPendingBanner } from './TakebackPendingBanner';
import { TakebackConsentPrompt } from './TakebackConsentPrompt';
import { toast } from '@/store/toasts';
import { autoPlace } from '../lib/auto-place';
import { haptics } from '@/lib/haptics';
import { Battlefield } from './Battlefield';
import { Hand } from './Hand';
import { ZonePile } from './ZonePile';
import { ZoneViewerModal } from './ZoneViewerModal';
import { ActionBar } from './ActionBar';
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
import { RESISTANCE_LEVEL_ANNOUNCE } from '../lib/resistance';
import { PlaytestSessionSummary } from './PlaytestSessionSummary';
import { resolveTokenArt } from '../lib/token-art';
import { commanderTaxAmount } from '../lib/zones';
import { LifeStrip } from './LifeStrip';
import { ManaPool } from './ManaPool';
import { useSealMoment } from '@/components/shared/SealMoment';

interface Props {
  state: PlaytestState;
}

type ViewerMode = { zone: Zone } | null;
type ContextState = { cardId: string; x: number; y: number } | null;

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
const FALLBACK_DROP_POS = { x: 0.05, y: 0.05 };

function parseDraggable(id: string): { source: 'bf' | 'hand' | 'zone'; cardId: string } | null {
  const m = /^(bf|hand|zone):(.+)$/.exec(id);
  if (!m) return null;
  return { source: m[1] as 'bf' | 'hand' | 'zone', cardId: m[2] };
}

export function PlaytestBoard({ state }: Props) {
  const dispatch = usePlaytestStore((s) => s.dispatch);
  const phase = usePlaytestStore((s) => s.phase);
  const mulliganCount = usePlaytestStore((s) => s.mulliganCount);
  const keepOpeningHand = usePlaytestStore((s) => s.keepOpeningHand);
  const mulliganOpeningHand = usePlaytestStore((s) => s.mulliganOpeningHand);
  const finalizeBottom = usePlaytestStore((s) => s.finalizeBottom);
  const freeMulligan = usePlaytestStore((s) => s.freeMulligan);
  const setFreeMulligan = usePlaytestStore((s) => s.setFreeMulligan);
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
  const [viewer, setViewer] = useState<ViewerMode>(null);
  const [ctx, setCtx] = useState<ContextState>(null);
  const [tokenCreator, setTokenCreator] = useState(false);
  const [showScry, setShowScry] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // Highest resistance-entry seq seen so far — drives the ActionBar's unread
  // dot; not persisted, a soft nice-to-have that resets on remount.
  const [lastSeenLogSeq, setLastSeenLogSeq] = useState(0);
  const [showDice, setShowDice] = useState(false);
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
  const takeback = useTakeback(onlineTable);

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
      const { width, height, cardW, cardH } = getBattlefieldGeometry();
      const rect = battlefieldRef.current?.getBoundingClientRect();
      const translated = event.active.rect.current.translated;
      if (rect && translated) {
        const x = (translated.left - rect.left) / Math.max(1, width - cardW);
        const y = (translated.top - rect.top) / Math.max(1, height - cardH);
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
    [dispatch, selectMode]
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

  // Single read of "how big is the board, how big is a card right now" —
  // `--pt-card-w`/`--pt-card-h` are the density-driving custom properties
  // (playtest.css), so this stays correct across the 320–1440px range without
  // the caller needing to know which breakpoint is active. Falls back to the
  // desktop density before the battlefield has mounted.
  function getBattlefieldGeometry() {
    const el = battlefieldRef.current;
    const rect = el?.getBoundingClientRect();
    const cs = el ? getComputedStyle(el) : null;
    const cardW = parseFloat(cs?.getPropertyValue('--pt-card-w') ?? '') || FALLBACK_CARD_W;
    const cardH = parseFloat(cs?.getPropertyValue('--pt-card-h') ?? '') || FALLBACK_CARD_H;
    return { width: rect?.width ?? 0, height: rect?.height ?? 0, cardW, cardH };
  }

  function getBattlefieldRect() {
    const { width, height, cardW, cardH } = getBattlefieldGeometry();
    return width > 0 && height > 0 ? { width, height, cardW, cardH } : null;
  }

  function placeOnBattlefield(card: PlaytestCard) {
    return autoPlace(card, state.battlefield, getBattlefieldRect());
  }

  function handleHandCardClick(cardId: string) {
    const handCard = state.zones.hand.find((c) => c.id === cardId);
    if (!handCard) return;
    const { x, y } = placeOnBattlefield(handCard);
    dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x, y });
  }

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
    viewer !== null ||
    ctx !== null ||
    tokenCreator ||
    showScry ||
    showStats ||
    showLog ||
    showDice ||
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
  function handleOpenLog() {
    setLastSeenLogSeq(gameLog.at(-1)?.seq ?? 0);
    setShowLog(true);
  }

  // City's Blessing is a genuine one-time accomplishment (never lost this
  // game) — a stronger haptic cue than the routine tap monarch/initiative get.
  function handleSetDesignation(designation: Designation, held: boolean) {
    if (designation === 'citysBlessing') haptics.success();
    else haptics.tap();
    dispatch({ type: 'SET_DESIGNATION', designation, held });
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

  // Desktop keyboard shortcuts (Moxfield parity): D draw, N next turn, U untap
  // all, Z / Ctrl+Z undo, Ctrl/⌘+C / +V copy-paste the selection, Esc clears
  // it. Ignored while typing or while any sheet/modal/context menu is open;
  // harmless if it never fires on touch (the context menu's Duplicate is the
  // keyboard-free path to the same clone).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (anySheetOpen || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        clearSelection();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        // Only intercept when there's something to act on, so ⌘C over a real
        // text selection elsewhere on the page still copies text.
        if (key === 'c' && selected.size > 0) {
          e.preventDefault();
          setClipboard([...selected]);
        } else if (key === 'v' && clipboard.length > 0) {
          e.preventDefault();
          const made = cloneCards(clipboard);
          if (made) setClipboard(made);
        }
      }
      if (key === 'z') {
        e.preventDefault();
        handleTakebackClick();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (key === 'd') {
        if (state.zones.library.length === 0) return;
        e.preventDefault();
        dispatch({ type: 'DRAW', n: 1 });
      } else if (key === 'n') {
        e.preventDefault();
        dispatch({ type: 'NEXT_TURN' });
      } else if (key === 'u') {
        e.preventDefault();
        dispatch({ type: 'UNTAP_ALL' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    anySheetOpen,
    handleTakebackClick,
    dispatch,
    state.zones.library.length,
    selected,
    clipboard,
    cloneCards,
    clearSelection,
  ]);

  return (
    <div
      className={`playtest-board${isNarrow ? ' playtest-board--narrow' : ''}${
        selectMode ? ' is-selecting' : ''
      }`}
    >
      <ActionBar
        turn={state.turn}
        libraryCount={state.zones.library.length}
        isNarrow={isNarrow}
        onDraw={() => {
          haptics.tap();
          dispatch({ type: 'DRAW', n: 1 });
        }}
        onShuffle={() => dispatch({ type: 'SHUFFLE_LIBRARY' })}
        onMulligan={() => {
          haptics.warning();
          dispatch({ type: 'MULLIGAN' });
        }}
        onUntapAll={() => dispatch({ type: 'UNTAP_ALL' })}
        onNextTurn={() => dispatch({ type: 'NEXT_TURN' })}
        takeback={{
          stepsAvailable: takeback.stepsAvailable,
          verdict: takeback.verdict,
          mode: takeback.mode,
          boundaryReason: takeback.boundaryReason,
          isPending: takeback.pendingRequest !== null,
          onClick: handleTakebackClick,
          onOpenSettings: () => setShowTakebackSettings(true),
        }}
        onReset={async () => {
          const ok = await confirm({
            title: 'Reset the game?',
            body: 'This clears undo history and returns all cards to the starting state.',
            confirmLabel: 'Reset',
            danger: true,
          });
          if (ok) dispatch({ type: 'RESET' });
        }}
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
      />
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
      />
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
          message={`Table defeated — turn ${tableDefeatedTurn}`}
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
      {sealMoment}
      {/* Both portal to <body> (see their own doc comments) so placement here
          only decides conditional gating, not layout. */}
      {onlineTable && <TakebackConsentPrompt onlineTable={onlineTable} />}
      {takeback.pendingRequest && (
        <TakebackPendingBanner
          request={takeback.pendingRequest}
          onCancel={takeback.cancelPending}
        />
      )}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="playtest-main">
          {onlineTable && (
            <OpponentRail
              opponents={onlineTable.opponents}
              activeSeat={onlineTable.activeSeat ?? undefined}
            />
          )}
          <div ref={battlefieldRef} className="playtest-battlefield-wrap">
            <Battlefield
              cards={state.battlefield}
              selectedIds={selected}
              onBackgroundClick={clearSelection}
              onCardClick={handleCardClick}
              onCardContextMenu={handleCardContext}
              onCardLongPress={isNarrow ? handleCardLongPress : undefined}
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
                <button type="button" onClick={() => setClipboard([...selected])}>
                  Copy <kbd>⌘C</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const made = cloneCards(clipboard);
                    if (made) setClipboard(made);
                  }}
                  disabled={clipboard.length === 0}
                >
                  Paste <kbd>⌘V</kbd>
                </button>
                <button type="button" onClick={clearSelection}>
                  Clear <kbd>Esc</kbd>
                </button>
              </div>
            )}
          </div>
          {!isNarrow && (
            <aside className="playtest-piles">
              <ZonePile
                zone="library"
                label="Library"
                cards={state.zones.library}
                onClick={() => setViewer({ zone: 'library' })}
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
          )}
        </div>
        <Hand cards={state.zones.hand} onCardClick={handleHandCardClick} />
        <DragOverlay dropAnimation={null}>
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
          canTransform={Boolean(ctxCard.card.backImageUrl)}
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
        />
      )}

      {phase !== 'playing' && (
        <OpeningHandSheet
          phase={phase}
          hand={state.zones.hand}
          mulliganCount={mulliganCount}
          cardLookup={cardLookup}
          deckName={deck?.name}
          freeMulligan={freeMulligan}
          onFreeMulliganChange={setFreeMulligan}
          onDraw={onDraw}
          onOnDrawChange={setOnDraw}
          onExit={() => navigate(playtestDeckId ? `/decks/${playtestDeckId}` : '/decks')}
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

      {showLog && <PlaytestLogSheet log={gameLog} onClose={() => setShowLog(false)} />}

      {confirmDialog}
    </div>
  );
}
