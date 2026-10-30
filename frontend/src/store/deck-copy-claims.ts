import type { Deck, DeckCard } from './decks';
import { DECK_SLOT_ZONES } from './deck-zones';

// How one deck's slots and commander seats claim, release and give up physical
// copies. Pure deck-in, deck-out helpers behind the decks store's mutators;
// every zone that claims a copy (DECK_SLOT_ZONES) is covered.

/** Which copy claim "Release copy" lets go of: a list slot or a commander seat. */
export type ReleaseTarget = { slotId: string } | 'commander' | 'partner';

/** A slot with `copyId` bound to it. Binding a real copy ends a proxy or a release. */
export function bindCopy(c: DeckCard, copyId: string | null): DeckCard {
  if (!copyId || (!c.proxy && !c.released)) return { ...c, allocatedCopyId: copyId };
  const { proxy: _proxy, released: _released, ...rest } = c;
  void _proxy;
  void _released;
  return { ...rest, allocatedCopyId: copyId };
}

/** The deck with `fn` applied to the one slot `slotId`, in whichever zone holds it. */
function mapSlot(d: Deck, slotId: string, fn: (c: DeckCard) => DeckCard): Deck {
  const next = { ...d };
  for (const zone of DECK_SLOT_ZONES) {
    const list: DeckCard[] | undefined = d[zone];
    // A zone the row never had stays absent; cards/sideboard/considering are
    // always present on a well-formed row.
    if (!list && zone === 'extras') continue;
    next[zone] = (list ?? []).map((c) => (c.slotId === slotId ? fn(c) : c));
  }
  return next;
}

/** Bind `copyId` to the slot. */
export function bindSlotCopy(d: Deck, slotId: string, copyId: string | null): Deck {
  return mapSlot(d, slotId, (c) => bindCopy(c, copyId));
}

/** Free the target's copy and mark it released, so no matcher refills it. */
export function releaseCopyIn(d: Deck, target: ReleaseTarget): Deck {
  if (target === 'commander')
    return { ...d, commanderAllocatedCopyId: null, commanderReleased: true };
  if (target === 'partner')
    return { ...d, partnerCommanderAllocatedCopyId: null, partnerCommanderReleased: true };
  return mapSlot(d, target.slotId, (c) => ({ ...c, allocatedCopyId: null, released: true }));
}

/** Mark the slot a proxy (freeing its copy), or unmark it binding `copyId`. */
export function setSlotProxy(d: Deck, slotId: string, proxy: boolean, copyId: string | null): Deck {
  return mapSlot(d, slotId, (c) => {
    const { proxy: _proxy, released: _released, ...rest } = c;
    void _proxy;
    void _released;
    return proxy
      ? { ...rest, allocatedCopyId: null, proxy: true }
      : { ...rest, allocatedCopyId: copyId };
  });
}

/** The deck without one commander seat's release marker: seating a card or
 *  binding a copy there is the user taking the seat back. */
export function withoutReleased(
  d: Deck,
  key: 'commanderReleased' | 'partnerCommanderReleased'
): Deck {
  if (!d[key]) return d;
  const next = { ...d };
  delete next[key];
  return next;
}
