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
 * Zone destinations that appear in the "Move to" context-menu on a battlefield
 * card. Does NOT include 'battlefield' — moving to the battlefield from the
 * battlefield is a drop, not a context-menu action. ZoneViewerModal extends
 * this list with a 'battlefield' destination.
 */
export const MOVE_DESTINATIONS: Array<{ key: Zone; label: string }> = [
  { key: 'hand', label: 'Hand' },
  { key: 'graveyard', label: 'Graveyard' },
  { key: 'exile', label: 'Exile' },
  { key: 'library', label: 'Library (bottom)' },
  { key: 'command', label: 'Command' },
];
