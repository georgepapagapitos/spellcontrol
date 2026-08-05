import { useEffect, type RefObject } from 'react';
import { focusInto, trapTab } from './overlay-layer';

const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';

/**
 * Resolve the panel this trap owns. Most `useSheetExit` callers (~40 of 42)
 * don't thread a ref through — wiring one at every call site is exactly the
 * "touch 42 files" shape this hook exists to avoid. Absent one, fall back to
 * the last `[role="dialog"][aria-modal="true"]` in document order: dialogs
 * and sheets render only while open (see overlay-layer.ts) and mount in the
 * same order they're pushed onto the shared layer stack, so the last one in
 * the DOM is always the one whose `isTopmost()` is true below. A caller that
 * does have a ref (CardPreview, BuildReportSheet, CardGroupSheet) still gets
 * exact targeting instead of the query.
 */
function resolvePanel(explicit?: HTMLElement | null): HTMLElement | null {
  if (explicit) return explicit;
  if (typeof document === 'undefined') return null;
  const panels = document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR);
  return panels.length > 0 ? panels[panels.length - 1] : null;
}

/**
 * Root-cause Tab trap + focus restoration, mirroring Modal.tsx's own
 * (independent, untouched) trap so both overlay kinds behave identically.
 * Deliberately Tab-only, not a document-wide `focusin` interceptor: several
 * sheets contain SelectMenu/FilterPopover-style controls that portal their
 * own listbox to `document.body`, outside the sheet's DOM subtree — a
 * focusin redirect would fight those every time one opened. Tab-cycling
 * catches the actual escape hatch (keyboard users tabbing past the last
 * control) without that collision, exactly like Modal.tsx already does.
 *
 * `isTopmost` gates every keydown so a confirm dialog opened on top of a
 * sheet is the only layer that traps — both Modal and `useSheetExit` push
 * onto the same stack (overlay-layer.ts), so this falls out for free.
 */
export function useFocusTrap(
  isTopmost: () => boolean,
  panelRef?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Whoever had focus before this dialog mounted gets it back on close —
    // captured up front since by the time the cleanup runs, the panel (and
    // usually the whole component) is gone.
    const prevFocused = document.activeElement as HTMLElement | null;
    const panel = resolvePanel(panelRef?.current);
    if (panel) focusInto(panel);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopmost()) return;
      const topPanel = resolvePanel(panelRef?.current);
      if (topPanel) trapTab(topPanel, e);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (prevFocused?.isConnected) prevFocused.focus?.();
    };
  }, [isTopmost, panelRef]);
}
