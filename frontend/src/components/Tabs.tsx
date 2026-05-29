import { useRef, type ReactNode, type Ref } from 'react';

export interface TabItem<T extends string> {
  /** Stable id — also used to derive the tab button's DOM id. */
  id: T;
  /** Visible label (text or rich node). */
  label: ReactNode;
  /** Optional pill count badge (e.g. combo counts). `null`/omitted hides it. */
  count?: number | null;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Overrides the button's accessible name when the label isn't plain text. */
  ariaLabel?: string;
  /** id of the tabpanel this tab controls (sets aria-controls). */
  controls?: string;
}

interface Props<T extends string> {
  tabs: Array<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** Required — names the tablist for assistive tech. */
  ariaLabel: string;
  /** Appended to the wrapper for one-off positioning. */
  className?: string;
  /**
   * `fitted` (default) — tabs share the row equally (the 2-tab combos/analysis
   * look). `scrollable` — tabs size to content and the strip scrolls
   * horizontally on overflow (the multi-tab analysis surface).
   */
  variant?: 'fitted' | 'scrollable';
  /**
   * Forwarded to the FIRST tab's button. Lets a parent panel focus the strip
   * when it reveals itself (mirrors the old reveal() → firstButtonRef.focus()).
   */
  firstTabRef?: Ref<HTMLButtonElement>;
}

/**
 * Shared tablist primitive extracted from the in-house `.deck-combos-tabs`
 * pattern so every tabbed surface (combos, analysis, the deck-stats surface)
 * decodes keyboard + ARIA the same way and can't drift apart.
 *
 * Implements the WAI-ARIA "tabs with automatic activation" pattern: roving
 * tabindex, ←/→ (and ↑/↓) move + select, Home/End jump to the ends. Selection
 * follows focus. Consumers render the active panel themselves and should give
 * it `role="tabpanel"` + `aria-labelledby={`sc-tab-${activeId}`}`.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
  variant = 'fitted',
  firstTabRef,
}: Props<T>) {
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusSelect = (rawIdx: number) => {
    if (tabs.length === 0) return;
    const idx = ((rawIdx % tabs.length) + tabs.length) % tabs.length;
    const next = tabs[idx];
    if (!next) return;
    onChange(next.id);
    // Move focus to the newly-selected tab so keyboard users track selection.
    btnRefs.current[idx]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusSelect(idx + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusSelect(idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusSelect(0);
        break;
      case 'End':
        e.preventDefault();
        focusSelect(tabs.length - 1);
        break;
    }
  };

  return (
    <div
      className={`sc-tabs sc-tabs--${variant}${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              btnRefs.current[i] = el;
              if (i === 0 && firstTabRef) {
                if (typeof firstTabRef === 'function') firstTabRef(el);
                else (firstTabRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
              }
            }}
            type="button"
            role="tab"
            id={`sc-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={t.controls}
            aria-label={t.ariaLabel}
            tabIndex={selected ? 0 : -1}
            className={`sc-tab${selected ? ' active' : ''}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.icon}
            {t.label}
            {typeof t.count === 'number' && (
              <span className="sc-tab-count" aria-hidden>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
