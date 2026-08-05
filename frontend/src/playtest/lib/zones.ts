import type { Zone } from '@/lib/playtest';

/**
 * Returns true if a typeLine string describes a land card.
 * Shared between auto-place row classification and playtest-stats land counting
 * so the two never diverge.
 */
export function isPlaytestLand(typeLine?: string): boolean {
  return (typeLine ?? '').toLowerCase().includes('land');
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
  { key: 'library', label: 'Library (top)', toIndex: 0 },
  { key: 'library', label: 'Library (bottom)' },
  { key: 'command', label: 'Command' },
];

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
