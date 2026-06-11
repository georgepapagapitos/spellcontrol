import { useCallback, useEffect, useRef, type RefObject } from 'react';

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
 *   continues from there;
 * - a `pointerdown` outside the panel + trigger closes (pointerdown, not
 *   mousedown, so touch works and the close beats underlying click handlers).
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
}: UseMenuKeyboardOptions): { closeAndReturnFocus: () => void } {
  // Keep the latest onClose without re-subscribing listeners every render
  // (consumers pass inline arrows).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
      // Item focus may scroll (the panel can have internal overflow and the
      // selected option may sit below the fold); the consumers' scroll-close
      // guards ignore scrolls inside the panel, and at open time their
      // listeners haven't attached yet (one-rAF delay).
      const initial =
        (initialItemSelector ? panel.querySelector<HTMLElement>(initialItemSelector) : null) ??
        getItems(panel, itemSelector)[0];
      initial?.focus();
    }

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      // The trigger is excluded so its own click handler can toggle closed.
      if (triggerRef.current?.contains(target)) return;
      onCloseRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Tab') {
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
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panelRef, triggerRef, itemSelector, initialItemSelector]);

  return { closeAndReturnFocus };
}
