import { useCallback, useRef, useState } from 'react';
import type { MouseEvent, TouchEvent } from 'react';
import { useLongPress } from './use-long-press';
import { computePeekPlacement, peekWidth } from './hover-peek-placement';

// MTG card aspect ratio — mirrors `useDeckHoverPeek`'s CARD_ASPECT.
const CARD_ASPECT = 680 / 488;

// Row/thumbnail controls that already have their own tap semantics — the
// gesture must never hijack them (qty edit, kebab menu, remove links,
// printings-toggle). Delegation checks this before arming the long-press
// timer, so every existing control keeps working exactly as before (E129
// coexistence audit).
const INTERACTIVE_SELECTOR = 'button, a, input, [role="menu"], [role="menuitem"]';

export interface TouchPeekState {
  name: string;
  /** Explicit per-element image (a `data-peek-img`, e.g. a printing sub-row);
   *  when absent the consumer resolves art by name, same contract as the
   *  hover-peek hook. */
  img?: string;
  left: number;
  top: number;
  width: number;
}

/**
 * Touch parity for `useDeckHoverPeek` (E129): long-press a `[data-peek-name]`
 * element to glance at its card art without opening the full CardPreview.
 * Delegated on the container exactly like the hover hook — spread
 * `listHandlers` on the same list/feed div that already carries
 * `hoverPeek.listHandlers` — and built on the shared `useLongPress` primitive
 * (also used by the playtest opening hand), not a parallel timer.
 *
 * Coexistence, by construction:
 * - Row/thumbnail controls matching `INTERACTIVE_SELECTOR` never arm the
 *   gesture, so qty-edit, the kebab menu, remove, and the printings-toggle
 *   are completely unaffected.
 * - A fired long-press swallows the tap-to-open that would otherwise follow
 *   release. `listHandlers.onClickCapture` runs on the CONTAINER in the
 *   capture phase — before any descendant's own onClick, including a
 *   `DeckCardRow` several components down (e.g. `SubstituteOptions` nested
 *   inside `CoachFeed`) — so one delegated gate covers every row without
 *   threading a callback through each consumer.
 * - The terminating touchend also `preventDefault`s when the press fired, so
 *   a hybrid pointer+touch device's synthetic compat mouse events never
 *   chain into the desktop hover-peek right after this one closes (no
 *   double-peek).
 * - A second touch, or movement past `useLongPress`'s slop (scroll intent),
 *   dismisses immediately — native page scroll is never blocked, since
 *   nothing here calls `preventDefault` on touchmove.
 *
 * Positions like the row-anchor hover-peek (`computePeekPlacement`, beside
 * the element's rect) rather than under the finger — touch has no cursor to
 * float beside, and a card centered on the touch point would sit under the
 * thumb that triggered it.
 */
export function useTouchPeek() {
  const [peek, setPeek] = useState<TouchPeekState | null>(null);
  const armedEl = useRef<HTMLElement | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => setPeek(null), []);

  const openPeek = useCallback((el: HTMLElement) => {
    const name = el.dataset.peekName;
    if (!name) return;
    const vw = window.innerWidth;
    const width = peekWidth(vw);
    const height = Math.round(width * CARD_ASPECT);
    const viewport = { width: vw, height: window.innerHeight };
    const { left, top } = computePeekPlacement(el.getBoundingClientRect(), viewport, width, height);
    fired.current = true;
    setPeek({ name, img: el.dataset.peekImg, left, top, width });
  }, []);

  const longPress = useLongPress({
    onLongPress: () => {
      if (armedEl.current) openPeek(armedEl.current);
    },
    onCancelByMove: clear,
  });

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      // Every new gesture starts clean — otherwise a prior press whose fired
      // flag never got read by `onClickCapture` (the browser fully honored
      // `preventDefault` and never dispatched a click) would wrongly swallow
      // an unrelated later tap.
      fired.current = false;
      if (e.touches.length !== 1) {
        // A second finger down cancels the gesture and dismisses any open peek.
        longPress.onTouchCancel();
        armedEl.current = null;
        setPeek(null);
        return;
      }
      const target = e.target as HTMLElement;
      const el = target.closest(INTERACTIVE_SELECTOR)
        ? null
        : target.closest<HTMLElement>('[data-peek-name]');
      armedEl.current = el?.dataset.peekName ? el : null;
      if (armedEl.current) longPress.onTouchStart(e);
    },
    [longPress]
  );

  const endGesture = useCallback(
    (e: TouchEvent) => {
      longPress.onTouchCancel();
      armedEl.current = null;
      // Leave `fired` set — `onClickCapture` is the one that reads and
      // resets it, since the terminating click (if the browser dispatches
      // one despite `preventDefault` below) arrives as a separate event
      // slightly after this handler runs.
      if (fired.current) {
        // Suppress the compat mouse-event chain a browser would otherwise
        // fire after touchend (mouseover/click) so a hybrid pointer+touch
        // device can't re-trigger the desktop hover-peek right as this one
        // dismisses.
        e.preventDefault();
        setPeek(null);
      }
    },
    [longPress]
  );

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (fired.current) {
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    peek,
    clear,
    listHandlers: {
      onTouchStart,
      onTouchMove: longPress.onTouchMove,
      onTouchEnd: endGesture,
      onTouchCancel: endGesture,
      onClickCapture,
    },
  };
}
