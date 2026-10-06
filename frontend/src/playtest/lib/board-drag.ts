import type { CSSProperties } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import type { PlaytestAction, PlaytestState, Zone } from '@/lib/playtest';
import { haptics } from '@/lib/util/haptics';
import { snapToGrid } from './snap-grid';
import { planGroupDrag } from './group-drag';
import { hostFromDroppableId, zoneDropIndex } from './zones';
import {
  FALLBACK_CARD_H,
  FALLBACK_CARD_W,
  FALLBACK_DROP_POS,
  parseDraggable,
  zoneOfCard,
} from './board-support';

// Drag-and-drop and battlefield-measuring logic pulled out of PlaytestBoard.
// Each function takes what the component used to close over.

export type BattlefieldGeometry = ReturnType<typeof measureBattlefield>;

/**
 * Single read of "how big is the board, how big is a card right now" —
 * `--pt-card-w`/`--pt-card-h` are the density-driving custom properties
 * (playtest.css), so this stays correct across the 320–1440px range without
 * the caller needing to know which breakpoint is active. Falls back to the
 * desktop density before the battlefield has mounted.
 * The positioned surface is inset `--pt-edge` on each side of the wrap
 * `el` is (playtest.css: room for a tapped card's rotation), so the width and
 * left edge here are the wrap's minus that inset — the box the cards'
 * `left: calc(x * (100% - w))` actually resolves against.
 */
