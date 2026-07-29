import { ListFilter } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';
import { useMenuKeyboard } from '@/lib/use-menu-keyboard';

export interface FilterToggle {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
  value: boolean;
  onChange: (next: boolean) => void;
  /**
   * The "neutral" state for this toggle. The trigger dot shows up when
   * value differs from defaultValue — so a default-on toggle (e.g.
   * collection's "Group printings") only signals when the user has
   * actively changed it.
   */
  defaultValue?: boolean;
}

interface Props {
  /** Toggle rows shown inside the popover. */
  toggles: FilterToggle[];
  /** aria-label for the trigger button (and the popover trigger group). */
  ariaLabel?: string;
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * Small inline filter popover — anchored to a magnifier-icon trigger so
 * it tucks neatly inside the trailing slot of <SearchPill>. A numeric
 * count badge on the trigger (matching the collection search bar's
 * CollectionFiltersDialog) shows how many toggles are active, themed
 * checkboxes inside, single column of rows. Used by binder + collection
 * list options today; any future on-toolbar option set can drop in.
 *
 * Portals the panel to `<body>` and uses `computePopoverPlacement` so it
 * flips/clamps against the safe viewport (accounting for sticky header,
 * mobile bottom nav, and keyboard inset). No longer depends on positioned
 * ancestors — safe in any container.
 */
export function FilterPopover({ toggles, ariaLabel = 'Filters' }: Props) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeCount = toggles.filter((t) => t.value !== (t.defaultValue ?? false)).length;
  const anyActive = activeCount > 0;

  // After the panel renders in the portal, measure and clamp/flip into the safe
  // viewport. useLayoutEffect fires before paint so there is no visible flash.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      safe,
      'right'
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  // Dismiss/focus/back semantics, including dismissing when the page scrolls
  // out from under this fixed-position panel.
  useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef: buttonRef,
    dialog: true,
  });

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      // Initial estimate so the panel renders at the right position before
      // the layout effect refines it.
      const r = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="filter-popover">
      <button
        ref={buttonRef}
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={anyActive ? `${ariaLabel} (${activeCount} active)` : ariaLabel}
        title={ariaLabel}
        onClick={handleToggle}
      >
        <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
        {anyActive && (
          <span className="collection-filters-badge" aria-hidden>
            {activeCount}
          </span>
        )}
      </button>
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className="filter-popover-panel"
            // `role="menu"` here was a lie — the panel's children are checkbox
            // rows, not menuitems, so AT announced a menu with no items in it.
            role="dialog"
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              right: panelPos.right,
            }}
          >
            {toggles.map((t) => (
              <label key={t.key} className="filter-popover-row">
                <input
                  type="checkbox"
                  checked={t.value}
                  onChange={(e) => t.onChange(e.target.checked)}
                />
                <span className="filter-popover-label">
                  {t.label}
                  {t.hint && <span className="filter-popover-hint">{t.hint}</span>}
                </span>
              </label>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
