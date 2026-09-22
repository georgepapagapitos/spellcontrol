import type { BattlefieldCard } from '@/lib/playtest';

/** A position for `MOVE_BF_POSITION` — absolute 0..1 fractions of the felt. */
export interface GroupDragMove {
  cardId: string;
  x: number;
  y: number;
}

export interface GroupDragPlan {
  /** Every permanent this drag visibly moves, including attachments carried
   *  along by a moving host. What the board previews mid-drag. */
  ids: ReadonlySet<string>;
  /** What to dispatch. Attachments whose host is also in the group are left
   *  out — `MOVE_BF_POSITION` already moves an attachment with its host, so
   *  dispatching for both would apply the delta to it twice. */
  moves: GroupDragMove[];
}

const EMPTY_PLAN: GroupDragPlan = { ids: new Set(), moves: [] };

/**
 * One shared delta for a group, clamped so the whole formation stays on the
 * felt.
 *
 * The reducer clamps each card's position on its own (`clampFraction`), which
 * is right for a single card and wrong for a group: dragging three lands into
 * the left edge would pin the leading one at 0 while the others kept sliding,
 * and the row the player had lined up would close up on itself. Clamping the
 * delta by the most-constrained member instead moves every card by the same
 * amount, so the group arrives in the shape it left in.
 */
export function clampGroupDelta(
  cards: readonly BattlefieldCard[],
  dx: number,
  dy: number
): { dx: number; dy: number } {
  if (cards.length === 0) return { dx: 0, dy: 0 };
  const xs = cards.map((c) => c.x);
  const ys = cards.map((c) => c.y);
  return {
    dx: Math.min(Math.max(dx, -Math.min(...xs)), 1 - Math.max(...xs)),
    dy: Math.min(Math.max(dy, -Math.min(...ys)), 1 - Math.max(...ys)),
  };
}

/**
 * What a battlefield drag moves, and where each card lands.
 *
 * Grabbing a card that is part of the current selection drags the whole
 * selection; grabbing anything else drags that card alone, whatever is
 * selected elsewhere. Pass `dx`/`dy` of 0 to get the membership without the
 * arithmetic, which is what the mid-drag preview needs.
 */
export function planGroupDrag(
  battlefield: readonly BattlefieldCard[],
  grabbedId: string,
  selected: ReadonlySet<string>,
  dx: number,
  dy: number
): GroupDragPlan {
  if (!battlefield.some((b) => b.card.id === grabbedId)) return EMPTY_PLAN;
  const ids =
    selected.has(grabbedId) && selected.size > 1 ? new Set(selected) : new Set([grabbedId]);
  // A selected card that isn't on the battlefield (it left while the
  // selection stood) would otherwise widen the group by nothing at all.
  for (const id of [...ids]) if (!battlefield.some((b) => b.card.id === id)) ids.delete(id);
  for (const b of battlefield) if (b.attachedTo && ids.has(b.attachedTo)) ids.add(b.card.id);

  const group = battlefield.filter((b) => ids.has(b.card.id));
  const delta = clampGroupDelta(group, dx, dy);
  return {
    ids,
    moves: group
      .filter((b) => !(b.attachedTo && ids.has(b.attachedTo)))
      .map((b) => ({ cardId: b.card.id, x: b.x + delta.dx, y: b.y + delta.dy })),
  };
}
