import { ListFilter } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';
import type { DeckBucketKey, SharedFilters } from '../../lib/shared-grouping';
import { countSharedFilters, emptySharedFilters } from '../../lib/shared-grouping';
import { NumberRangeInput } from '../FilterFieldEditor';
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
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

function toggle<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Faceted filter popover for the shared-collection view, anchored to the
 * search pill's trailing slot. Mirrors DeckFiltersPopover (live-toggling, no
 * Apply staging) so the on-toolbar filter affordance looks identical to the
 * decks index and the main collection. Facets are limited to what the public
 * share payload carries: Color, Rarity, Type, Set, Value, Mana value.
 *
 * Portals the panel to `<body>` and clamps it into the safe viewport.
 */
export function SharedCollectionFilters({ filters, setFilters, rarities, types, sets }: Props) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeCount = countSharedFilters(filters);
  const hasActive = activeCount > 0;

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      getSafeViewport(),
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

  return (
    <div className="filter-popover">
      <button
        ref={buttonRef}
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasActive ? `Filters (${activeCount} active)` : 'Filters'}
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
            className="filter-popover-panel deck-filters-panel shared-filters-panel"
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
            <section className="deck-filters-section">
              <div className="deck-filters-section-label">Color</div>
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
              <section className="deck-filters-section">
                <div className="deck-filters-section-label">Rarity</div>
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
              <section className="deck-filters-section">
                <div className="deck-filters-section-label">Type</div>
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
              <section className="deck-filters-section">
                <div className="deck-filters-section-label">Set</div>
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

            <section className="deck-filters-section">
              <div className="deck-filters-section-label">Value</div>
              <NumberRangeInput
                min={filters.priceMin}
                max={filters.priceMax}
                step={0.01}
                onMinChange={(v) => setFilters({ ...filters, priceMin: v })}
                onMaxChange={(v) => setFilters({ ...filters, priceMax: v })}
              />
            </section>

            <section className="deck-filters-section">
              <div className="deck-filters-section-label">Mana value</div>
              <NumberRangeInput
                min={filters.cmcMin}
                max={filters.cmcMax}
                step={1}
                onMinChange={(v) => setFilters({ ...filters, cmcMin: v })}
                onMaxChange={(v) => setFilters({ ...filters, cmcMax: v })}
              />
            </section>

            {hasActive && (
              <div className="deck-filters-footer">
                <button
                  type="button"
                  className="btn-link deck-filters-clear"
                  onClick={() => setFilters(emptySharedFilters())}
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
