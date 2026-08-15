import './DiscoverFiltersPopover.css';
import { createPortal } from 'react-dom';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { BRACKET_LABELS } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { FILTER_COLOR_OPTIONS } from '@/lib/colors';
import { useAnchoredPanel } from '@/lib/use-anchored-panel';
import {
  DISCOVER_BUDGET_LABELS,
  DISCOVER_COLOR_ORDER,
  type DiscoverBudgetKey,
  type DiscoverFilters,
} from '@/lib/discover-filters';
import type { DeckFormat } from '@/deck-builder/types';
import { ColorPip } from './shared/ManaSymbol';
import { FilterTrigger } from './shared/FilterTrigger';

const BRACKET_OPTIONS = [1, 2, 3, 4, 5];

const BUDGET_OPTIONS = (
  Object.entries(DISCOVER_BUDGET_LABELS) as Array<[DiscoverBudgetKey, string]>
).map(([key, label]) => ({ key, label }));

interface Props {
  filters: DiscoverFilters;
  onChange: (next: DiscoverFilters) => void;
}

/**
 * Colors/Format/Bracket/Budget filters for the Discover browse. Portal,
 * placement and dismiss come from `useAnchoredPanel`; live-toggle with no
 * separate Apply step, because these only change what you're looking at.
 *
 * Unlike DeckFiltersPopover's button/aria-pressed chips, every option here is
 * a real `<input type="radio"|"checkbox">` inside a `<fieldset><legend>` (the
 * visually-hidden-input-stretched-over-a-styled-label pattern the Settings
 * currency toggle already uses). Format/Budget are single-select radios,
 * Colors/Bracket multi-select checkboxes — but every one of them now leaves
 * the panel OPEN. Closing on a radio pick made this the only popover in the
 * family that vanished mid-edit, and it punished the common case: narrowing by
 * format and budget together meant reopening the panel to set the second one.
 */
export function DiscoverFiltersPopover({ filters, onChange }: Props) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel();

  const activeCount =
    (filters.format ? 1 : 0) +
    filters.colors.length +
    filters.brackets.length +
    (filters.budget ? 1 : 0);
  const hasActive = activeCount > 0;

  const setFormat = (format: DeckFormat | null) => onChange({ ...filters, format });
  const setBudget = (budget: DiscoverBudgetKey | null) => onChange({ ...filters, budget });
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
      <FilterTrigger
        ref={triggerRef}
        open={open}
        onClick={toggle}
        activeCount={activeCount}
        label="Filters"
      />
      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            className="filter-popover-panel discover-filters-panel"
            role="dialog"
            aria-label="Filters"
            style={panelStyle}
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
                {FILTER_COLOR_OPTIONS.map((c) => (
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
