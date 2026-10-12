import { useState } from 'react';
import { isKeyboardContextMenu, keepsBrowserMenu } from '@/lib/overlays/context-menu';
import type { DeckZone } from '../../store/decks';
import type { Row } from './deck-display-rows';
import { hasCardActions, type DeckCardActionCtx } from './deck-card-actions';

type MenuAnchor = { x: number; y: number; target: Element | null };

interface Args {
  selectMode: boolean;
  selection: { zone: DeckZone; keys: Set<string> } | null;
  isRowSelected: (zone: DeckZone, row: Row) => boolean;
  menuCtx: (row: Row, zone: DeckZone) => DeckCardActionCtx;
}

/**
 * The card menu, anchored to a pointer or to a tile's kebab. One instance for
 * the whole surface; the row and tile only report where and what. Also owns
 * the selection menu a right-click on a selected card opens instead (T162,
 * the playtest rule).
 */
export function useDeckCardMenu({ selectMode, selection, isRowSelected, menuCtx }: Args) {
  const [cardMenu, setCardMenu] = useState<(MenuAnchor & { row: Row; zone: DeckZone }) | null>(
    null
  );
  const [selectionMenu, setSelectionMenu] = useState<MenuAnchor | null>(null);
  // The Context Menu key or Shift+F10 has no pointer: the menu opens where the
  // card's kebab opens it, beside the card rather than over its face.
  const kebabRect = (target: Element) =>
    (
      target.querySelector('.deck-card-grid-menu, .deck-row-menu-trigger') ?? target
    ).getBoundingClientRect();
  const openCardMenu = (zone: DeckZone) => (row: Row, e: React.MouseEvent) => {
    // A field, selected text, a link or a Shift+right-click keeps the
    // browser's own menu (lib/overlays/context-menu), and so does a card with nothing
    // to do (a read-only shared deck).
    if (keepsBrowserMenu(e.nativeEvent)) return;
    if (
      selectMode &&
      selection &&
      isRowSelected(zone, row) &&
      selection.keys.size > row.slotIds.length
    ) {
      e.preventDefault();
      const target = e.currentTarget;
      const rect = kebabRect(target);
      const at = isKeyboardContextMenu(e.nativeEvent)
        ? { x: rect.left, y: rect.bottom }
        : { x: e.clientX, y: e.clientY };
      setSelectionMenu({ ...at, target });
      return;
    }
    if (!hasCardActions(menuCtx(row, zone))) return;
    e.preventDefault();
    const target = e.currentTarget;
    if (isKeyboardContextMenu(e.nativeEvent)) {
      const rect = kebabRect(target);
      setCardMenu({ row, zone, x: rect.left, y: rect.bottom, target });
      return;
    }
    setCardMenu({ row, zone, x: e.clientX, y: e.clientY, target });
  };
  const openCardMenuAt = (zone: DeckZone) => (row: Row, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    setCardMenu({ row, zone, x: rect.left, y: rect.bottom, target: trigger.closest('li') });
  };
  return { cardMenu, setCardMenu, selectionMenu, setSelectionMenu, openCardMenu, openCardMenuAt };
}
