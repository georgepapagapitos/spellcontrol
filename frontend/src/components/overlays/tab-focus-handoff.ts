import { useLayoutEffect } from 'react';

/**
 * A tab strip whose tabs are routes (Discover's Decks | Brewers, a binder's
 * tabs) is rendered by a different page per tab, so an arrow key that changes
 * the tab remounts the whole strip and the focus it moved dies with the old
 * buttons. The key press leaves a note here; the strip that mounts with that
 * tab selected takes focus. The note expires, so a later unrelated mount is
 * left alone.
 */
let pending: { label: string; id: string; at: number } | null = null;
const PENDING_MS = 2000;

/** Call when a key press selects tab `id` of the strip named `label`. */
export function noteTabFocus(label: string, id: string): void {
  pending = { label, id, at: Date.now() };
}

/**
 * Call from a strip with its name, its selected tab, and a function that focuses
 * that tab. Moves focus only when a key press asked for it AND focus was lost
 * (a strip that persisted across the change already holds it).
 */
export function useTabFocusHandoff(label: string, selected: string, focusSelected: () => void) {
  // Every render: the note may arrive before the route that matches it lands.
  useLayoutEffect(() => {
    if (!pending) return;
    if (Date.now() - pending.at > PENDING_MS) {
      pending = null;
      return;
    }
    if (pending.label !== label || pending.id !== selected) return;
    pending = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    focusSelected();
  });
}
