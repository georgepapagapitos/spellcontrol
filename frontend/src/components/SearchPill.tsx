import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /**
   * Trailing slot rendered inside the pill at the right edge — typically
   * a filter / options popover button. The pill stays the visual "frame"
   * regardless of what gets inserted here.
   */
  trailing?: ReactNode;
  /** aria-label for screen readers; falls back to the placeholder. */
  ariaLabel?: string;
  /** Optional className for one-off positioning (e.g. flex sizing). */
  className?: string;
  /** Hide the inline Clear button. Defaults to false. */
  hideClear?: boolean;
  /** Optional id for the input — used by keyboard-shortcut handlers to focus it. */
  inputId?: string;
}

/**
 * Shared rounded "search pill" — the input itself loses its border and
 * background; the wrapper takes them, so any trailing slot (filter
 * popover, action button) sits visually inside the same rail as the
 * text field. Used by the binder, collection, and deck toolbars so the
 * search affordance looks identical across pages.
 */
export function SearchPill({
  value,
  onChange,
  placeholder = 'Search…',
  trailing,
  ariaLabel,
  className,
  hideClear = false,
  inputId,
}: Props) {
  return (
    <div className={`search-pill${className ? ` ${className}` : ''}`}>
      <Search className="search-pill-icon" width={16} height={16} strokeWidth={2} aria-hidden />
      <input
        id={inputId}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
      />
      {!hideClear && value && (
        <button
          type="button"
          className="search-pill-clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
          title="Clear search"
        >
          ×
        </button>
      )}
      {trailing}
    </div>
  );
}
