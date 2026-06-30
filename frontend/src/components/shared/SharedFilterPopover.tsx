import { ListFilter, X } from 'lucide-react';
import { useState } from 'react';
import type { DeckBucketKey, SharedFilters } from '../../lib/shared-grouping';
import { countSharedFilters, emptySharedFilters } from '../../lib/shared-grouping';
import { NumberRangeInput } from '../FilterFieldEditor';
import { Modal } from '../Modal';
import { ColorPip } from './ManaSymbol';

const COLOR_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

interface Props {
  filters: SharedFilters;
  setFilters: (next: SharedFilters) => void;
  /** Facet options derived from the data present (only show what exists). */
  rarities: string[];
  types: DeckBucketKey[];
  sets: Array<{ code: string; name: string }>;
  /** Show the Value (price) facet. Off for deck shares — deck cards carry no
   *  real price (placeholder 0), so a price range would match nothing. */
  showValue?: boolean;
}

function toggle<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Faceted filter for the shared collection / binder / deck views. Opens the
 * same `collection-filters-dialog` Modal the authed collection uses — a
 * breakpoint-responsive centered sheet (width steps 28→32→36rem, max-height
 * 90vh, internally scrolling body) — rather than a trigger-anchored popover,
 * so it can't clip off-screen on mobile. Facets are limited to what the public
 * share payload carries: Color, Rarity, Type, Set, Value (optional), Mana
 * value. Each section only renders when that facet has options in the data.
 *
 * Filters toggle live (no Apply staging) — the share view re-filters on every
 * change, matching the decks index and main collection toolbar affordance.
 */
export function SharedFilterPopover({
  filters,
  setFilters,
  rarities,
  types,
  sets,
  showValue = true,
}: Props) {
  const [open, setOpen] = useState(false);

  const activeCount = countSharedFilters(filters);
  const hasActive = activeCount > 0;

  return (
    <div className="filter-popover">
      <button
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasActive ? `Filters (${activeCount} active)` : 'Filters'}
        title="Filters"
        onClick={() => setOpen(true)}
      >
        <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
        {hasActive && (
          <span className="collection-filters-badge" aria-hidden>
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} label="Filters" className="collection-filters-dialog">
          <header className="collection-filters-dialog-header">
            <span className="collection-filters-dialog-title">Filters</span>
            <button
              type="button"
              className="collection-filters-dialog-close"
              onClick={() => setOpen(false)}
              aria-label="Close filters"
              title="Close"
            >
              <X width={20} height={20} strokeWidth={1.8} aria-hidden />
            </button>
          </header>

          <div className="collection-filters-dialog-body">
            <section className="collection-filters-section">
              <div className="collection-filters-section-label">Color</div>
              <div className="color-filter-row" role="group" aria-label="Filter by color">
                {COLOR_OPTIONS.map((c) => {
                  const active = filters.colors.has(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={`color-filter-btn${active ? ' is-active' : ''}`}
                      onClick={() =>
                        setFilters({ ...filters, colors: toggle(filters.colors, c.key) })
                      }
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

            {rarities.length > 0 && (
              <section className="collection-filters-section">
                <div className="collection-filters-section-label">Rarity</div>
                <div className="deck-filters-chips" role="group" aria-label="Filter by rarity">
                  {rarities.map((r) => {
                    const active = filters.rarities.has(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        className={`deck-filter-chip${active ? ' is-active' : ''}`}
                        onClick={() =>
                          setFilters({ ...filters, rarities: toggle(filters.rarities, r) })
                        }
                        aria-pressed={active}
                      >
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {types.length > 0 && (
              <section className="collection-filters-section">
                <div className="collection-filters-section-label">Type</div>
                <div className="deck-filters-chips" role="group" aria-label="Filter by type">
                  {types.map((t) => {
                    const active = filters.types.has(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className={`deck-filter-chip${active ? ' is-active' : ''}`}
                        onClick={() => setFilters({ ...filters, types: toggle(filters.types, t) })}
                        aria-pressed={active}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {sets.length > 0 && (
              <section className="collection-filters-section">
                <div className="collection-filters-section-label">Set</div>
                <div className="deck-filters-chips" role="group" aria-label="Filter by set">
                  {sets.map((s) => {
                    const active = filters.sets.has(s.code);
                    return (
                      <button
                        key={s.code}
                        type="button"
                        className={`deck-filter-chip${active ? ' is-active' : ''}`}
                        onClick={() =>
                          setFilters({ ...filters, sets: toggle(filters.sets, s.code) })
                        }
                        aria-pressed={active}
                        title={s.name}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {showValue && (
              <section className="collection-filters-section">
                <div className="collection-filters-section-label">Value</div>
                <NumberRangeInput
                  min={filters.priceMin}
                  max={filters.priceMax}
                  step={0.01}
                  onMinChange={(v) => setFilters({ ...filters, priceMin: v })}
                  onMaxChange={(v) => setFilters({ ...filters, priceMax: v })}
                />
              </section>
            )}

            <section className="collection-filters-section">
              <div className="collection-filters-section-label">Mana value</div>
              <NumberRangeInput
                min={filters.cmcMin}
                max={filters.cmcMax}
                step={1}
                onMinChange={(v) => setFilters({ ...filters, cmcMin: v })}
                onMaxChange={(v) => setFilters({ ...filters, cmcMax: v })}
              />
            </section>
          </div>

          <footer className="collection-filters-dialog-footer">
            <button
              type="button"
              className="collection-filters-dialog-clear"
              onClick={() => setFilters(emptySharedFilters())}
              disabled={!hasActive}
            >
              Clear
            </button>
            <button
              type="button"
              className="collection-filters-dialog-done"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
