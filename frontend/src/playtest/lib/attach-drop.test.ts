import { describe, expect, it } from 'vitest';
import type { CollisionDetection } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { makePlaytestCollision } from './attach-drop';
import {
  handSlotDroppableId,
  handSlotFromDroppableId,
  hostDroppableId,
  hostFromDroppableId,
  isPlaytestAttachment,
} from './zones';

describe('isPlaytestAttachment', () => {
  it.each([
    ['Enchantment — Aura', true],
    ['Artifact — Equipment', true],
    ['Legendary Artifact — Equipment', true],
    ['Artifact — Fortification', true],
    ['Creature — Human Knight', false],
    ['Enchantment — Saga', false],
    ['Artifact', false],
    [undefined, false],
  ])('%s → %s', (typeLine, expected) => {
    expect(isPlaytestAttachment(typeLine as string | undefined)).toBe(expected);
  });
});

describe('host droppable ids', () => {
  it('round-trips and rejects other droppables', () => {
    expect(hostFromDroppableId(hostDroppableId('abc'))).toBe('abc');
    expect(hostFromDroppableId('battlefield')).toBeNull();
    expect(hostFromDroppableId('zone:graveyard')).toBeNull();
    expect(hostFromDroppableId(null)).toBeNull();
  });
});

/** Minimal dnd-kit collision args: one battlefield droppable containing two
 *  card hosts; the pointer sits over host `c2`. */
function args(activeCardId: string): Parameters<CollisionDetection>[0] {
  const rect = (left: number, top: number, w: number, h: number) => ({
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
  });
  const droppableRects = new Map<string, ReturnType<typeof rect>>([
    ['battlefield', rect(0, 0, 1000, 600)],
    [hostDroppableId('c1'), rect(20, 20, 100, 140)],
    [hostDroppableId('c2'), rect(300, 20, 100, 140)],
  ]);
  return {
    active: { id: `bf:${activeCardId}`, data: { current: { cardId: activeCardId } } },
    collisionRect: rect(320, 40, 100, 140),
    droppableRects,
    droppableContainers: [...droppableRects.keys()].map((id) => ({
      id,
      data: { current: undefined },
      disabled: false,
      node: { current: null },
      rect: { current: droppableRects.get(id)! },
      key: id,
    })),
    pointerCoordinates: { x: 350, y: 90 },
  } as unknown as Parameters<CollisionDetection>[0];
}

describe('makePlaytestCollision', () => {
  const cards: Record<string, PlaytestCard> = {
    aura: { id: 'aura', name: 'Rancor', typeLine: 'Enchantment — Aura' },
    bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear' },
  };
  const detect = makePlaytestCollision((id) => cards[id]);

  it('reports the permanent under the pointer as a host when dragging an Aura', () => {
    const hits = detect(args('aura'));
    expect(hits.map((h) => String(h.id))).toEqual([hostDroppableId('c2')]);
  });

  it('never reports a host for an ordinary permanent — a nudge is a reposition', () => {
    const hits = detect(args('bear')).map((h) => String(h.id));
    expect(hits).toContain('battlefield');
    expect(hits.some((id) => id.startsWith('host:'))).toBe(false);
  });

  it('never offers a card as its own host', () => {
    const hits = detect({
      ...args('c2'),
      active: { id: 'bf:c2', data: { current: { cardId: 'c2' } } },
    } as never);
    expect(hits.map((h) => String(h.id)).some((id) => id === hostDroppableId('c2'))).toBe(false);
  });
});

/** The same shape as `args` above, but for the hand: two overlapping cards in
 *  a fan with the pointer resting on the second one. */
function handArgs(activeCardId: string): Parameters<CollisionDetection>[0] {
  const rect = (left: number, top: number, w: number, h: number) => ({
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
  });
  // The fan overlaps by two thirds, which is why the pointer decides.
  const droppableRects = new Map<string, ReturnType<typeof rect>>([
    ['hand', rect(0, 500, 400, 140)],
    ['battlefield', rect(0, 0, 1000, 480)],
    [handSlotDroppableId('h1'), rect(100, 500, 100, 140)],
    [handSlotDroppableId('h2'), rect(133, 500, 100, 140)],
  ]);
  return {
    active: { id: `hand:${activeCardId}`, data: { current: { cardId: activeCardId } } },
    collisionRect: rect(140, 500, 100, 140),
    droppableRects,
    droppableContainers: [...droppableRects.keys()].map((id) => ({
      id,
      data: { current: undefined },
      disabled: false,
      node: { current: null },
      rect: { current: droppableRects.get(id)! },
      key: id,
    })),
    pointerCoordinates: { x: 200, y: 560 },
  } as unknown as Parameters<CollisionDetection>[0];
}

