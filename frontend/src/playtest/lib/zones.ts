import type { Zone } from '@/lib/playtest';

/**
 * Returns true if a typeLine string describes a land card.
 * Shared between auto-place row classification and playtest-stats land counting
 * so the two never diverge.
 */
export function isPlaytestLand(typeLine?: string): boolean {
  return (typeLine ?? '').toLowerCase().includes('land');
}

/**
 * True for the permanents that attach to something by rule — an Aura,
 * Equipment or Fortification. Drag-to-attach is gated on this so that
 * dropping an ordinary creature onto a neighbour (a nudge in a full row)
 * can never attach it by accident; anything else still attaches through
 * the card menu's "Attach to…" picker.
 */
export function isPlaytestAttachment(typeLine?: string): boolean {
  return /\b(aura|equipment|fortification)\b/i.test(typeLine ?? '');
}

/** The droppable id a card in hand registers so another hand card can be
 *  dropped onto it — how the hand is arranged (E348). */
export function handSlotDroppableId(cardId: string): string {
  return `handslot:${cardId}`;
}

/** Inverse of `handSlotDroppableId`; null for any other droppable. */
export function handSlotFromDroppableId(id: string | null | undefined): string | null {
  return id && id.startsWith('handslot:') ? id.slice(9) : null;
}

/** The droppable id a battlefield permanent registers as a potential host. */
export function hostDroppableId(cardId: string): string {
  return `host:${cardId}`;
}

/** Inverse of `hostDroppableId`; null for any other droppable. */
export function hostFromDroppableId(id: string | null | undefined): string | null {
  return id && id.startsWith('host:') ? id.slice(5) : null;
}

export interface MoveDestination {
  key: Zone;
  label: string;
  /** Insertion index within the destination zone; omitted means "append".
   *  Only meaningful for the library, where top vs bottom is a real choice. */
  toIndex?: number;
}

/**
 * Zone destinations that appear in the "Move to" context-menu on a battlefield
 * card. Does NOT include 'battlefield' — moving to the battlefield from the
 * battlefield is a drop, not a context-menu action. ZoneViewerModal extends
 * this list with a 'battlefield' destination.
 */
export const MOVE_DESTINATIONS: MoveDestination[] = [
  { key: 'hand', label: 'Hand' },
  { key: 'graveyard', label: 'Graveyard' },
  { key: 'exile', label: 'Exile' },
  // Top and bottom are separate entries against the same zone: "put it back on
  // top" is a routine action (tutors, Brainstorm) that previously forced a trip
  // through the scry sheet. `toIndex` feeds MOVE_TO_ZONE directly.
  { key: 'library', label: 'Library top', toIndex: 0 },
  { key: 'library', label: 'Library bottom' },
  { key: 'command', label: 'Command zone' },
];

/**
 * Where a card DROPPED on a zone lands, as `MOVE_TO_ZONE`'s `toIndex`.
 *
 * The library is the one zone whose "top" is not the end of its array: it is
 * drawn from index 0, so appending puts a card on the BOTTOM. Dropping a card
 * on the library means putting it back on top — what a player does at a table
 * after a tutor, a Brainstorm, or a change of mind — and a card silently
 * landing under 90 others is a move nobody can see or undo by eye. The
 * explicit other direction is the card menu's "Library bottom".
 *
 * Every other zone appends: the top of a graveyard or exile pile IS the card
 * put there last.
 */
export function zoneDropIndex(to: Zone): number | undefined {
  return to === 'library' ? 0 : undefined;
}

/** Stable React key — `key` alone collides now that two entries share the
 *  'library' zone. */
export function destinationKey(d: { key: string; toIndex?: number }): string {
  return `${d.key}:${d.toIndex ?? 'end'}`;
}

/** Current commander tax for a card (MTG rule 903.10: +2 generic per prior
 *  cast from the command zone). 0 for a card that's never been cast, or with
 *  no id to look up. */
export function commanderTaxAmount(
  commanderTax: Record<string, number>,
  cardId: string | undefined
): number {
  return cardId ? (commanderTax[cardId] ?? 0) * 2 : 0;
}

/** Proper-case zone name for ZoneViewerModal's title/aria-label — a map, not
 *  CSS `text-transform`, so "command" reads as "Command zone" rather than
 *  "Command". */
export const ZONE_VIEWER_LABEL: Record<Zone, string> = {
  library: 'Library',
  hand: 'Hand',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command zone',
};
