import { createPortal } from 'react-dom';
import type { DeckFormat } from '@/deck-builder/types';
import type { DeckSource } from '../store/decks';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';
import { ColorPip } from './shared/ManaSymbol';
import { ColorMatchModeToggle } from './shared/ColorMatchModeToggle';
import { FilterTrigger } from './shared/FilterTrigger';
import { FILTER_COLOR_OPTIONS, type ColorMatchMode } from '@/lib/colors';
import { useAnchoredPanel } from '@/lib/use-anchored-panel';
import { Button, IconButton } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';

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
  /** OR ('any') vs AND ('all') across the selected colors. Decks default to 'all'. */
  colorMode: ColorMatchMode;
  setColorMode: (next: ColorMatchMode) => void;
}

/**
 * Inline filters anchored to the decks index search pill's trailing slot.
 * Three multi-select sections — Format, Source, Color — with live toggling
 * (no Apply staging), because these only change what you're looking at.
 *
 * Portal, placement and dismiss all come from `useAnchoredPanel`; the trigger
 * from `FilterTrigger`. Both are shared with every other filter popover.
 */
export function DeckFiltersPopover({
  formats,
  setFormats,
  sources,
  setSources,
  colors,
  setColors,
  colorMode,
  setColorMode,
}: Props) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel();

  const activeCount = formats.size + sources.size + colors.size;
  const hasActive = activeCount > 0;

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
              <div className="deck-filters-section-label">Format</div>
              <div className="deck-filters-chips" role="group" aria-label="Filter by format">
                {formatEntries.map(([key, cfg]) => {
                  const active = formats.has(key);
                  return (
                    <Chip
                      key={key}
                      className={`deck-filter-chip${active ? ' is-active' : ''}`}
                      onClick={() => toggleFormat(key)}
                      pressed={active}
                    >
                      {cfg.label}
                    </Chip>
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
                    <Chip
                      key={s.key}
                      className={`deck-filter-chip${active ? ' is-active' : ''}`}
                      onClick={() => toggleSource(s.key)}
                      pressed={active}
                    >
                      {s.label}
                    </Chip>
                  );
                })}
              </div>
            </section>

            <section className="deck-filters-section">
              <div className="deck-filters-section-label deck-filters-section-label--split">
                Color
                <ColorMatchModeToggle mode={colorMode} onChange={setColorMode} />
              </div>
              <div className="color-filter-row" role="group" aria-label="Filter by color">
                {FILTER_COLOR_OPTIONS.map((c) => {
                  const active = colors.has(c.key);
                  return (
                    <IconButton
                      className={`color-filter-btn${active ? ' is-active' : ''}`}
                      key={c.key}
                      onClick={() => toggleColor(c.key)}
                      aria-pressed={active}
                      label={c.label}
                      icon={<ColorPip color={c.key} pip="lg" />}
                    />
                  );
                })}
              </div>
            </section>

            {hasActive && (
              <div className="deck-filters-footer">
                <Button variant="link" onClick={clearAll} className="deck-filters-clear">
                  Clear filters
                </Button>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
