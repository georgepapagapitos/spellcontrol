import type { MouseEvent } from 'react';

/**
 * Right-click is a game gesture on a board, not a document gesture: the card
 * menu and the table menu own it, so the native browser menu never appears on
 * felt, chrome, or the gaps between them.
 *
 * Before this, the native menu was suppressed only where a handler happened to
 * sit — battlefield cards, hand cards, and bare felt whose event target was the
 * felt itself. It still popped on the power/toughness badges, the card slot's
 * own padding, the zone piles, the life strip and the log, so right-click meant
 * "card menu" in one place and "browser menu" a few pixels away.
 *
 * Text fields keep their native menu: paste, spellcheck and select-all are not
 * ours to take.
 */
export function suppressNativeContextMenu(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
}
