import { ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMenuKeyboard } from '@/lib/use-menu-keyboard';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';

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
  /**
   * Render a filter input atop the panel that narrows the option list as you
   * type (a searchable dropdown / combobox). Use for long closed vocabularies
   * like oracle tags. The input gets initial focus on open; ArrowDown moves
   * into the list, Enter picks the first match. Matches each option's label
   * text + value.
   */
  searchable?: boolean;
  /** Placeholder for the search input (searchable mode). */
  searchPlaceholder?: string;
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
  searchable = false,
  searchPlaceholder = 'Search…',
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Listbox popup, not a menu — same keyboard contract though (arrows /
  // Home/End / Escape-returns-focus / outside pointerdown), with initial
  // focus landing on the currently selected option instead of the first.
  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef: buttonRef,
    itemSelector: '[role="option"]',
    // Searchable mode lands focus on the filter input; otherwise on the
    // currently-selected option.
    initialItemSelector: searchable
      ? '.toolbar-popover-search-input'
      : '[role="option"][aria-selected="true"]',
  });

  // After the panel renders in the portal, measure it and clamp/flip it into
  // the safe viewport (subtracts sticky header + mobile tab-bar + keyboard
  // inset). useLayoutEffect fires before paint so there is no visible flash.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      safe,
      'right',
      6
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  // Keyboard semantics + Escape + outside-pointerdown close live in
  // useMenuKeyboard. This effect only closes the panel if the trigger scrolls
  // out of view (e.g. modal scroll). Delayed by one frame so focus-triggered
  // micro-scrolls from the opening click don't immediately close the panel.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current && panelRef.current.contains(target)) return;
      setOpen(false);
    };
    let scrollRaf = 0;
    scrollRaf = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    });
    return () => {
      cancelAnimationFrame(scrollRaf);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  const handleToggle = () => {
    if (!open) {
      setQuery(''); // fresh filter each time the panel opens
    }
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

  const pick = (v: T) => {
    onChange(v);
    if (closeOnSelect) closeAndReturnFocus();
    else setQuery(''); // stay open (multi-pick) — reset the filter for the next add
  };

  // Filter by option label text + value when searching.
  const q = query.trim().toLowerCase();
  const visibleOptions =
    searchable && q
      ? options.filter((o) => {
          const text = typeof o.label === 'string' ? o.label : String(o.value);
          return text.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q);
        })
      : options;

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
          // Scale the enter animation from the trigger corner: anchored-side
          // top/bottom + left/right mirror how the panel was placed.
          transformOrigin: `${panelPos.top !== undefined ? 'top' : 'bottom'} ${
            panelPos.left !== undefined ? 'left' : 'right'
          }`,
        }}
      >
        {searchable && (
          <input
            type="search"
            className="toolbar-popover-search-input"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks the first match; ArrowDown/Escape are handled by
              // useMenuKeyboard at the document level (it ignores text keys).
              if (e.key === 'Enter') {
                e.preventDefault();
                if (visibleOptions[0]) pick(visibleOptions[0].value);
              }
            }}
          />
        )}
        <ul className="toolbar-popover-list" role="listbox" aria-label={ariaLabel ?? undefined}>
          {visibleOptions.length === 0 ? (
            <li className="toolbar-popover-empty" aria-disabled>
              No matches
            </li>
          ) : (
            visibleOptions.map((opt) => {
              const isActive = opt.value === value;
              return (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`toolbar-popover-item${isActive ? ' active' : ''}`}
                    onClick={() => pick(opt.value)}
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
            })
          )}
        </ul>
      </div>,
      document.body
    );

  return (
    <div className={`toolbar-popover${className ? ` ${className}` : ''}`}>
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
        <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
      </button>
      {panel}
    </div>
  );
}
