import { MoreVertical, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMenuKeyboard } from '@/lib/use-menu-keyboard';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';

export interface OverflowMenuItem {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  danger?: boolean;
}

interface Props {
  items: OverflowMenuItem[];
  /** aria-label + title for the kebab trigger. */
  ariaLabel?: string;
  /** Class on the wrapper — e.g. to gate visibility by breakpoint. */
  className?: string;
  /** Class on the trigger button — pass `pill-btn` to match a toolbar row. */
  triggerClassName?: string;
  /**
   * Horizontal alignment of the panel.
   * 'right' (default) aligns to the trigger's right edge;
   * 'left' aligns to the left edge (use when the trigger is leftmost).
   */
  align?: 'left' | 'right';
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * A `⋮` kebab that collapses a short list of secondary actions into a popover.
 * Portals the panel to `<body>` and uses `computePopoverPlacement` to flip/clamp
 * it into the safe viewport (accounting for sticky header, mobile bottom nav,
 * and the keyboard inset). Works in virtualized rows, clipping containers, and
 * across page positions — no reliance on positioned ancestors.
 */
export function OverflowMenu({
  items,
  ariaLabel = 'More actions',
  className,
  triggerClassName,
  align = 'right',
}: Props) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef: buttonRef,
  });

  // After the panel renders in the portal, measure it and clamp/flip it into
  // the safe viewport. useLayoutEffect fires before paint so there's no flash.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const panelEl = panelRef.current;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelEl.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      safe,
      align,
      4 // tighter gap for the kebab menu
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open, align]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      // Set an initial position estimate (trigger right-edge aligned, below) so
      // the panel renders in approximately the right place before the layout
      // effect refines it. This prevents the panel briefly appearing at 0,0.
      const r = buttonRef.current.getBoundingClientRect();
      setPanelPos(
        align === 'right'
          ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }
          : { top: r.bottom + 4, left: Math.max(8, r.left) }
      );
    }
    setOpen((v) => !v);
  };

  return (
    <div className={`overflow-menu${className ? ` ${className}` : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={handleToggle}
      >
        <MoreVertical width={16} height={16} strokeWidth={2} aria-hidden />
      </button>
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className="deck-row-menu-popover overflow-menu-popover"
            role="menu"
            style={{
              position: 'fixed',
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              right: panelPos.right,
              transformOrigin: `${panelPos.top !== undefined ? 'top' : 'bottom'} ${
                panelPos.left !== undefined ? 'left' : 'right'
              }`,
            }}
          >
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`deck-row-menu-item${item.danger ? ' deck-row-menu-item--danger' : ''}`}
                  onClick={() => {
                    closeAndReturnFocus();
                    item.onClick();
                  }}
                >
                  {Icon && <Icon width={14} height={14} strokeWidth={1.7} aria-hidden />}
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
