import { useState } from 'react';
import type { DeckZone } from '../../store/decks';
import type { Row } from './deck-display-rows';

/**
 * Multi-select (E172). A deliberate mode the user opts into via the toolbar's
 * "Select" toggle, mirroring CardListTable's selectMode (STYLE_GUIDE.md
 * "Selection mode & drag reorder"). Scoped to ONE zone at a time (a bulk
 * action only ever targets one zone); the Set holds SLOT ids directly (a row
 * toggle adds/removes its whole stack), so executing a bulk action never
 * needs a row lookup, just `[...keys]`.
 */
export function useDeckSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<{ zone: DeckZone; keys: Set<string> } | null>(null);
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelection(null);
  };
  const isRowSelected = (zone: DeckZone, row: Row): boolean =>
    !!selection &&
    selection.zone === zone &&
    row.slotIds.length > 0 &&
    row.slotIds.every((id) => selection.keys.has(id));
  const toggleRowSelected = (zone: DeckZone, row: Row) => {
    if (row.slotIds.length === 0) return;
    setSelection((cur) => {
      const sameZone = cur && cur.zone === zone;
      const keys = sameZone ? new Set(cur!.keys) : new Set<string>();
      const selected = row.slotIds.every((id) => keys.has(id));
      for (const id of row.slotIds) {
        if (selected) keys.delete(id);
        else keys.add(id);
      }
      return keys.size === 0 ? null : { zone, keys };
    });
  };
  return {
    selectMode,
    setSelectMode,
    selection,
    setSelection,
    confirmBulkRemove,
    setConfirmBulkRemove,
    exitSelectMode,
    isRowSelected,
    toggleRowSelected,
  };
}
