import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { isNativePlatform } from './platform';
import { focusInto, trapTab, useOverlayLayer } from './overlay-layer';

export interface UseMenuKeyboardOptions {
  /** Whether the menu is currently open. */
  open: boolean;
  /** Close the menu (state only — the hook handles focus return itself). */
  onClose: () => void;
  /** The popover panel containing the menu items. */
  panelRef: RefObject<HTMLElement | null>;
  /** The button that opened the menu — focus returns here on Escape/activation. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Selector for focusable items inside the panel. Defaults to menuitems. */
  itemSelector?: string;
  /**
   * When provided, the element matching this selector gets initial focus on
   * open (e.g. the listbox's `[aria-selected="true"]` option), falling back
   * to the first item.
   */
  initialItemSelector?: string;
  /**
   * The panel holds arbitrary controls — checkboxes, chips, a nested editor —
   * rather than a list of menuitems. Initial focus lands on the first focusable
   * element, and Tab is trapped inside the panel instead of closing it: a
   * filter panel with twenty chips is unreachable by keyboard if the first Tab
   * dismisses it.
   */
  dialog?: boolean;
  /**
   * Elements matching this selector count as "inside" for the outside-pointerdown
   * and scroll-dismiss guards. Needed by panels whose own children portal out of
   * the panel subtree — SortPopover embeds SelectMenus, which render their
   * dropdown to `<body>`, so picking a sort field must not dismiss the sort
   * popover underneath it.
   */
  ignoreSelector?: string;
}

const DEFAULT_ITEM_SELECTOR = '[role="menuitem"]';

function getItems(panel: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true'
  );
}

/**
 * Real menu-button semantics for a popover menu (WAI-ARIA menu / listbox
 * popup pattern), shared by OverflowMenu, CardRowMenu and SelectMenu:
 *
 * - on open, focus moves to the first item (or `initialItemSelector` match);
 * - ArrowDown/ArrowUp move focus through items, wrapping at the ends;
 * - Home/End jump to the first/last item;
 * - Escape closes AND returns focus to the trigger;
 * - Tab closes, returning focus to the trigger so the default tab traversal
 *   continues from there (`dialog` panels trap Tab instead);
 * - a `pointerdown` outside the panel + trigger closes (pointerdown, not
 *   mousedown, so touch works and the close beats underlying click handlers);
 * - a scroll outside the panel closes;
 * - the Android hardware back button closes.
 *
 * Every panel on this hook is portaled to `<body>` with `position: fixed` and
 * has its coordinates computed once, when it opens. Nothing re-anchors it, so
 * scrolling the page underneath leaves the panel pinned to the screen while the
 * trigger it belongs to slides away — a floating slab attached to nothing. The
 * dismiss-on-outside-scroll below is the app's established answer to that
 * (ToolbarPopover has had it for a while); it lives here now so every popover
 * gets it rather than the two that happened to hand-roll it.
 *
 * Escape / Tab / back are gated on the SHARED overlay-layer stack, so a
 * SelectMenu opened inside a filter popover is the one that answers a keypress
 * and the popover underneath keeps its focus.
 *
 * Consumers should close via the returned `closeAndReturnFocus` when an item
 * is activated, so keyboard users land back on the trigger.
 */
export function useMenuKeyboard({
  open,
  onClose,
  panelRef,
  triggerRef,
  itemSelector = DEFAULT_ITEM_SELECTOR,
  initialItemSelector,
  dialog = false,
  ignoreSelector,
}: UseMenuKeyboardOptions): { closeAndReturnFocus: () => void } {
  // Keep the latest onClose without re-subscribing listeners every render
  // (consumers pass inline arrows).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Registered only while open: the component owning this hook also owns the
  // trigger, so it stays mounted with the panel closed.
  const { isTopmost } = useOverlayLayer(open);

  const closeAndReturnFocus = useCallback(() => {
    onCloseRef.current();
    // preventScroll: the trigger is on-screen (the menu was anchored to it),
    // and a page scroll here would trip the scroll-close guards in the
    // portaled menus.
    triggerRef.current?.focus({ preventScroll: true });
  }, [triggerRef]);

  useEffect(() => {
    if (!open) return;

    // Move focus into the menu. The panel renders in the same commit that
    // flips `open`, so the ref is populated by the time this effect runs.
    const panel = panelRef.current;
    if (panel) {
      // Focus may scroll (the panel can have internal overflow and the selected
      // option may sit below the fold); the scroll-close guard below ignores
      // scrolls inside the panel, and it hasn't attached yet anyway (one-rAF
      // delay).
      if (dialog) {
        focusInto(panel);
      } else {
        const initial =
          (initialItemSelector ? panel.querySelector<HTMLElement>(initialItemSelector) : null) ??
          getItems(panel, itemSelector)[0];
        initial?.focus();
      }
    }

    // Shared by the pointerdown and scroll guards: the panel's own subtree,
    // plus anything the caller flagged as logically part of it.
    const isInside = (target: Node | null): boolean => {
      if (!target) return false;
      if (panelRef.current?.contains(target)) return true;
      if (!ignoreSelector) return false;
      return target instanceof Element && target.closest(ignoreSelector) !== null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (isInside(target)) return;
      // The trigger is excluded so its own click handler can toggle closed.
      if (triggerRef.current?.contains(target)) return;
      onCloseRef.current();
    };

    const onScroll = (e: Event) => {
      // The panel scrolls internally (max-height + overflow) — only scrolls
      // outside it mean the trigger has moved out from under the panel.
      if (isInside(e.target as Node | null)) return;
      onCloseRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Only the topmost layer answers keys — a SelectMenu open inside this
      // panel owns Escape/Tab until it closes.
      if (!isTopmost()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Tab') {
        const currentPanel = panelRef.current;
        if (dialog && currentPanel) {
          // Arbitrary content — keep Tab inside it rather than dismissing on
          // the first press.
          trapTab(currentPanel, e);
          return;
        }
        // Close and park focus on the trigger so the browser's default tab
        // traversal continues from the menu's anchor point.
        onCloseRef.current();
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
        return;
      }
      const currentPanel = panelRef.current;
      if (!currentPanel) return;
      const items = getItems(currentPanel, itemSelector);
      if (items.length === 0) return;
      e.preventDefault();
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'ArrowDown') next = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
      else
        next = activeIndex < 0 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length;
      items[next]?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // Delayed one frame so the initial focus move above — which can scroll a
    // tall panel or the page — doesn't instantly dismiss what just opened.
    const scrollRaf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(scrollRaf);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [
    open,
    panelRef,
    triggerRef,
    itemSelector,
    initialItemSelector,
    dialog,
    ignoreSelector,
    isTopmost,
  ]);

  // Android hardware back button. Without a listener Capacitor navigates the
  // WebView's own history, which left the page changing underneath an open
  // popover. Same shared layer stack as Modal/useSheetExit, so only the topmost
  // overlay answers one press.
  useEffect(() => {
    if (!open || !isNativePlatform()) return;
    const handle = CapacitorApp.addListener('backButton', () => {
      if (!isTopmost()) return;
      onCloseRef.current();
      triggerRef.current?.focus({ preventScroll: true });
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [open, isTopmost, triggerRef]);

  return { closeAndReturnFocus };
}
