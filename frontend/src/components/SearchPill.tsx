import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /**
   * Trailing slot rendered inside the pill at the right edge — typically
   * a filter / options popover button, or a loading spinner for async
   * searches. The pill stays the visual "frame" regardless of what gets
   * inserted here.
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
  /** Focus the input on mount. Callers should gate this on a fine pointer so
   * the soft keyboard doesn't pop up on touch. */
  autoFocus?: boolean;
  /**
   * 'search' (default) renders <input type="search">. Use 'text' for the few
   * spots that must avoid the native search control — e.g. the Android WebView
   * paints type=search with an opaque light background that ignores a dark
   * theme, and combobox inputs that don't want the browser's clear affordance.
   */
  inputType?: 'search' | 'text';
  /**
   * Escape hatch for the native / ARIA attributes the async search-and-pick
   * callers need on the underlying input — combobox `role` + `aria-*`,
   * `inputMode`, `enterKeyHint`, `autoCapitalize`, `onKeyDown`, etc. Spread
   * first so the controlled props below (value/onChange/type/…) always win.
   */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

/**
 * Shared rounded "search pill" — the input itself loses its border and
 * background; the wrapper takes them, so any trailing slot (filter
 * popover, action button, spinner) sits visually inside the same rail as
 * the text field. Used across the binder, collection, deck, rules, and
 * card-search surfaces so the search affordance looks identical everywhere.
 *
 * forwardRef exposes the input for callers that focus it imperatively
 * (e.g. a parent's focusInput() handle or arrow-key result navigation).
 */
export const SearchPill = forwardRef<HTMLInputElement, Props>(function SearchPill(
  {
    value,
    onChange,
    placeholder = 'Search…',
    trailing,
    ariaLabel,
    className,
    hideClear = false,
    inputId,
    autoFocus,
    inputType = 'search',
    inputProps,
  },
  ref
) {
  return (
    <div className={`search-pill${className ? ` ${className}` : ''}`}>
      <Search className="search-pill-icon" width={16} height={16} strokeWidth={2} aria-hidden />
      <input
        {...inputProps}
        ref={ref}
        id={inputId}
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
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
});
