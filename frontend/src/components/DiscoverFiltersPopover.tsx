import './DiscoverFiltersPopover.css';
import { ListFilter } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { BRACKET_LABELS } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';
import {
  DISCOVER_COLOR_ORDER,
  type DiscoverBudgetKey,
  type DiscoverFilters,
} from '@/lib/discover-filters';
import type { DeckFormat } from '@/deck-builder/types';
import { ColorPip } from './shared/ManaSymbol';

const COLOR_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

const BRACKET_OPTIONS = [1, 2, 3, 4, 5];

const BUDGET_OPTIONS: Array<{ key: DiscoverBudgetKey; label: string }> = [
  { key: 'under50', label: 'Under $50' },
  { key: '50to150', label: '$50–$150' },
  { key: '150to400', label: '$150–$400' },
  { key: '400plus', label: '$400+' },
];

interface Props {
  filters: DiscoverFilters;
  onChange: (next: DiscoverFilters) => void;
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * Colors/Format/Bracket/Budget filters for the Discover browse. Structurally
 * mirrors the real `DeckFiltersPopover.tsx` exactly (verified source, not a
 * misremembered summary): portaled to `document.body`,
 * `computePopoverPlacement`/`getSafeViewport` for flip/clamp, live-toggle
 * with no separate Apply step. Deliberately matches that component's real
 * a11y shape too — `role="dialog"`, no `aria-modal`, no focus trap, no
 * auto-focus, no explicit refocus on close (a known, pre-existing gap shared
 * with the sibling `/decks` filters popover, not this PR's problem to fix).
 *
 * Unlike DeckFiltersPopover's button/aria-pressed chips, every option here is
 * a real `<input type="radio"|"checkbox">` inside a `<fieldset><legend>` (the
 * visually-hidden-input-stretched-over-a-styled-label pattern the Settings
 * currency toggle already uses) — Format/Budget are single-select radios that
 * close the popover on pick, Colors/Bracket are multi-select checkboxes that
 * stay open.
 */
export function DiscoverFiltersPopover({ filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeCount =
    (filters.format ? 1 : 0) +
    filters.colors.length +
    filters.brackets.length +
    (filters.budget ? 1 : 0);
  const hasActive = activeCount > 0;

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      safe,
      'right'
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
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

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  // Format/Budget: single-value radios close the popover on pick.
  const setFormat = (format: DeckFormat | null) => {
    onChange({ ...filters, format });
    setOpen(false);
  };
  const setBudget = (budget: DiscoverBudgetKey | null) => {
    onChange({ ...filters, budget });
    setOpen(false);
  };
  // Colors/Bracket: multi-value checkboxes stay open.
  const toggleColor = (c: string) => {
    const set = new Set(filters.colors);
    if (set.has(c)) set.delete(c);
    else set.add(c);
    onChange({ ...filters, colors: DISCOVER_COLOR_ORDER.filter((k) => set.has(k)) });
  };
  const toggleBracket = (n: number) => {
    const set = new Set(filters.brackets);
    if (set.has(n)) set.delete(n);
    else set.add(n);
    onChange({ ...filters, brackets: [...set].sort((a, b) => a - b) });
  };
  const clearAll = () =>
    onChange({ ...filters, format: null, colors: [], brackets: [], budget: null });

  const formatEntries = Object.entries(DECK_FORMAT_CONFIGS) as Array<
    [DeckFormat, (typeof DECK_FORMAT_CONFIGS)[DeckFormat]]
  >;

  return (
    <div className="filter-popover discover-filters-popover">
      <button
        ref={buttonRef}
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasActive ? `Filters, ${activeCount} active` : 'Filters'}
        title="Filters"
        onClick={handleToggle}
      >
        <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
        {hasActive && (
          <span className="collection-filters-badge" aria-hidden>
            {activeCount}
          </span>
        )}
      </button>
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className="filter-popover-panel discover-filters-panel"
            role="dialog"
            aria-label="Filters"
            style={{
              position: 'fixed',
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              right: panelPos.right,
            }}
          >
            <fieldset className="discover-filters-section">
              <legend className="discover-filters-legend">Format</legend>
              <div className="discover-filters-chips">
                <label className="discover-filter-chip">
                  <input
                    type="radio"
                    name="discover-format"
                    checked={filters.format === null}
                    onChange={() => setFormat(null)}
                  />
                  <span>Any</span>
                </label>
                {formatEntries.map(([key, cfg]) => (
                  <label key={key} className="discover-filter-chip">
                    <input
                      type="radio"
                      name="discover-format"
                      checked={filters.format === key}
                      onChange={() => setFormat(key)}
                    />
                    <span>{cfg.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="discover-filters-section">
              <legend className="discover-filters-legend">Colors</legend>
              <div className="discover-filters-chips" aria-label="Filter by color">
                {COLOR_OPTIONS.map((c) => (
                  <label
                    key={c.key}
                    className="discover-filter-chip discover-filter-chip--color"
                    title={c.label}
                  >
                    <input
                      type="checkbox"
                      checked={filters.colors.includes(c.key)}
                      onChange={() => toggleColor(c.key)}
                    />
                    <ColorPip color={c.key} pip="lg" />
                    <span className="sr-only">{c.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="discover-filters-section">
              <legend className="discover-filters-legend">Bracket</legend>
              <div className="discover-filters-chips">
                {BRACKET_OPTIONS.map((n) => (
                  <label key={n} className="discover-filter-chip">
                    <input
                      type="checkbox"
                      checked={filters.brackets.includes(n)}
                      onChange={() => toggleBracket(n)}
                    />
                    <span>{BRACKET_LABELS[n]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="discover-filters-section">
              <legend className="discover-filters-legend">Budget</legend>
              <div className="discover-filters-chips">
                <label className="discover-filter-chip">
                  <input
                    type="radio"
                    name="discover-budget"
                    checked={filters.budget === null}
                    onChange={() => setBudget(null)}
                  />
                  <span>Any</span>
                </label>
                {BUDGET_OPTIONS.map((b) => (
                  <label key={b.key} className="discover-filter-chip">
                    <input
                      type="radio"
                      name="discover-budget"
                      checked={filters.budget === b.key}
                      onChange={() => setBudget(b.key)}
                    />
                    <span>{b.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {hasActive && (
              <div className="deck-filters-footer">
                <button type="button" className="btn-link deck-filters-clear" onClick={clearAll}>
                  Clear filters
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