/**
 * E348: arranging the hand is a drag from one hand card onto another, and the
 * fan overlaps by two thirds — so the card under the POINTER wins, exactly as
 * it does for drag-to-attach. Every other drag must never see a hand slot, or
 * a card dragged back from the battlefield would "arrange" instead of coming
 * home.
 */
describe('makePlaytestCollision — arranging the hand', () => {
  const detect = makePlaytestCollision(() => undefined);

  it('round-trips the hand-slot ids and rejects every other droppable', () => {
    expect(handSlotFromDroppableId(handSlotDroppableId('abc'))).toBe('abc');
    expect(handSlotFromDroppableId('hand')).toBeNull();
    expect(handSlotFromDroppableId(hostDroppableId('abc'))).toBeNull();
    expect(handSlotFromDroppableId(null)).toBeNull();
  });

  it('reports the hand card under the pointer when a hand card is dragged', () => {
    expect(detect(handArgs('h1')).map((h) => String(h.id))).toEqual([handSlotDroppableId('h2')]);
  });

  it('never offers a card its own slot', () => {
    const hits = detect(handArgs('h2')).map((h) => String(h.id));
    expect(hits).not.toContain(handSlotDroppableId('h2'));
  });

  it('never offers a hand slot to a card coming from the battlefield', () => {
    const fromBoard = {
      ...handArgs('h1'),
      active: { id: 'bf:b1', data: { current: { cardId: 'b1' } } },
    } as never;
    const hits = detect(fromBoard).map((h) => String(h.id));
    expect(hits).toContain('hand');
    expect(hits.some((id) => id.startsWith('handslot:'))).toBe(false);
  });
});

/**
 * The zone piles float on the felt at the wide tier, INSIDE the battlefield
 * droppable's box — the battlefield contains the dragged card outright. What
 * keeps "drag this to the graveyard" working is that rect intersection ranks
 * by the ratio of the overlap to the two boxes, not by raw area, so a huge
 * container never outranks the small pile you are aiming at. dnd-kit takes
 * the FIRST collision as `over`, so that order is the behaviour; asserted
 * here because a collision-detection change is exactly what would silently
 * turn every send-to-zone drop back into a reposition.
 */
function pileArgs(pointer: { x: number; y: number }): Parameters<CollisionDetection>[0] {
  const rect = (left: number, top: number, w: number, h: number) => ({
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
  });
  const droppableRects = new Map<string, ReturnType<typeof rect>>([
    ['battlefield', rect(0, 0, 1000, 600)],
    ['zone:graveyard', rect(800, 440, 100, 140)],
    ['zone:command', rect(900, 440, 100, 140)],
  ]);
  return {
    active: { id: 'bf:b1', data: { current: { cardId: 'b1' } } },
    // The card hangs off the pile it is aimed at — you drag a card by the
    // point you grabbed it at, so the pointer reaches the pile while most of
    // the card's box is still felt.
    collisionRect: rect(pointer.x, pointer.y, 100, 140),
    droppableRects,
    droppableContainers: [...droppableRects.keys()].map((id) => ({
      id,
      data: { current: undefined },
      disabled: false,
      node: { current: null },
      rect: { current: droppableRects.get(id)! },
      key: id,
    })),
    pointerCoordinates: pointer,
  } as unknown as Parameters<CollisionDetection>[0];
}

describe('makePlaytestCollision — sending a card to a zone', () => {
  const detect = makePlaytestCollision(() => undefined);

  it('gives the drop to the pile, not the battlefield the card is inside', () => {
    expect(String(detect(pileArgs({ x: 850, y: 500 }))[0].id)).toBe('zone:graveyard');
  });

  it('treats the command zone as a pile like any other — legal or not', () => {
    expect(String(detect(pileArgs({ x: 950, y: 500 }))[0].id)).toBe('zone:command');
  });

  it('still repositions on bare felt, where no pile is in reach', () => {
    const hits = detect(pileArgs({ x: 300, y: 200 })).map((h) => String(h.id));
    expect(hits[0]).toBe('battlefield');
    expect(hits.some((id) => id.startsWith('zone:'))).toBe(false);
  });
});
