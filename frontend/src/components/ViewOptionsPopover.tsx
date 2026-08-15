import { Eye } from 'lucide-react';
import { createPortal } from 'react-dom';
import { type ReactNode } from 'react';
import { useAnchoredPanel } from '@/lib/use-anchored-panel';

export interface ViewToggle {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
  value: boolean;
  onChange: (next: boolean) => void;
  /**
   * The "neutral" state for this toggle. The trigger dot shows up when
   * value differs from defaultValue — so a default-on toggle (e.g.
   * the binder's "Show card images") only signals when the user has
   * actively changed it.
   */
  defaultValue?: boolean;
}

interface Props {
  /** Toggle rows shown inside the popover. */
  toggles: ViewToggle[];
  /** aria-label for the trigger button and the panel. */
  ariaLabel: string;
}

/**
 * Display-option toggles that tuck into a `<SearchPill>`'s trailing slot.
 *
 * This was `FilterPopover` with a funnel icon and a default `ariaLabel` of
 * "Filters" — for a panel that filters nothing. Its only caller already
 * overrode the label to "Binder options", so the funnel was pure
 * misdirection: it sat beside a binder whose REAL filters are its rules, and
 * matched the glyph of the four popovers that genuinely do filter. It now
 * carries the `Eye` glyph the collection's own View popover uses, so
 * "changes what I see" and "changes what's included" read as different things.
 */
export function ViewOptionsPopover({ toggles, ariaLabel }: Props) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel();

  const activeCount = toggles.filter((t) => t.value !== (t.defaultValue ?? false)).length;

  return (
    <div className="filter-popover">
      <button
        ref={triggerRef}
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={activeCount > 0 ? `${ariaLabel} (${activeCount} changed)` : ariaLabel}
        title={ariaLabel}
        onClick={toggle}
      >
        <Eye width={16} height={16} strokeWidth={2} aria-hidden />
        {activeCount > 0 && (
          <span className="collection-filters-badge" aria-hidden>
            {activeCount}
          </span>
        )}
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            className="filter-popover-panel"
            // `role="menu"` here was a lie — the panel's children are checkbox
            // rows, not menuitems, so AT announced a menu with no items in it.
            role="dialog"
            aria-label={ariaLabel}
            style={panelStyle}
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
