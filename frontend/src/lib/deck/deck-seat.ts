import type { Deck } from '@/store/decks';

/**
 * The command zone has no deck slot, so the edit-printing flow (keyed by slot
 * id) addresses its two seats by these ids. Never stored on a deck.
 */
export const COMMANDER_SEAT = 'seat:commander';
export const PARTNER_SEAT = 'seat:partner';

export type Seat = 'commander' | 'partnerCommander';

export function seatOf(slotId: string): Seat | null {
  if (slotId === COMMANDER_SEAT) return 'commander';
  if (slotId === PARTNER_SEAT) return 'partnerCommander';
  return null;
}

/** The copy bound to a slot or a seat, or null when nothing is bound. */
export function boundCopyId(
  deck: Pick<Deck, 'cards' | 'commanderAllocatedCopyId' | 'partnerCommanderAllocatedCopyId'>,
  slotId: string
): string | null {
  const seat = seatOf(slotId);
  if (seat === 'commander') return deck.commanderAllocatedCopyId ?? null;
  if (seat === 'partnerCommander') return deck.partnerCommanderAllocatedCopyId ?? null;
  return deck.cards.find((c) => c.slotId === slotId)?.allocatedCopyId ?? null;
}
