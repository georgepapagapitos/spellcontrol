import { useCallback, useEffect, useRef } from 'react';
import { createOverlayHistoryController } from './overlay-history';

/**
 * The focus/dismiss contract shared by every overlay in the app — `<Modal>`
 * dialogs, `useSheetExit` bottom sheets, and the one-off full-screen surfaces
 * (CardScanner) that predate both.
 *
 * This used to live entirely inside `Modal.tsx`, which is why only Modal
 * dialogs trapped Tab: the ~30
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

/**
 * Whether `el` is rendered at all. A control under `display: none` (itself or
 * any ancestor, e.g. a header ✕ a container query hides on a short seat) or
 * `visibility: hidden` refuses `focus()`, so picking one as "first" left focus
 * outside the dialog and the Tab wrap aimed at nothing. `checkVisibility` is
 * missing before Safari 17.4; zero client rects is the same test there.
 */
function isRendered(el: HTMLElement): boolean {
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true })
    : el.getClientRects().length > 0;
}

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest('[hidden]') && isRendered(el)
  );
}

/** Move focus into `panel` if it isn't already there. */
export function focusInto(panel: HTMLElement): void {
  if (panel.contains(document.activeElement)) return;
  const first = getFocusable(panel)[0];
  (first ?? panel).focus();
}

/**
 * Hand focus back to what had it before an overlay opened, WITHOUT scrolling
 * to it. The element was where the person left it; a plain `focus()` scrolls
 * it into view, which on the playtest board jumped the whole battlefield
 * every time a hand-card menu closed (the hand sits half off the felt's
 * bottom edge). Every overlay's close path goes through here for that reason.
 */
export function restoreFocus(el: Element | null | undefined): void {
  if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
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

interface LayerEntry {
  id: symbol;
  /** Set only when this layer opted into back-button integration — see
   *  `useOverlayLayer`'s second parameter. Returns whether it accepted the
   *  close (false for a Modal with `dismissable={false}` mid-save). */
  dismiss?: () => boolean;
}

const layerStack: LayerEntry[] = [];

/**
 * The one Back-button handler shared by every overlay kind (E481/T157): "Back
 * closes the topmost overlay first." Built entirely from closures over
 * `layerStack` above, handed to `overlay-history.ts`'s history mechanics —
 * see that module for how the single history entry is marked/reused/skipped,
 * and why `dismissTopmost` reports back whether the close was accepted. Only
 * layers that pass a `dismiss` callback participate; a plain
 * `useOverlayLayer()` call (still used by a handful of tests) never touches
 * `window.history`.
 */
function dismissTopmostParticipant(): boolean {
  for (let i = layerStack.length - 1; i >= 0; i--) {
    const entry = layerStack[i];
    if (entry.dismiss) return entry.dismiss();
  }
  return false;
}

function participantCount(): number {
  return layerStack.filter((entry) => entry.dismiss).length;
}

const overlayHistory = createOverlayHistoryController({
  participantCount,
  dismissTopmost: dismissTopmostParticipant,
});

/**
 * Registers this overlay as a layer while `active` and reports whether it is
 * the topmost one. Only the topmost layer should answer Escape, the
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
 *
 * `dismiss`, when passed, is this layer's own close path — a sheet's
 * `beginClose`, a Modal's `beginClose`, `CardScanner`'s `onClose` — and opts
 * the layer into the shared Back-button integration (`overlay-history.ts`):
 * while it (or any other participating layer) is open, one hardware/browser
 * Back press closes the topmost participating layer instead of navigating the
 * page, through this exact function. It returns whether the close was
 * accepted — almost always `true`; `false` only for a layer that can refuse
 * (a Modal with `dismissable={false}` mid-save), which is what tells
 * `overlay-history.ts` to keep the next Back intercepted too instead of
 * letting it fall through to real navigation. Kept in a ref internally, so an
 * inline arrow is fine. Popover menus (`useMenuKeyboard`) deliberately omit it
 * — see STYLE_GUIDE § Overlays.
 */
export function useOverlayLayer(
  active = true,
  dismiss?: () => boolean
): { isTopmost: () => boolean } {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol('overlay-layer');

  const dismissRef = useRef(dismiss);
  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);

  // Whether this layer takes part in Back (it passed a dismiss). The effect
  // follows that boolean, not the dismiss function itself, which callers
  // pass inline and which dismissRef above keeps current.
  const participates = dismiss !== undefined;

  useEffect(() => {
    if (!active) return;
    const id = idRef.current as symbol;
    layerStack.push({
      id,
      dismiss: participates ? () => dismissRef.current?.() ?? false : undefined,
    });
    if (participates) overlayHistory.registered();
    return () => {
      const i = layerStack.findIndex((entry) => entry.id === id);
      if (i !== -1) layerStack.splice(i, 1);
      // Nothing to do with history here — consumption is lazy (see
      // overlay-history.ts): a marked entry left behind by this close is
      // either reused by whatever opens next or skipped transparently if
      // anyone ever backs into it.
    };
  }, [active, participates]);

  // Stable identity: consumers list `isTopmost` in effect deps, and a fresh
  // function each render would re-run those effects on every render — which
  // for the focus effect below means stealing focus back into the panel
  // continuously.
  const isTopmost = useCallback(() => layerStack[layerStack.length - 1]?.id === idRef.current, []);

  return { isTopmost };
}
