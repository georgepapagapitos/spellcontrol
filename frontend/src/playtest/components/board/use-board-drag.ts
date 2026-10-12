import { useMemo, useState, type CSSProperties, type RefObject } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { PlaytestAction, PlaytestState } from '@/lib/playtest';
import { makePlaytestCollision } from '../../lib/attach-drop';
import { clampGroupDelta } from '../../lib/group-drag';
import {
  applyDragEnd,
  measureBattlefield,
  readCardBox,
  resolveActiveDrag,
  resolveDragGroup,
} from '../../lib/board-drag';
import { zoneOfCard } from '../../lib/board-support';

interface BoardDragInput {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  battlefieldRef: RefObject<HTMLDivElement | null>;
  selected: ReadonlySet<string>;
  snap: boolean;
  /** Picking a card up is done reading it. */
  onPickUp: () => void;
}

/**
 * The battlefield's drag-and-drop wiring: the card under the pointer, the
 * group riding along with it, dnd-kit's measuring and collision rules, and
 * the start/move/end/cancel handlers for the board's `DndContext`.
 */
export function useBoardDrag({
  state,
  dispatch,
  battlefieldRef,
  selected,
  snap,
  onPickUp,
}: BoardDragInput) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Your felt's card box, read as a drag starts, for the moving copy (see
  // `readCardBox`).
  const [dragCardBox, setDragCardBox] = useState<CSSProperties | undefined>(undefined);

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

  const getBattlefieldGeometry = () => measureBattlefield(battlefieldRef.current);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDragCardBox(readCardBox(battlefieldRef.current));
    // Picking a card up is done reading it: the preview must not come back
    // over the table once it lands.
    onPickUp();
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

  function handleDragCancel() {
    setActiveId(null);
    clearRideOffset();
  }

  return {
    activeId,
    activeDrag,
    dragCardBox,
    dragGroup,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}
