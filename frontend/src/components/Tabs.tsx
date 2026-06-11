import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';

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
   * horizontally on overflow. `hub` — the app-wide section-nav look (reuses the
   * Collection hub's `.site-nav-link` / `.site-nav-count` styling). `underline`
   * — flat labels with an accent underline tracking the active tab (the
   * page-level "distinct views" switcher, e.g. the deck editor's view bar);
   * scrolls horizontally on overflow.
   */
  variant?: 'fitted' | 'scrollable' | 'hub' | 'underline';
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
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // First paint positions the indicator without animating (no slide-in-from-0).
  const hasPositionedRef = useRef(false);
  const isUnderline = variant === 'underline';

  // Stable key so the layout effect re-measures on tab add/remove without
  // re-running on every render (consumers often pass a fresh `tabs` array).
  const tabKey = tabs.map((t) => t.id).join(' ');

  // UX-207 — sliding underline indicator. A single measured element travels
  // between tabs (translateX + scaleX from a 1px base, so only transform
  // animates — never layout). Re-measured on value change, tab add/remove,
  // and any strip/active-tab resize. Reduced motion jumps instantly via the
  // CSS gate on .sc-tab-indicator.
  useLayoutEffect(() => {
    if (!isUnderline) return;
    const indicator = indicatorRef.current;
    const list = listRef.current;
    if (!indicator || !list) return;

    const position = (animate: boolean) => {
      const btn = list.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      if (!btn || btn.offsetWidth === 0) {
        // Nothing measurable (empty tabs / display:none strip) — hide; the
        // ResizeObserver re-fires once the strip gets real layout.
        indicator.style.opacity = '0';
        return;
      }
      const next = `translateX(${btn.offsetLeft}px) scaleX(${btn.offsetWidth})`;
      // Unchanged target → bail. This is what keeps the ResizeObserver's
      // initial (no-op) delivery from snapping an in-flight slide to its end.
      if (indicator.style.transform === next && indicator.style.opacity === '1') return;
      if (!animate) {
        // Suppress the transition for this frame only, then restore the
        // stylesheet value so later value-changes still slide.
        indicator.style.transition = 'none';
        requestAnimationFrame(() => {
          indicator.style.transition = '';
        });
      }
      indicator.style.opacity = '1';
      indicator.style.transform = next;
    };

    position(hasPositionedRef.current);
    hasPositionedRef.current = true;

    // Container resize, label/count width changes, late font loads: re-measure
    // and jump (resizes shouldn't slide). Guarded for DOM-less test envs.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => position(false));
    ro.observe(list);
    const activeBtn = list.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    if (activeBtn) ro.observe(activeBtn);
    return () => ro.disconnect();
  }, [isUnderline, value, tabKey]);

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

  // `hub` reuses the global section-nav styling so the deck surface tabs match
  // the Collection hub (Cards / Binders / Lists); other variants use the local
  // `.sc-tab` look.
  const isHub = variant === 'hub';
  const tabClass = isHub ? 'site-nav-link' : 'sc-tab';
  const countClass = isHub ? 'site-nav-count' : 'sc-tab-count';

  return (
    <div
      ref={listRef}
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
            className={`${tabClass}${selected ? ' active' : ''}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.icon}
            {t.label}
            {typeof t.count === 'number' && (
              <span className={countClass} aria-hidden>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
      {/* Decorative sliding underline — the buttons carry all the semantics. */}
      {isUnderline && <span ref={indicatorRef} className="sc-tab-indicator" aria-hidden="true" />}
    </div>
  );
}
