import { ListFilter } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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

/**
 * Small inline filter popover — anchored to a magnifier-icon trigger so
 * it tucks neatly inside the trailing slot of <SearchPill>. A numeric
 * count badge on the trigger (matching the collection search bar's
 * CollectionFiltersDialog) shows how many toggles are active, themed
 * checkboxes inside, single column of rows. Used by binder + collection
 * list options today; any future on-toolbar option set can drop in.
 */
export function FilterPopover({ toggles, ariaLabel = 'Filters' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // "Active" = value != neutral. defaultValue defaults to false, so a
  // toggle that's on without an explicit default still flags as active.
  const activeCount = toggles.filter((t) => t.value !== (t.defaultValue ?? false)).length;
  const anyActive = activeCount > 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div className="filter-popover" ref={wrapperRef}>
      <button
        type="button"
        className="filter-popover-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={anyActive ? `${ariaLabel} (${activeCount} active)` : ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
        {anyActive && (
          <span className="collection-filters-badge" aria-hidden>
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="filter-popover-panel" role="menu">
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
        </div>
      )}
    </div>
  );
}
