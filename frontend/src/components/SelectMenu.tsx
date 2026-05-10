import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface SelectOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Visible only inside the popover; falls back to `label` when omitted. */
  itemLabel?: ReactNode;
  /** Hidden text used when the trigger renders this option's label. */
  triggerLabel?: ReactNode;
}

interface Props<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Visible label rendered before the value, e.g. "Sort". */
  label?: ReactNode;
  /** aria-label for the trigger when no visible label is rendered. */
  ariaLabel?: string;
  /** Optional small icon rendered inside the trigger (e.g. sort direction). */
  leadingIcon?: ReactNode;
  /** Optional check / state element rendered before each option. */
  renderItemPrefix?: (option: SelectOption<T>, active: boolean) => ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Themed single-choice dropdown. Uses the same `toolbar-pill` + popover
 * styles the rest of the app already uses for sort / show-prefs menus,
 * so it slots in alongside them visually.
 *
 * Replaces native <select> in places where the browser-default styling
 * fights the guild theme (and on mobile, defaults to a system sheet).
 */
export function SelectMenu<T extends string | number>({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  leadingIcon,
  renderItemPrefix,
  disabled = false,
  className,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
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

  const active = options.find((o) => o.value === value);
  const triggerValue = active?.triggerLabel ?? active?.label;

  return (
    <div className={`toolbar-popover${className ? ` ${className}` : ''}`} ref={wrapperRef}>
      <button
        type="button"
        className={`toolbar-pill${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={!label ? ariaLabel : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {leadingIcon}
        {label && <span className="toolbar-pill-label">{label}</span>}
        {triggerValue !== undefined && triggerValue !== null && (
          <span className="toolbar-pill-value">{triggerValue}</span>
        )}
        <ChevronDown />
      </button>
      {open && (
        <div className="toolbar-popover-panel">
          <ul className="toolbar-popover-list" role="listbox" aria-label={ariaLabel ?? undefined}>
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`toolbar-popover-item${isActive ? ' active' : ''}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <span className="toolbar-popover-check" aria-hidden>
                      {renderItemPrefix ? renderItemPrefix(opt, isActive) : isActive ? '✓' : ''}
                    </span>
                    {opt.itemLabel ?? opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
