import type { ReactNode } from 'react';

export interface ViewModeOption<T extends string> {
  /** The view-mode value this button represents. */
  value: T;
  /** Visible-on-hover tooltip + aria-label. */
  label: string;
  /** Icon rendered inside the pill. */
  icon: ReactNode;
}

interface Props<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: Array<ViewModeOption<T>>;
  /** Optional override for the group's aria-label. */
  ariaLabel?: string;
  /** Optional className appended to the wrapper for one-off positioning. */
  className?: string;
}

/**
 * Shared segmented toggle used everywhere the app exposes view modes
 * (binder pages/list/compact, collection grid/list/compact, deck
 * grid/list/text). Single source of styling + behavior so the buttons
 * look and feel identical across pages.
 */
export function ViewModeToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel = 'View mode',
  className,
}: Props<T>) {
  return (
    <div
      className={`toolbar-viewmode${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`toolbar-viewmode-btn${value === opt.value ? ' active' : ''}`}
          aria-pressed={value === opt.value}
          aria-label={opt.label}
          title={opt.label}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
