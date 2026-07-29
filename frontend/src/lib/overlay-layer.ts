import { useCallback, useEffect, useRef } from 'react';

/**
 * The focus/dismiss contract shared by every overlay in the app — `<Modal>`
 * dialogs, `useSheetExit` bottom sheets, and the one-off full-screen surfaces
 * (CardScanner) that predate both.
 *
 * This used to live entirely inside `Modal.tsx`, which is why only Modal
 * dialogs trapped Tab and answered the Android hardware back button: the ~30
 * sheets on `useSheetExit` had none of it, so back navigated the page out from
 * under an open sheet and Tab walked into the content behind it.
 *
 * The layer stack is deliberately module-global and shared by ALL overlay
 * kinds. A confirm dialog frequently opens on top of a sheet; with two
 * independent stacks both would answer one Escape / one back press, and the
 * lower one would yank focus back out of the upper one.
 */

/**
 * What counts as focusable for the trap. Deliberately the pragmatic list —
 * not a full a11y-tree walk — covering everything the app's overlays render.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest('[hidden]')
  );
}

/** Move focus into `panel` if it isn't already there. */
export function focusInto(panel: HTMLElement): void {
  if (panel.contains(document.activeElement)) return;
  const first = getFocusable(panel)[0];
  (first ?? panel).focus();
}

/**
 * Keep Tab / Shift+Tab inside `panel`, so `aria-modal` is actually true.
 * Call from a keydown handler; returns true if it handled the event.
 */
export function trapTab(panel: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== 'Tab') return false;
  const focusables = getFocusable(panel);
  if (focusables.length === 0) {
    // Nothing tabbable — keep focus pinned on the panel itself.
    e.preventDefault();
    panel.focus();
    return true;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && panel.contains(active);
  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault();
      last.focus();
      return true;
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

const layerStack: symbol[] = [];

/**
 * Registers this overlay as a layer while `active` and reports whether it is
 * the topmost one. Only the topmost layer should answer Escape, the Android
 * back button, or trap Tab.
 *
 * `active` exists because not every overlay unmounts when it closes. Modals and
 * sheets are rendered only while open, so the default (`true`, register for the
 * component's lifetime) is right for them. Popovers are different: the
 * component owns the trigger too, so it stays mounted permanently and must
 * register only while its panel is open — otherwise every mounted SelectMenu on
 * the page sits in the stack and "topmost" becomes whichever one mounted last.
 *
 * `isTopmost` is a getter, not a boolean, so event handlers read the live
 * stack at press time rather than closing over a stale render's value.
 */
export function useOverlayLayer(active = true): { isTopmost: () => boolean } {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol('overlay-layer');

  useEffect(() => {
    if (!active) return;
    const id = idRef.current as symbol;
    layerStack.push(id);
    return () => {
      const i = layerStack.indexOf(id);
      if (i !== -1) layerStack.splice(i, 1);
    };
  }, [active]);

  // Stable identity: consumers list `isTopmost` in effect deps, and a fresh
  // function each render would re-run those effects on every render — which
  // for the focus effect below means stealing focus back into the panel
  // continuously.
  const isTopmost = useCallback(() => layerStack[layerStack.length - 1] === idRef.current, []);

  return { isTopmost };
}
