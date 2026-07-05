import { nextBinderMatch } from '@spellcontrol/binder-routing';
import type { BinderDef, EnrichedCard } from '../types';

/**
 * A pin is redundant once it's no longer doing any work: routing the card
 * WITHOUT this specific pin would land it in the same binder anyway (its
 * rules already match there, or it's pinned somewhere else that would claim
 * it first). Redundant pins accumulate silently — a rule edit, a printing
 * swap, or another binder's rule change can all make an old "keep here" pin
 * moot — so the review queue dissolves them automatically rather than
 * leaving stale pin metadata around forever.
 *
 * Pure: does not mutate `binders`. Caller applies the result via the normal
 * unpin mutator (`removeCardFromBinder(binderId, copyId, false)`), which
 * already has the durable-key removeRef mechanics.
 */
export function findRedundantPins(
  binderId: string,
  cards: EnrichedCard[],
  binders: BinderDef[]
): string[] {
  const def = binders.find((b) => b.id === binderId);
  const pinnedCopyIds = def?.pinnedCopyIds ?? [];
  if (pinnedCopyIds.length === 0) return [];

  const cardsByCopyId = new Map(cards.map((c) => [c.copyId, c]));
  const redundant: string[] = [];

  for (const copyId of pinnedCopyIds) {
    const card = cardsByCopyId.get(copyId);
    if (!card) continue; // no longer owned; reconcileBinderRefs handles that separately

    // Hypothetical world: this ONE pin doesn't exist. Other pins (on this
    // binder or any other) are untouched — they don't affect this card's
    // routing since nextBinderMatch only checks per-card pin membership.
    const withoutThisPin = binders.map((b) =>
      b.id === binderId
        ? { ...b, pinnedCopyIds: (b.pinnedCopyIds ?? []).filter((id) => id !== copyId) }
        : b
    );
    const wouldLandHereAnyway = nextBinderMatch(card, withoutThisPin)?.id === binderId;
    if (wouldLandHereAnyway) redundant.push(copyId);
  }

  return redundant;
}