export function measureBattlefield(el: HTMLElement | null) {
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

export function measureBattlefieldRect(el: HTMLElement | null) {
  const { width, height, cardW, cardH } = measureBattlefield(el);
  if (!(width > 0 && height > 0)) return null;
  // At the table tier the hand fan and the zone piles float OVER the board's
  // bottom edge, so auto-placement has to keep that band clear or a freshly
  // played land lands under the fan. One card height plus the fan's own
  // chrome ≈ 1.3 card heights, or the measured top of whatever stands
  // highest there: the fan where its cards are bigger than the table's (a
  // phone's hand has a size of its own), the piles and the Hand button
  // where they stand above the hand (an upright phone).
  const tops = [
    ...(el?.querySelectorAll(
      '.playtest-hand--fan .playtest-hand__cards, .playtest-piles, .playtest-hand-menu-btn'
    ) ?? []),
  ].map((n) => n.getBoundingClientRect().top);
  const floorBand = el && tops.length ? el.getBoundingClientRect().bottom - Math.min(...tops) : 0;
  const reservedBottom = Math.min(0.5, Math.max(cardH * 1.3, floorBand) / height);
  // And the life panel floats over the top-left: the first permanent used
  // to land straight under it. Its box is ~1.1 card heights tall.
  const reservedTop = Math.min(0.3, (cardH * 1.1) / height);
  return { width, height, cardW, cardH, reservedBottom, reservedTop };
}

/**
 * The felt's own card box, as inline custom properties for the <DragOverlay>
 * copy. The overlay renders outside every felt, so it inherits `--pt-card-w`
 * from <body>, the full-table size. A felt that redeclares the box for itself
 * (each half of a Horde board, a quadrant of the seat grid) then drew a card
 * twice its size in the air and snapped it back on drop. Reading the felt the
 * card lands on makes the copy match it. Undefined before the felt mounts,
 * which leaves the inherited size.
 */
export function readCardBox(el: Element | null): CSSProperties | undefined {
  if (!el) return undefined;
  const cs = getComputedStyle(el);
  const box: Record<string, string> = {};
  for (const name of ['--pt-card-w', '--pt-card-h', '--pt-edge']) {
    const value = cs.getPropertyValue(name).trim();
    if (value) box[name] = value;
  }
  return Object.keys(box).length ? (box as CSSProperties) : undefined;
}

/** The card currently under the pointer, resolved to its data + display
 *  size, so the top-level <DragOverlay> can render a moving copy that
 *  escapes the origin container's `overflow` clipping. */
export function resolveActiveDrag(
  battlefield: PlaytestState['battlefield'],
  zones: PlaytestState['zones'],
  libraryReveal: PlaytestState['libraryReveal'],
  activeId: string | null
) {
  const parsed = activeId ? parseDraggable(activeId) : null;
  if (!parsed) return null;
  if (parsed.source === 'bf') {
    const bf = battlefield.find((b) => b.card.id === parsed.cardId);
    return bf ? { card: bf.card, bf, size: 'md' as const } : null;
  }
  if (parsed.source === 'hand') {
    const c = zones.hand.find((card) => card.id === parsed.cardId);
    return c ? { card: c, bf: undefined, size: 'sm' as const } : null;
  }
  // Lifted off a pile. The library's top card stays a card back on the way
  // unless the top is being played revealed: dragging it to the graveyard
  // or the battlefield shows it when it lands, not while it is in the air.
  const from = zoneOfCard(zones, parsed.cardId);
  const c = from && zones[from].find((card) => card.id === parsed.cardId);
  if (!c) return null;
  const reveal = libraryReveal;
  const hidden = from === 'library' && reveal !== 'top' && reveal !== 'top-me';
  const bf = hidden
    ? { card: c, tapped: false, counters: {}, stickers: [], x: 0, y: 0, faceDown: true }
    : undefined;
  return { card: c, bf, size: 'sm' as const };
}

/** A battlefield drag that carries more than the card under the pointer:
 *  the cards it moves, and — `riding` — the ones the board has to translate
 *  itself, since dnd-kit only animates the grabbed card's <DragOverlay>
 *  copy. Null whenever the drag moves one card. */
export function resolveDragGroup(
  battlefield: PlaytestState['battlefield'],
  activeId: string | null,
  selected: ReadonlySet<string>
) {
  const parsed = activeId ? parseDraggable(activeId) : null;
  if (!parsed || parsed.source !== 'bf') return null;
  const { ids } = planGroupDrag(battlefield, parsed.cardId, selected, 0, 0);
  if (ids.size < 2) return null;
  const riding = new Set(ids);
  riding.delete(parsed.cardId);
  return { cards: battlefield.filter((b) => ids.has(b.card.id)), riding };
}

export interface DragEndContext {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  selected: ReadonlySet<string>;
  snap: boolean;
  getBattlefieldGeometry: () => BattlefieldGeometry;
}

/** Where a finished drag lands: the reducer actions for a card dropped on the
 *  hand, a pile, a host permanent or the felt. */
export function applyDragEnd(
  event: DragEndEvent,
  { state, dispatch, selected, snap, getBattlefieldGeometry }: DragEndContext
) {
  const parsed = parseDraggable(String(event.active.id));
  if (!parsed) return;
  const overId = event.over?.id ? String(event.over.id) : null;

  // The fan opens a gap where a held card would land (Hand.tsx) and rides
  // its index on the droppable. That gap is where the card goes, whether
  // the hand is being arranged or the card is coming in from elsewhere.
  const handIndex =
    overId === 'hand'
      ? ((event.over?.data.current?.insertAt as number | null | undefined) ?? undefined)
      : undefined;
  if (overId === 'hand' && parsed.source === 'hand') {
    const from = state.zones.hand.findIndex((c) => c.id === parsed.cardId);
    if (handIndex !== undefined && from >= 0 && handIndex !== from) {
      dispatch({ type: 'REORDER_HAND', cardId: parsed.cardId, toIndex: handIndex });
      haptics.tap();
    }
    return;
  }

  const hostId = hostFromDroppableId(overId);
  if (hostId) {
    // Drag-to-attach (Aura / Equipment / Fortification — see attach-drop.ts).
    // From the hand or a pile: straight onto the creature — enter the
    // battlefield, then attach; the reducer snaps it to the host.
    if (parsed.source !== 'bf') {
      dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, ...FALLBACK_DROP_POS });
    }
    dispatch({ type: 'ATTACH', cardId: parsed.cardId, targetId: hostId });
    haptics.tap();
    return;
  }

  if (parsed.source === 'bf') {
    if (overId === 'battlefield' || overId === null) {
      // event.delta is a pixel pointer delta; bf.x/y are fractions of the
      // battlefield box, so convert through the same (container - card)
      // denominator the renderer's `left: calc(x * (100% - cardW))` uses.
      // Grabbing a card that is part of the selection drags the whole
      // selection by that one delta (see `planGroupDrag`); grabbing
      // anything else drags it alone. One dispatch per card, the same way
      // `tapSelection` taps a group — each move is its own takeback step,
      // which is what moving five cards is at a real table too.
      const { width, height, cardW, cardH } = getBattlefieldGeometry();
      const plan = planGroupDrag(
        state.battlefield,
        parsed.cardId,
        selected,
        event.delta.x / Math.max(1, width - cardW),
        event.delta.y / Math.max(1, height - cardH)
      );
      for (const move of plan.moves) {
        const pos = snap
          ? snapToGrid(move.x, move.y, { width, height, cardW, cardH })
          : { x: move.x, y: move.y };
        dispatch({ type: 'MOVE_BF_POSITION', cardId: move.cardId, ...pos });
      }
      return;
    }
    const zoneMatch = /^zone:(.+)$/.exec(overId);
    if (overId === 'hand') {
      dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to: 'hand', toIndex: handIndex });
    } else if (zoneMatch) {
      const to = zoneMatch[1] as Zone;
      // `zoneDropIndex` puts a card dropped on the library on TOP; every
      // other zone appends.
      dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to, toIndex: zoneDropIndex(to) });
    }
    return;
  }

  // A pile's card dropped back on its own pile has gone nowhere. Without
  // this it would still spend a takeback step, and the library would
  // reshuffle nothing into the same place.
  if (parsed.source === 'zone' && overId === `zone:${zoneOfCard(state.zones, parsed.cardId)}`) {
    return;
  }

  if (overId === 'battlefield') {
    const { width, height, left, top, cardW, cardH } = getBattlefieldGeometry();
    const translated = event.active.rect.current.translated;
    if (width > 0 && translated) {
      const x = (translated.left - left) / Math.max(1, width - cardW);
      const y = (translated.top - top) / Math.max(1, height - cardH);
      const pos = snap ? snapToGrid(x, y, { width, height, cardW, cardH }) : { x, y };
      dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, ...pos });
    } else {
      dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId: parsed.cardId, ...FALLBACK_DROP_POS });
    }
    return;
  }

  if (overId === 'hand') {
    dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to: 'hand', toIndex: handIndex });
    return;
  }
  const zoneMatch = overId ? /^zone:(.+)$/.exec(overId) : null;
  if (zoneMatch) {
    const to = zoneMatch[1] as Zone;
    dispatch({ type: 'MOVE_TO_ZONE', cardId: parsed.cardId, to, toIndex: zoneDropIndex(to) });
  }
}
