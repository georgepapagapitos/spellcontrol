import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { computePopoverPlacement, getSafeViewport, type PopoverAlign } from './popover-placement';
import { useMenuKeyboard } from './use-menu-keyboard';

interface Options {
  /** Horizontal alignment preference. Wide panels want 'left'. */
  align?: PopoverAlign;
  /**
   * Elements matching this selector count as "inside" for the outside-dismiss
   * guards — for panels whose children portal out of the panel subtree.
   * Forwarded to `useMenuKeyboard`.
   */
  ignoreSelector?: string;
}

export interface AnchoredPanel {
  open: boolean;
  toggle: () => void;
  /** Close and return focus to the trigger — use when a child action dismisses. */
  close: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  /**
   * `position: fixed` coordinates for the portaled panel. Null until the first
   * position is known, so `open && panelStyle && createPortal(...)` renders
   * nothing in the frame before placement resolves.
   */
  panelStyle: CSSProperties | null;
}

/**
 * The portal + placement + dismiss machinery every anchored popover needs.
 *
 * Before this existed, `FilterPopover`, `DeckFiltersPopover`,
 * `DiscoverFiltersPopover`, `ComboFiltersPopover` and `SortPopover` each
 * carried their own copy of the same ~45 lines — a `PanelPos` type, two refs,
 * an open flag, the measure-and-clamp `useLayoutEffect`, a `useMenuKeyboard`
 * call, and a `handleToggle` that pre-estimates the position. The copies had
 * already drifted (the `aria-label` active-count strings disagreed on
 * punctuation), which is the usual tell.
 *
 * Placement runs in `useLayoutEffect` — after the panel renders in the portal
 * but before paint — so the clamped position is the first one painted and
 * there is no visible jump. `handleToggle` seeds a rough position first so the
 * panel's initial render is already near its final home.
 */
export function useAnchoredPanel({ align = 'right', ignoreSelector }: Options = {}): AnchoredPanel {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRef.current) return;
    const anchorRect = triggerRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      getSafeViewport(),
      align
    );
    setPanelStyle({
      position: 'fixed',
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open, align]);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef,
    dialog: true,
    ignoreSelector,
  });

  const toggle = useCallback(() => {
    if (!open && triggerRef.current) {
      // Rough first guess so the pre-measurement render lands near its final
      // position; the layout effect refines it before paint.
      const r = triggerRef.current.getBoundingClientRect();
      setPanelStyle(
        align === 'left'
          ? { position: 'fixed', top: r.bottom + 6, left: Math.max(8, r.left) }
          : {
              position: 'fixed',
              top: r.bottom + 6,
              right: Math.max(8, window.innerWidth - r.right),
            }
      );
    }
    setOpen((v) => !v);
  }, [open, align]);

  return { open, toggle, close: closeAndReturnFocus, triggerRef, panelRef, panelStyle };
}
