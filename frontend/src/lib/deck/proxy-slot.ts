import type { Deck, DeckCard } from '@/store/decks';
import type { SavedCube } from '@/store/cube';
import type { EnrichedCard } from '@/types/index';
import {
  buildAllocationMap,
  findWaitingSlot,
  pickCollectionCopy,
  type WaitingSlot,
} from '@/lib/collection/allocations';

/** What the row ⋮ "Mark as proxy" / "Not a proxy" press does. */
export type ProxyPlan =
  /** Mark the slot, and its copy goes straight to another deck waiting on the card. */
  | { kind: 'hand-over'; slot: DeckCard; copy: EnrichedCard; waiting: WaitingSlot }
  /** Mark the slot; `freed` when it gave up a copy no deck is waiting on. */
  | { kind: 'mark'; slot: DeckCard; freed: boolean }
  /** Unmark the slot, binding `copyId` when a free copy exists. */
  | { kind: 'unmark'; slot: DeckCard; copyId: string | null };

/**
 * Pick the slot of a row to flip and what happens to its copy. Marking takes
 * the slot holding a copy first, since freeing that copy is the point. Null
 * when the row has no slot to flip.
 */
export function planProxyToggle(
  deck: Deck,
  slotIds: string[],
  proxy: boolean,
  collection: EnrichedCard[],
  decks: Deck[],
  cubes: readonly SavedCube[]
): ProxyPlan | null {
  const ids = new Set(slotIds);
  const slots = [...deck.cards, ...deck.sideboard, ...(deck.considering ?? [])].filter((c) =>
    ids.has(c.slotId)
  );
  if (!proxy) {
    const slot = slots.find((c) => c.proxy);
    if (!slot) return null;
    const claim = pickCollectionCopy(
      slot.card.name,
      collection,
      buildAllocationMap(decks, cubes),
      slot.card.id
    );
    return { kind: 'unmark', slot, copyId: claim?.copyId ?? null };
  }
  const slot = slots.find((c) => !c.proxy && c.allocatedCopyId) ?? slots.find((c) => !c.proxy);
  if (!slot) return null;
  const copy = slot.allocatedCopyId
    ? collection.find((c) => c.copyId === slot.allocatedCopyId)
    : undefined;
  const waiting = copy ? findWaitingSlot(copy, decks, deck.id) : null;
  if (copy && waiting) return { kind: 'hand-over', slot, copy, waiting };
  return { kind: 'mark', slot, freed: !!copy };
}

/** The toast for a plan the editor applies in place (not a hand-over). */
export function proxyToastMessage(plan: ProxyPlan): string {
  const name = plan.slot.card.name;
  if (plan.kind === 'hand-over')
    return `${name} is a proxy here. Your copy moved to ${plan.waiting.deckName}.`;
  if (plan.kind === 'mark')
    return plan.freed ? `${name} is a proxy here. Your copy is free.` : `${name} is a proxy here.`;
  return plan.copyId ? `Using your copy of ${name}` : `${name} is no longer a proxy.`;
}
