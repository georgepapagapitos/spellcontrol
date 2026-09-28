import { describe, expect, it } from 'vitest';
import type { CollisionDetection } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { makePlaytestCollision } from './attach-drop';
import { hostDroppableId, hostFromDroppableId, isPlaytestAttachment } from './zones';

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

/** The fan floating over the bottom of the felt, a card overlapping both,
 *  and the pointer at (px, py). */
function handArgs(
  activeId: string,
  pointer: { x: number; y: number } | null = { x: 200, y: 560 }
): Parameters<CollisionDetection>[0] {
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
    ['hand', rect(0, 500, 400, 140)],
  ]);
  return {
    active: { id: activeId, data: { current: { cardId: activeId.split(':')[1] } } },
    // Held by its lower middle, so the card is mostly still over the felt.
    collisionRect: pointer
      ? rect(pointer.x - 60, pointer.y - 140, 100, 140)
      : rect(140, 420, 100, 140),
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

/**
 * The fan opens a gap under the POINTER (Hand.tsx), so the drop has to go
 * where that gap is: with the pointer over the fan, the hand wins whatever the
 * card's box still overlaps behind it. Otherwise a card could show its gap in
 * the hand and then land on the felt.
 */
describe('makePlaytestCollision — the hand', () => {
  const detect = makePlaytestCollision(() => undefined);
  const aura = makePlaytestCollision(() => ({
    id: 'a1',
    name: 'Rancor',
    typeLine: 'Enchantment — Aura',
  }));

  it('is the hand when the pointer is over the fan, from anywhere', () => {
    for (const id of ['hand:h1', 'bf:b1', 'zone:l1']) {
      expect(detect(handArgs(id)).map((h) => String(h.id))).toEqual(['hand']);
    }
  });

  it('beats an attachment looking for a host, since the fan is drawn on top', () => {
    expect(aura(handArgs('bf:a1')).map((h) => String(h.id))).toEqual(['hand']);
  });

  it('falls back to the box test off the fan, and for a keyboard drag with no pointer', () => {
    expect(String(detect(handArgs('hand:h1', { x: 600, y: 300 }))[0].id)).toBe('battlefield');
    expect(detect(handArgs('hand:h1', null)).length).toBeGreaterThan(0);
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
