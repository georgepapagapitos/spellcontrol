import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';

/**
 * Toolbar popover — portal-positioned disclosure (same mechanism as
 * SelectMenu), extracted verbatim from DeckDisplay so the deck "Show" menu
 * and the collection grid "Details" menu share one implementation. The
 * `.toolbar-popover-*` skin lives in styles/deck-builder-display.css /
 * deck-builder-card-list.css (imported globally via main.tsx).
 */
type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

export function ToolbarPopover({
  label,
  ariaLabel,
  icon,
  triggerClassName,
  triggerContent,
  triggerTitle,
  triggerAriaLabel,
  wrapperClassName,
  haspopup,
  panelClassName,
  panelRole,
  panelAriaLabel,
  children,
}: {
  label?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  // Custom trigger styling/content. When set, replaces the default
  // toolbar pill — ToolbarPopover still owns the <button> (and its
  // ref), so non-toolbar callers (e.g. the tap-to-reveal role badge)
  // reuse this popover's portal + viewport-clamping machinery.
  triggerClassName?: string;
  triggerContent?: ReactNode;
  triggerTitle?: string;
  triggerAriaLabel?: string;
  wrapperClassName?: string;
  // Panel semantics/skin overrides. Default is the toolbar dialog look; a
  // role="menu" caller (e.g. the deck-row kebab) passes its own class + role.
  haspopup?: 'menu' | 'dialog';
  panelClassName?: string;
  panelRole?: string;
  panelAriaLabel?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      buttonRef.current.getBoundingClientRect(),
      panelRef.current.getBoundingClientRect(),
      safe,
      'right',
      6
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = (e: Event) => {
      // The panel scrolls internally (max-height + overflow) — only
      // outside scrolls dismiss it, same guard as Legend.
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target))
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    let scrollRaf = 0;
    scrollRaf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(scrollRaf);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    // Keep the tap on the trigger — don't let it reach an ancestor
    // handler (e.g. the deck row / grid tile that opens the card).
    e.stopPropagation();
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const safe = getSafeViewport();
      const spaceBelow = safe.bottom - rect.bottom;
      const right = Math.max(0, safe.right - rect.right);
      setPanelPos(
        spaceBelow >= 160
          ? { top: rect.bottom + 6, right }
          : { bottom: window.innerHeight - rect.top + 6, right }
      );
    }
    setOpen((v) => !v);
  };

  const panel =
    open &&
    panelPos &&
    createPortal(
      <div
        ref={panelRef}
        className={panelClassName ?? 'toolbar-popover-panel toolbar-popover-panel--fixed'}
        role={panelRole}
        aria-label={panelAriaLabel}
        style={{
          position: 'fixed',
          left: panelPos.left,
          right: panelPos.right,
          top: panelPos.top,
          bottom: panelPos.bottom,
          zIndex: 1200,
          // Scale the enter animation from the trigger corner: anchored-side
          // top/bottom + left/right mirror how the panel was placed.
          transformOrigin: `${panelPos.top !== undefined ? 'top' : 'bottom'} ${
            panelPos.left !== undefined ? 'left' : 'right'
          }`,
        }}
      >
        {children(() => setOpen(false))}
      </div>,
      document.body
    );

  return (
    <div className={wrapperClassName ?? 'toolbar-popover'} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName ?? `toolbar-pill${open ? ' open' : ''}`}
        aria-haspopup={haspopup ?? (triggerClassName ? 'dialog' : 'menu')}
        aria-expanded={open}
        data-open={open || undefined}
        aria-label={triggerAriaLabel ?? (!label ? ariaLabel : undefined)}
        title={triggerTitle}
        onClick={handleToggle}
      >
        {triggerClassName ? (
          triggerContent
        ) : (
          <>
            {icon}
            {label && <span className="toolbar-pill-label">{label}</span>}
            <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
          </>
        )}
      </button>
      {panel}
    </div>
  );
}
