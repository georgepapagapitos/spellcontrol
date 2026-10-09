import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { hostFromDroppableId, isPlaytestAttachment } from './zones';

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
    // A card held with the pointer over the fan is going into the hand,
    // whatever it overlaps behind it: the fan is drawn on top of the felt,
    // and it opens its gap off the pointer (Hand.tsx), so the drop has to
    // agree with the gap the player can see. A keyboard drag has no pointer
    // and falls through to the box test below.
    const hand = pointerWithin(args).filter((c) => String(c.id) === 'hand');
    if (hand.length > 0) return hand;
    if (dragged && isPlaytestAttachment(dragged.typeLine)) {
      const hosts = pointerWithin(args).filter((c) => {
        const host = hostFromDroppableId(String(c.id));
        return host !== null && host !== activeCardId;
      });
      if (hosts.length > 0) return hosts;
    }
    // Host droppables must never win an ordinary drag — a permanent nudged
    // over a neighbor is a reposition, not an attachment.
    return rectIntersection(args).filter((c) => hostFromDroppableId(String(c.id)) === null);
  };
  return detect;
}
