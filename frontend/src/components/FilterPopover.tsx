import { ListFilter } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';

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

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        aria-haspopup="menu"
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
            role="menu"
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
