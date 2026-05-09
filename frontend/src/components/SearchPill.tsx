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
}: Props) {
  return (
    <div className={`search-pill${className ? ` ${className}` : ''}`}>
      <SearchIcon />
      <input
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

function SearchIcon() {
  return (
    <svg
      className="search-pill-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
