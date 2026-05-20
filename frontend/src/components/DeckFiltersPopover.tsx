import { ListFilter } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DeckFormat } from '@/deck-builder/types';
import type { DeckSource } from '../store/decks';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';

const COLOR_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

const SOURCE_OPTIONS: Array<{ key: DeckSource; label: string }> = [
  { key: 'generated', label: 'Generated' },
  { key: 'manual', label: 'Manual' },
];

interface Props {
  formats: Set<DeckFormat>;
  setFormats: (next: Set<DeckFormat>) => void;
  sources: Set<DeckSource>;
  setSources: (next: Set<DeckSource>) => void;
  colors: Set<string>;
  setColors: (next: Set<string>) => void;
}

/**
 * Inline filters anchored to the decks index search pill's trailing slot.
 * Three multi-select sections — Format, Source, Color — with live toggling
 * (no Apply staging). Trigger styling matches CollectionFiltersDialog so the
 * search-pill affordance looks identical across pages.
 */
export function DeckFiltersPopover({
  formats,
  setFormats,
  sources,
  setSources,
  colors,
  setColors,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeCount = formats.size + sources.size + colors.size;
  const hasActive = activeCount > 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const toggleFormat = (f: DeckFormat) => {
    const next = new Set(formats);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setFormats(next);
  };

  const toggleSource = (s: DeckSource) => {
    const next = new Set(sources);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSources(next);
  };

  const toggleColor = (c: string) => {
    const next = new Set(colors);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setColors(next);
  };

  const clearAll = () => {
    setFormats(new Set());
    setSources(new Set());
    setColors(new Set());
  };

  const formatEntries = Object.entries(DECK_FORMAT_CONFIGS) as Array<
    [DeckFormat, (typeof DECK_FORMAT_CONFIGS)[DeckFormat]]
  >;

  return (
    <div className="filter-popover deck-filters-popover" ref={wrapperRef}>
      <button
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasActive ? `Filters (${activeCount} active)` : 'Filters'}
        title="Filters"
        onClick={() => setOpen((v) => !v)}
      >
        <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
        {hasActive && (
          <span className="collection-filters-badge" aria-hidden>
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="filter-popover-panel deck-filters-panel" role="dialog" aria-label="Filters">
          <section className="deck-filters-section">
            <div className="deck-filters-section-label">Format</div>
            <div className="deck-filters-chips" role="group" aria-label="Filter by format">
              {formatEntries.map(([key, cfg]) => {
                const active = formats.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`deck-filter-chip${active ? ' is-active' : ''}`}
                    onClick={() => toggleFormat(key)}
                    aria-pressed={active}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="deck-filters-section">
            <div className="deck-filters-section-label">Source</div>
            <div className="deck-filters-chips" role="group" aria-label="Filter by source">
              {SOURCE_OPTIONS.map((s) => {
                const active = sources.has(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`deck-filter-chip${active ? ' is-active' : ''}`}
                    onClick={() => toggleSource(s.key)}
                    aria-pressed={active}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="deck-filters-section">
            <div className="deck-filters-section-label">Color</div>
            <div className="color-filter-row" role="group" aria-label="Filter by color">
              {COLOR_OPTIONS.map((c) => {
                const active = colors.has(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`color-filter-btn${active ? ' is-active' : ''}`}
                    onClick={() => toggleColor(c.key)}
                    aria-label={c.label}
                    aria-pressed={active}
                    title={c.label}
                  >
                    <i
                      className={`ms ms-${c.key.toLowerCase()} ms-cost color-pip-mana color-pip-mana--lg`}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {hasActive && (
            <div className="deck-filters-footer">
              <button type="button" className="btn-link deck-filters-clear" onClick={clearAll}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
