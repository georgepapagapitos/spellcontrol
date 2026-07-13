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
import type { PlaytestCard, PlaytestState, Zone } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore } from '@/store/decks';
import { usePlaytestStore } from '../store';
import { useNarrowViewport } from '../hooks/use-narrow-viewport';
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
import { TokenCreator } from './TokenCreator';
import { DiceRoller } from './DiceRoller';
import { PlaytestStatsSheet } from './PlaytestStatsSheet';
import { PlaytestLogSheet } from './PlaytestLogSheet';
import { ResistanceBanner } from './ResistanceBanner';
import { ResistancePicker } from './ResistancePicker';
import { RESISTANCE_LEVEL_ANNOUNCE } from '../lib/resistance';
import { PlaytestSessionSummary } from './PlaytestSessionSummary';
import { resolveTokenArt } from '../lib/token-art';
import { commanderTaxAmount } from '../lib/zones';
import { LifeStrip } from './LifeStrip';
import { useSealMoment } from '@/components/shared/SealMoment';

interface Props {
  state: PlaytestState;
}

type ViewerMode = { zone: Zone; topN?: number } | null;
type ContextState = { cardId: string; x: number; y: number } | null;

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
  const resistanceLevel = usePlaytestStore((s) => s.resistanceLevel);
  const setResistanceLevel = usePlaytestStore((s) => s.setResistanceLevel);
  const lastResistanceEvent = usePlaytestStore((s) => s.lastResistanceEvent);
  const lastSessionRecord = usePlaytestStore((s) => s.lastSessionRecord);
  const lastSessionAggregates = usePlaytestStore((s) => s.lastSessionAggregates);
  const gameLog = usePlaytestStore((s) => s.gameLog);
  const logScryPeek = usePlaytestStore((s) => s.logScryPeek);
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
  const [showStats, setShowStats] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // Highest resistance-entry seq seen so far — drives the ActionBar's unread
  // dot; not persisted, a soft nice-to-have that resets on remount.
  const [lastSeenLogSeq, setLastSeenLogSeq] = useState(0);
  const [showDice, setShowDice] = useState(false);
  const [showResistancePicker, setShowResistancePicker] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lifePanelOpen, setLifePanelOpen] = useState(false);
  // Banner dismissal is tracked by event id so a new opponent response (even
  // with an identical message) re-shows and re-announces the banner.
  const [dismissedResistanceId, setDismissedResistanceId] = useState<number | null>(null);
  // Session-summary dismissal (E141) tracked by record id, same pattern as
  // the resistance banner above — a new record (even an identical-looking
  // one from a later game) re-shows.
  const [dismissedSessionRecordId, setDismissedSessionRecordId] = useState<string | null>(null);
  const isNarrow = useNarrowViewport();

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
        const x = bf.x + event.delta.x;
        const y = bf.y + event.delta.y;
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
      const rect = battlefieldRef.current?.getBoundingClientRect();
      const translated = event.active.rect.current.translated;
      if (rect && translated) {
        const x = translated.left - rect.left;
        const y = translated.top - rect.top;
        dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, x, y });
      } else {
        dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, x: 40, y: 40 });
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
  const handleCardClick = useCallback(
    (cardId: string) => dispatch({ type: 'TAP', cardId }),
    [dispatch]
  );

  const handleCardContext = useCallback((cardId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setCtx({ cardId, x: e.clientX, y: e.clientY });
  }, []);

  const handleCardLongPress = useCallback((cardId: string, x: number, y: number) => {
    setCtx({ cardId, x, y });
  }, []);

  function getBattlefieldRect() {
    return battlefieldRef.current?.getBoundingClientRect() ?? null;
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

  const canUndo = state.past.length > 0;
  const anySheetOpen =
    phase !== 'playing' ||
    viewer !== null ||
    ctx !== null ||
    tokenCreator ||
    showStats ||
    showLog ||
    showDice ||
    showResistancePicker ||
    lifePanelOpen ||
    Boolean(confirmDialog);

  // Scry/peek has no reducer action of its own (it's just the library viewer
  // opened with a topN) — log it explicitly alongside opening the viewer.
  function handleScry() {
    logScryPeek();
    setViewer({ zone: 'library', topN: 3 });
  }

  const hasUnreadLog = gameLog.some((e) => e.kind === 'resistance' && e.seq > lastSeenLogSeq);
  function handleOpenLog() {
    setLastSeenLogSeq(gameLog.at(-1)?.seq ?? 0);
    setShowLog(true);
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
  // all, Z / Ctrl+Z undo. Ignored while typing or while any sheet/modal/context
  // menu is open; harmless if it never fires on touch.
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
      if (key === 'z') {
        e.preventDefault();
        if (canUndo) dispatch({ type: 'UNDO' });
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
  }, [anySheetOpen, canUndo, dispatch, state.zones.library.length]);

  return (
    <div className={`playtest-board${isNarrow ? ' playtest-board--narrow' : ''}`}>
      <ActionBar
        turn={state.turn}
        libraryCount={state.zones.library.length}
        isNarrow={isNarrow}
        canUndo={canUndo}
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
        onUndo={() => {
          haptics.tap();
          dispatch({ type: 'UNDO' });
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
        onScry={handleScry}
        onCreateToken={() => setTokenCreator(true)}
        onOpenStats={() => setShowStats(true)}
        onOpenLog={handleOpenLog}
        onOpenDice={() => setShowDice(true)}
        onOpenResistance={() => setShowResistancePicker(true)}
        resistanceLevel={resistanceLevel}
        hasUnreadLog={hasUnreadLog}
      />
      <LifeStrip
        life={state.life}
        opponents={state.opponents}
        commanderDamageThreshold={state.commanderDamageThreshold}
        isNarrow={isNarrow}
        onAdjustLife={(player, delta) => {
          haptics.tap();
          dispatch({ type: 'ADJUST_LIFE', player, delta });
        }}
        onAdjustCommanderDamage={(opponent, delta) => {
          haptics.tap();
          dispatch({ type: 'ADJUST_COMMANDER_DAMAGE', opponent, delta });
        }}
        onOpenChange={setLifePanelOpen}
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
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="playtest-main">
          <div ref={battlefieldRef} className="playtest-battlefield-wrap">
            <Battlefield
              cards={state.battlefield}
              onCardClick={handleCardClick}
              onCardContextMenu={handleCardContext}
              onCardLongPress={isNarrow ? handleCardLongPress : undefined}
            />
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
          onScry={handleScry}
        />
      )}

      {viewer && (
        <ZoneViewerModal
          zone={viewer.zone}
          cards={state.zones[viewer.zone]}
          topN={viewer.topN}
          ordered={viewer.zone === 'library'}
          onClose={() => setViewer(null)}
          onMove={(cardId, to) => {
            if (to === 'battlefield') {
              const c = state.zones[viewer.zone].find((card) => card.id === cardId) ?? null;
              const pos = c ? placeOnBattlefield(c) : { x: 60, y: 60 };
              dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x: pos.x, y: pos.y });
            } else {
              dispatch({ type: 'MOVE_TO_ZONE', cardId, to });
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
          tax={commanderTaxAmount(state.commanderTax, ctxCard.card.id)}
          canTransform={Boolean(ctxCard.card.backImageUrl)}
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
          onMoveTo={(zone) => {
            dispatch({ type: 'MOVE_TO_ZONE', cardId: ctx.cardId, to: zone });
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

      {showDice && <DiceRoller onClose={() => setShowDice(false)} />}

      {showResistancePicker && (
        <ResistancePicker
          level={resistanceLevel}
          onSelect={setResistanceLevel}
          onClose={() => setShowResistancePicker(false)}
        />
      )}

      {phase !== 'playing' && (
        <OpeningHandSheet
          phase={phase}
          hand={state.zones.hand}
          mulliganCount={mulliganCount}
          cardLookup={cardLookup}
          deckName={deck?.name}
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
