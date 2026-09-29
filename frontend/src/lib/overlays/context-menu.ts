/**
 * The app-wide right-click contract (STYLE_GUIDE § Verbs — Menus, T162): a
 * right-click on an item opens the same menu its ⋮ opens, with the same items,
 * at the pointer. These are the rules every surface shares, so a card in the
 * collection, a deck tile and a rule on /rules answer a right-click alike.
 */

/** Fields keep the browser's menu: copy, paste and spellcheck are not ours. */
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/**
 * A keyboard-opened `contextmenu` (the Context Menu key, Shift+F10) rather
 * than a pointer's. Chromium sends it with `button: -1` (measured in Edge,
 * 2026-09-27: `pointerType` still reads "mouse"); Pointer Events 3 gives it an
 * empty `pointerType`. Anything else is treated as a pointer, which at worst
 * costs a keyboard menu its anchor at the item's ⋮.
 */
export function isKeyboardContextMenu(e: MouseEvent): boolean {
  return e.button === -1 || (e as Partial<PointerEvent>).pointerType === '';
}

function sameUrl(a: string, b: string): boolean {
  try {
    const base = window.location.href;
    const x = new URL(a, base);
    const y = new URL(b, base);
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
}

/**
 * True when a right-click inside an item should keep the browser's own menu
 * instead of opening ours:
 *
 * - **Shift + right-click** is the way through to the browser's menu on every
 *   item (Firefox already behaves this way; this makes Chrome and Edge match).
 *   Only on a pointer: Shift+F10 is itself a keyboard shortcut for OUR menu.
 * - **A field**, where copy and paste live.
 * - **Selected text** under the pointer, which the user is about to copy.
 * - **A link that is not the item's own**, such as a card name that links
 *   elsewhere. The item's own link (`itemHref`) is ours: the menu carries
 *   Open in new tab and Copy link for it, so nothing the browser offered is lost.
 */
export function keepsBrowserMenu(e: MouseEvent, itemHref?: string): boolean {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return true;
  if (e.shiftKey && !isKeyboardContextMenu(e)) return true;
  if (target.closest(FIELD_SELECTOR)) return true;
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') {
    for (let i = 0; i < selection.rangeCount; i++) {
      if (selection.getRangeAt(i).intersectsNode(target)) return true;
    }
  }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (link && !(itemHref && sameUrl(link.getAttribute('href') ?? '', itemHref))) return true;
  return false;
}

/**
 * Marks the element a menu acts on for as long as the menu is open, so the
 * user can see which card or deck the menu belongs to (the ring in
 * OverflowMenu.css; the deck's stacks keep a marked card fanned out). Returns
 * the cleanup.
 */
export function markMenuTarget(el: Element | null | undefined): () => void {
  if (!el) return () => {};
  el.setAttribute('data-menu-open', '');
  return () => el.removeAttribute('data-menu-open');
}

/** The element focus should return to when a menu opened from inside `host`
 *  closes: the item's own focusable (its link, its row button), not the ⋮. */
export function itemFocusTarget(target: EventTarget | null, host: Element): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const focusable = target.closest<HTMLElement>(
    'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable && host.contains(focusable)) return focusable;
  return host instanceof HTMLElement && host.tabIndex >= 0 ? host : null;
}
