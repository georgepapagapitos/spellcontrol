import { useMemo, useRef, useState } from 'react';
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
import { PlaytestStatsSheet } from './PlaytestStatsSheet';
import { ResistanceBanner } from './ResistanceBanner';

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
  const resistanceOn = usePlaytestStore((s) => s.resistance);
  const toggleResistance = usePlaytestStore((s) => s.toggleResistance);
  const lastResistanceEvent = usePlaytestStore((s) => s.lastResistanceEvent);
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
  const [activeId, setActiveId] = useState<string | null>(null);
  // Banner dismissal is tracked by event id so a new opponent response (even
  // with an identical message) re-shows and re-announces the banner.
  const [dismissedResistanceId, setDismissedResistanceId] = useState<number | null>(null);
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

  function handleCardClick(cardId: string) {
    dispatch({ type: 'TAP', cardId });
  }

  function handleCardContext(cardId: string, e: React.MouseEvent) {
    e.preventDefault();
    setCtx({ cardId, x: e.clientX, y: e.clientY });
  }

  function handleCardLongPress(cardId: string, x: number, y: number) {
    setCtx({ cardId, x, y });
  }

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

  return (
    <div className={`playtest-board${isNarrow ? ' playtest-board--narrow' : ''}`}>
      <ActionBar
        turn={state.turn}
        libraryCount={state.zones.library.length}
        canUndo={state.past.length > 0}
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
        onScry={() => setViewer({ zone: 'library', topN: 3 })}
        onCreateToken={() => setTokenCreator(true)}
        onOpenStats={() => setShowStats(true)}
        onToggleResistance={toggleResistance}
        resistanceOn={resistanceOn}
      />
      {lastResistanceEvent && lastResistanceEvent.id !== dismissedResistanceId && (
        <ResistanceBanner
          key={lastResistanceEvent.id}
          message={lastResistanceEvent.message}
          onDismiss={() => setDismissedResistanceId(lastResistanceEvent.id)}
        />
      )}
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
          onOpenZone={(zone) => setViewer({ zone })}
          onShuffleLibrary={() => dispatch({ type: 'SHUFFLE_LIBRARY' })}
          onScry={() => setViewer({ zone: 'library', topN: 3 })}
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
          }}
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

      {confirmDialog}
    </div>
  );
}
