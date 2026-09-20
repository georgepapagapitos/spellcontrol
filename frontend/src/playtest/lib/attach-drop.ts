import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { handSlotFromDroppableId, hostFromDroppableId, isPlaytestAttachment } from './zones';

/**
 * Collision detection for the playtest DndContext. The battlefield is one
 * big droppable with every permanent's host droppable nested inside it, so
 * the default rect intersection always reports the battlefield (the dragged
 * card is fully inside it). When — and only when — the card being dragged
 * is an Aura / Equipment / Fortification, the permanent under the POINTER
 * wins instead, so dropping it there attaches; every other drag falls
 * through to the ordinary battlefield / hand / zone-pile targets.
 */
export function makePlaytestCollision(lookup: (cardId: string) => PlaytestCard | undefined) {
  const detect: CollisionDetection = (args) => {
    const activeCardId = String(args.active.data.current?.cardId ?? '');
    const dragged = lookup(activeCardId);
    // Arranging the hand (E348): a hand card dropped onto another hand card
    // takes its place. The fan overlaps by two thirds, so box-vs-box is
    // guesswork — the card under the POINTER is the one being aimed at. Any
    // other drag falls through, and the filter below keeps hand slots from
    // ever winning one.
    if (String(args.active.id).startsWith('hand:')) {
      const slots = pointerWithin(args).filter((c) => {
        const slot = handSlotFromDroppableId(String(c.id));
        return slot !== null && slot !== activeCardId;
      });
      if (slots.length > 0) return slots;
    }
    if (dragged && isPlaytestAttachment(dragged.typeLine)) {
      const hosts = pointerWithin(args).filter((c) => {
        const host = hostFromDroppableId(String(c.id));
        return host !== null && host !== activeCardId;
      });
      if (hosts.length > 0) return hosts;
    }
    // Host droppables must never win an ordinary drag — a permanent nudged
    // over a neighbour is a reposition, not an attachment.
    return rectIntersection(args).filter(
      (c) =>
        hostFromDroppableId(String(c.id)) === null && handSlotFromDroppableId(String(c.id)) === null
    );
  };
  return detect;
}
