import { createPortal } from 'react-dom';
import { ColorPip } from './shared/ManaSymbol';
import { FilterTrigger } from './shared/FilterTrigger';
import { FILTER_COLOR_OPTIONS } from '@/lib/colors';
import { useAnchoredPanel } from '@/lib/use-anchored-panel';
import {
  COMBO_RESULT_LABELS,
  countActiveFilters,
  emptyComboFilters,
  type ComboFilterState,
  type ComboPieceCount,
  type ComboResultKind,
} from '../lib/combo-filters';

const RESULT_OPTIONS = (
  Object.entries(COMBO_RESULT_LABELS) as Array<[ComboResultKind, string]>
).map(([key, label]) => ({ key, label }));

const PIECE_OPTIONS: Array<{ key: ComboPieceCount; label: string }> = [
  { key: '2', label: '2 cards' },
  { key: '3', label: '3 cards' },
  { key: '4+', label: '4+ cards' },
];

interface Props {
  filters: ComboFilterState;
  setFilters: (next: ComboFilterState) => void;
  /** Disables the host toggle when the user owns no commanders to check against. */
  hasCommanders: boolean;
}

/**
 * Filters anchored to the combos search pill's trailing slot. Mirrors
 * DeckFiltersPopover's structure and reuses its classes wholesale, so the
 * search-pill affordance looks identical across pages — colour row, chip
 * sections, live toggling (no Apply staging).
 */
export function ComboFiltersPopover({ filters, setFilters, hasCommanders }: Props) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel();

  const activeCount = countActiveFilters(filters);
  const hasActive = activeCount > 0;

  /** Toggle membership of `value` in one of the Set-valued filter fields. */
  const toggleIn = <K extends 'colors' | 'results' | 'pieceCounts'>(
    key: K,
    value: ComboFilterState[K] extends Set<infer T> ? T : never
  ) => {
    const next = new Set(filters[key]) as ComboFilterState[K];
    if ((next as Set<unknown>).has(value)) (next as Set<unknown>).delete(value);
    else (next as Set<unknown>).add(value);
    setFilters({ ...filters, [key]: next });
  };

  return (
    <div className="filter-popover deck-filters-popover">
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
            className="filter-popover-panel deck-filters-panel"
            role="dialog"
            aria-label="Filters"
            style={panelStyle}
          >
            <section className="deck-filters-section">
              {/* "Fits in" not "has" — selecting U+B shows combos you could run
                  in a UB deck, i.e. identity ⊆ selection. */}
              <div className="deck-filters-section-label">Fits in colors</div>
              <div className="color-filter-row" role="group" aria-label="Filter by color identity">
                {FILTER_COLOR_OPTIONS.map((c) => {
                  const active = filters.colors.has(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={`color-filter-btn${active ? ' is-active' : ''}`}
                      onClick={() => toggleIn('colors', c.key)}
                      aria-label={c.label}
                      aria-pressed={active}
                      title={c.label}
                    >
                      <ColorPip color={c.key} pip="lg" />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="deck-filters-section">
              <div className="deck-filters-section-label">Result</div>
              <div className="deck-filters-chips" role="group" aria-label="Filter by result">
                {RESULT_OPTIONS.map((r) => {
                  const active = filters.results.has(r.key);
                  return (
                    <button
                      key={r.key}
                      type="button"
                      className={`deck-filter-chip${active ? ' is-active' : ''}`}
                      onClick={() => toggleIn('results', r.key)}
                      aria-pressed={active}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="deck-filters-section">
              <div className="deck-filters-section-label">Pieces</div>
              <div className="deck-filters-chips" role="group" aria-label="Filter by piece count">
                {PIECE_OPTIONS.map((p) => {
                  const active = filters.pieceCounts.has(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      className={`deck-filter-chip${active ? ' is-active' : ''}`}
                      onClick={() => toggleIn('pieceCounts', p.key)}
                      aria-pressed={active}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="deck-filters-section">
              <div className="deck-filters-section-label">Commanders</div>
              <div className="deck-filters-chips" role="group" aria-label="Filter by hostability">
                <button
                  type="button"
                  className={`deck-filter-chip${filters.hostOnly ? ' is-active' : ''}`}
                  onClick={() => setFilters({ ...filters, hostOnly: !filters.hostOnly })}
                  aria-pressed={filters.hostOnly}
                  disabled={!hasCommanders}
                  title={
                    hasCommanders
                      ? 'Only combos one of your commanders could legally run'
                      : "You don't own any commander-eligible cards yet"
                  }
                >
                  One of mine can host it
                </button>
              </div>
            </section>

            {hasActive && (
              <div className="deck-filters-footer">
                <button
                  type="button"
                  className="btn-link deck-filters-clear"
                  onClick={() => setFilters(emptyComboFilters())}
                >
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
