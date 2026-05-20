import { useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { PlaytestState, Zone } from '@/lib/playtest';
import { usePlaytestStore } from '../store';
import { useNarrowViewport } from '../hooks/use-narrow-viewport';
import { Battlefield } from './Battlefield';
import { Hand } from './Hand';
import { ZonePile } from './ZonePile';
import { ZoneViewerModal } from './ZoneViewerModal';
import { ActionBar } from './ActionBar';
import { CardContextMenu } from './CardContextMenu';
import { MobileZonesPanel } from './MobileZonesPanel';
import { TokenCreator } from './TokenCreator';

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
  const battlefieldRef = useRef<HTMLDivElement | null>(null);
  const [viewer, setViewer] = useState<ViewerMode>(null);
  const [ctx, setCtx] = useState<ContextState>(null);
  const [tokenCreator, setTokenCreator] = useState(false);
  const isNarrow = useNarrowViewport();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(event: DragEndEvent) {
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

  function handleHandCardClick(cardId: string) {
    // Tap-to-play: cascade onto the battlefield so multiple plays don't stack.
    const offset = state.battlefield.length;
    const x = 40 + (offset % 8) * 30;
    const y = 40 + Math.floor(offset / 8) * 30;
    dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x, y });
  }

  const ctxCard = ctx ? state.battlefield.find((b) => b.card.id === ctx.cardId) : null;

  return (
    <div className={`playtest-board${isNarrow ? ' playtest-board--narrow' : ''}`}>
      <ActionBar
        turn={state.turn}
        libraryCount={state.zones.library.length}
        canUndo={state.past.length > 0}
        onDraw={() => dispatch({ type: 'DRAW', n: 1 })}
        onShuffle={() => dispatch({ type: 'SHUFFLE_LIBRARY' })}
        onMulligan={() => dispatch({ type: 'MULLIGAN' })}
        onUntapAll={() => dispatch({ type: 'UNTAP_ALL' })}
        onNextTurn={() => dispatch({ type: 'NEXT_TURN' })}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onReset={() => {
          if (window.confirm('Reset the game? This clears history.')) {
            dispatch({ type: 'RESET' });
          }
        }}
        onScry={() => setViewer({ zone: 'library', topN: 3 })}
        onCreateToken={() => setTokenCreator(true)}
      />
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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
              dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x: 60, y: 60 });
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
            dispatch({
              type: 'CREATE_TOKEN',
              card: { id, name, isToken: true },
              x: 60,
              y: 60,
            });
            setTokenCreator(false);
          }}
        />
      )}
    </div>
  );
}
