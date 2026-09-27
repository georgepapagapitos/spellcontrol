import { ExternalLink, Link2, MoreVertical, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMenuKeyboard } from '@/lib/use-menu-keyboard';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';
import {
  isKeyboardContextMenu,
  itemFocusTarget,
  keepsBrowserMenu,
  markMenuTarget,
} from '@/lib/context-menu';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/store/toasts';
import './OverflowMenu.css';

export interface OverflowMenuItem {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  /** Render the item disabled (non-interactive, muted). */
  disabled?: boolean;
}

interface Props {
  items: OverflowMenuItem[];
  /** aria-label + title for the kebab trigger. */
  ariaLabel?: string;
  /** Optional non-interactive node rendered at the top of the panel (e.g. a
   *  status badge). Caller owns its markup/styling. */
  header?: ReactNode;
  /** Class on the wrapper — e.g. to gate visibility by breakpoint. */
  className?: string;
  /**
   * Class on the trigger button — pass `pill-btn` to match a toolbar row.
   * When omitted, a built-in ghost-kebab style (`overflow-menu-trigger`,
   * matching the card-row kebab) is applied so the trigger never falls back to
   * the unstyled browser-default button.
   */
  triggerClassName?: string;
  /**
   * Custom trigger content (e.g. a labeled "Add to calendar" button).
   * Defaults to the ⋮ kebab icon.
   */
  trigger?: ReactNode;
  /**
   * Horizontal alignment of the panel.
   * 'right' (default) aligns to the trigger's right edge;
   * 'left' aligns to the left edge (use when the trigger is leftmost).
   */
  align?: 'left' | 'right';
  /**
   * Extra class on the portaled panel — for callers whose surface uses a
   * non-token z-index stack (e.g. the playtest board at 900–1100) and need to
   * lift the panel above it. The panel is portaled to `<body>`, so a wrapper
   * `className` can't reach it; this is the only hook that does.
   */
  panelClassName?: string;
  /**
   * The item this menu belongs to, as a selector for the trigger's closest
   * ancestor (`'.binders-index-card'`). A right-click anywhere on that item
   * opens this same menu at the pointer; the Context Menu key or Shift+F10 on
   * the focused item opens it at the ⋮. While the menu is open, however it was
   * opened, the item carries `data-menu-open` so it is visibly the thing the
   * menu acts on. STYLE_GUIDE § Verbs — Menus.
   */
  contextHost?: string;
  /**
   * The item is a page of its own (a deck, a binder): the menu gains Open in
   * new tab and Copy link, and a right-click on the item's own link opens this
   * menu instead of the browser's, since those two rows cover what the
   * browser's menu was for. Origin-relative (`/decks/abc`).
   */
  itemHref?: string;
  /** Names the item in the Copy link toast: `Copied link to <name>`. */
  itemName?: string;
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
  header,
  className,
  triggerClassName,
  trigger,
  align = 'right',
  panelClassName,
  contextHost,
  itemHref,
  itemName,
}: Props) {
  const [open, setOpen] = useState(false);
  // Where the panel hangs: the ⋮ (null), or the pointer of a right-click.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // A menu opened from the item hands focus back to the item, not its ⋮.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef: buttonRef,
    returnFocusRef,
  });

  // After the panel renders in the portal, measure it and clamp/flip it into
  // the safe viewport. useLayoutEffect fires before paint so there's no flash.
  // A right-click anchors to the pointer as a zero-size rect, so the panel
  // opens down and right from it like a desktop menu and flips at the edges.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const panelEl = panelRef.current;
    const anchorRect = point
      ? { top: point.y, bottom: point.y, left: point.x, right: point.x }
      : buttonRef.current.getBoundingClientRect();
    const panelRect = panelEl.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      safe,
      point ? 'left' : align,
      point ? 0 : 4 // tighter gap for the kebab menu
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open, align, point]);

  const openAt = (at: { x: number; y: number } | null) => {
    if (at) {
      setPanelPos({ top: at.y, left: at.x });
    } else if (buttonRef.current) {
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
    setPoint(at);
    setOpen(true);
  };

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    returnFocusRef.current = null;
    openAt(null);
  };

  // Right-click on the item. A native listener on the host rather than a prop
  // threaded into every caller's markup: the host is the caller's own element
  // (a tile, a row), and one selector is all a caller names. `openAt` is read
  // through a ref so the listener subscribes once per host.
  const openAtRef = useRef(openAt);
  useEffect(() => {
    openAtRef.current = openAt;
  });
  useEffect(() => {
    const host = contextHost ? buttonRef.current?.closest(contextHost) : null;
    if (!host) return;
    const onContextMenu = (e: Event) => {
      const me = e as MouseEvent;
      // An inner item with a menu of its own (a rule inside a keyword card)
      // already answered this right-click.
      if (me.defaultPrevented) return;
      if (keepsBrowserMenu(me, itemHref)) return;
      me.preventDefault();
      if (isKeyboardContextMenu(me)) {
        // The keyboard has no pointer: hang the menu off the ⋮, as a click on
        // it would, and give focus back to what had it (the item).
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        openAtRef.current(null);
        return;
      }
      returnFocusRef.current = itemFocusTarget(me.target, host);
      openAtRef.current({ x: me.clientX, y: me.clientY });
    };
    host.addEventListener('contextmenu', onContextMenu);
    return () => host.removeEventListener('contextmenu', onContextMenu);
  }, [contextHost, itemHref]);

  // The item is the thing the menu acts on, so it says so while the menu is
  // open, whether the ⋮ or a right-click opened it.
  useEffect(() => {
    if (!open || !contextHost) return;
    return markMenuTarget(buttonRef.current?.closest(contextHost));
  }, [open, contextHost]);

  const linkItems: OverflowMenuItem[] = itemHref
    ? [
        {
          label: 'Open in new tab',
          icon: ExternalLink,
          onClick: () => {
            window.open(new URL(itemHref, window.location.href).href, '_blank', 'noopener');
          },
        },
        {
          label: 'Copy link',
          icon: Link2,
          onClick: () => {
            const what = itemName ? `link to ${itemName}` : 'link';
            void copyToClipboard(new URL(itemHref, window.location.href).href).then((ok) =>
              toast.show(
                ok
                  ? { message: `Copied ${what}`, tone: 'success' }
                  : { message: `Couldn't copy ${what}.`, tone: 'error' }
              )
            );
          },
        },
      ]
    : [];
  // The link pair sits above the destructive rows: an item's own actions come
  // first and Delete comes last.
  const firstDanger = items.findIndex((item) => item.danger);
  const allItems =
    linkItems.length === 0
      ? items
      : firstDanger < 0
        ? [...items, ...linkItems]
        : [...items.slice(0, firstDanger), ...linkItems, ...items.slice(firstDanger)];

  // Close on scroll outside the panel: the fixed-positioned panel would
  // otherwise detach from its trigger when the page (or a virtualized row
  // list) scrolls. Scrolling *inside* a tall panel is exempt. Attach a frame
  // late so the opening click's micro-scroll doesn't immediately close it.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const raf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  return (
    <div className={`overflow-menu${className ? ` ${className}` : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName ?? 'overflow-menu-trigger'}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={(e) => {
          // Stop the row/card click handler from also firing when the menu
          // lives inside a clickable row (e.g. CardRow's role="button").
          e.stopPropagation();
          handleToggle();
        }}
      >
        {trigger ?? <MoreVertical width={16} height={16} strokeWidth={2} aria-hidden />}
      </button>
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className={`deck-row-menu-popover overflow-menu-popover${
              panelClassName ? ` ${panelClassName}` : ''
            }`}
            role="menu"
            aria-label={ariaLabel}
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
            {header}
            {allItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={`deck-row-menu-item${item.danger ? ' deck-row-menu-item--danger' : ''}`}
                  onClick={(e) => {
                    // Portaled clicks still bubble through the React tree to a
                    // clickable ancestor row — stop that here.
                    e.stopPropagation();
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
