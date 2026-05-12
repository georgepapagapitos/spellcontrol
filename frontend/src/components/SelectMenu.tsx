import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
  /**
   * When provided the trigger shows this text whenever `value` doesn't match
   * any option — useful for "add item" dropdowns that always reset after a pick.
   */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** When false the panel stays open after picking an option (e.g. sort toggle). */
  closeOnSelect?: boolean;
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

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
  placeholder,
  disabled = false,
  className,
  closeOnSelect = true,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // After the panel renders in the portal, clamp it to the viewport: flip
  // upward if it overflows the bottom, and left-anchor if it clips the left
  // edge. useLayoutEffect fires before paint so there is no visible flash.
  // Deps are [open] only — the functional setter reads the latest panelPos
  // without creating a re-run loop when panelPos changes.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const triggerRect = buttonRef.current.getBoundingClientRect();
    setPanelPos((p) => {
      if (!p) return p;
      let next = p;
      if (p.top !== undefined && rect.bottom > window.innerHeight) {
        next = { ...next, top: undefined, bottom: window.innerHeight - triggerRect.top + 6 };
      }
      if (next.bottom !== undefined) {
        const upwardTop = triggerRect.top - 6 - rect.height;
        if (upwardTop < 8) {
          next = { ...next, top: 8, bottom: undefined };
        }
      }
      if (rect.left < 8) {
        next = { ...next, right: undefined, left: Math.max(8, triggerRect.left) };
      }
      return next === p ? p : next;
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Close if the trigger scrolls out of view (e.g. modal scroll).
    // Delayed by one frame so focus-triggered micro-scrolls from the opening
    // click don't immediately close the panel.
    const onScroll = () => {
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    let scrollRaf = 0;
    scrollRaf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(scrollRaf);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const right = Math.max(0, window.innerWidth - rect.right);
      setPanelPos(
        spaceBelow >= 160
          ? { top: rect.bottom + 6, right }
          : { bottom: window.innerHeight - rect.top + 6, right }
      );
    }
    setOpen((v) => !v);
  };

  const active = options.find((o) => o.value === value);
  const triggerValue = active?.triggerLabel ?? active?.label;

  const panel =
    open &&
    panelPos &&
    createPortal(
      <div
        ref={panelRef}
        className="toolbar-popover-panel toolbar-popover-panel--fixed"
        style={{
          position: 'fixed',
          left: panelPos.left,
          right: panelPos.right,
          top: panelPos.top,
          bottom: panelPos.bottom,
          zIndex: 1200,
        }}
      >
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
                    if (closeOnSelect) setOpen(false);
                  }}
                >
                  {renderItemPrefix && (
                    <span className="toolbar-popover-check" aria-hidden>
                      {renderItemPrefix(opt, isActive)}
                    </span>
                  )}
                  {opt.itemLabel ?? opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>,
      document.body
    );

  return (
    <div className={`toolbar-popover${className ? ` ${className}` : ''}`} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`toolbar-pill${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={!label ? ariaLabel : undefined}
        disabled={disabled}
        onClick={handleToggle}
      >
        {leadingIcon}
        {label && <span className="toolbar-pill-label">{label}</span>}
        {triggerValue !== undefined && triggerValue !== null ? (
          <span className="toolbar-pill-value">{triggerValue}</span>
        ) : placeholder ? (
          <span className="toolbar-pill-value toolbar-pill-placeholder">{placeholder}</span>
        ) : null}
        <ChevronDown />
      </button>
      {panel}
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
