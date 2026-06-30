import { useCallback, useState } from 'react';

/**
 * Generic multi-select state for any list/index surface (decks, binders,
 * lists). Mirrors the collection's Select mode — an opt-in `selectMode` gate
 * plus a Set of selected ids — but as a reusable hook so each index page wires
 * it in a few lines instead of re-implementing the same local state.
 *
 * Ids are opaque strings; the caller decides what they key on (deck.id,
 * binder.id, list.id).
 */
export interface Selection {
  selectMode: boolean;
  selected: ReadonlySet<string>;
  /** Enter select mode (selection starts empty). */
  enter: () => void;
  /** Leave select mode and drop the current selection. */
  exit: () => void;
  toggle: (id: string) => void;
  clear: () => void;
  /** Replace the selection with exactly these ids (Select all). */
  selectAll: (ids: string[]) => void;
}

export function useSelection(): Selection {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);
  const enter = useCallback(() => setSelectMode(true), []);
  const exit = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);
  const selectAll = useCallback((ids: string[]) => setSelected(new Set(ids)), []);

  return { selectMode, selected, enter, exit, toggle, clear, selectAll };
}
