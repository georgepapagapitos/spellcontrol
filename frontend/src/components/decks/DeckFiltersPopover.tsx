import { createPortal } from 'react-dom';
import type { DeckFormat } from '@/deck-builder/types';
import type { DeckSource } from '@/store/decks';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  ChoiceChips,
  FilterSection,
  ManaColorPicker,
  colorModeOptions,
} from '@/components/filter-kit';
import { FilterPopoverFooter } from '@/components/shared/FilterPopoverFooter';
import { resultCountLabel } from '@/lib/search/result-count-label';
import { FilterTrigger } from '@/components/shared/FilterTrigger';
import { colorModeNounHint } from '@/components/filter-kit/color-mode-noun-hint';
import { parseColorMatchMode, type ColorMatchMode } from '@spellcontrol/binder-routing';
import { useAnchoredPanel } from '@/lib/overlays/use-anchored-panel';
import { Surface } from '@/components/shared/Surface';

const SOURCE_OPTIONS = [
  { value: 'generated', label: 'Generated' },
  { value: 'manual', label: 'Manual' },
];

const FORMAT_OPTIONS = Object.values(DECK_FORMAT_CONFIGS).map((cfg) => ({
  value: cfg.format,
  label: cfg.label,
}));

const COLOR_MODES = colorModeOptions(['any', 'all', 'within']);

interface Props {
  formats: Set<DeckFormat>;
  setFormats: (next: Set<DeckFormat>) => void;
  sources: Set<DeckSource>;
  setSources: (next: Set<DeckSource>) => void;
  colors: Set<string>;
  setColors: (next: Set<string>) => void;
  /** Any / Exactly / Within across the selected colors. Decks default to 'all'. */
  colorMode: ColorMatchMode;
  setColorMode: (next: ColorMatchMode) => void;
  /** How many decks the list shows right now, so the count is the list's own. */
  resultCount: number;
}

/**
 * Inline filters anchored to the decks index search pill's trailing slot.
 * Three kit sections (Format, Source, Color) that apply as you tap, with a
 * live count and "Clear filters" in the footer (STYLE_GUIDE § Filter kit:
 * a popover over a visible list is live, never a draft).
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
  resultCount,
}: Props) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel();

  const activeCount = formats.size + sources.size + colors.size;
  const colorList = [...colors];

  const clearAll = () => {
    setFormats(new Set());
    setSources(new Set());
    setColors(new Set());
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
          <Surface
            as="div"
            variant="popover"
            ref={panelRef}
            className="filter-popover-panel deck-filters-panel"
            role="dialog"
            aria-label="Filters"
            style={panelStyle}
          >
            <FilterSection label="Format" count={formats.size}>
              <ChoiceChips
                multiple
                ariaLabel="Filter by format"
                options={FORMAT_OPTIONS}
                value={[...formats]}
                onChange={(next) => setFormats(new Set(next as DeckFormat[]))}
              />
            </FilterSection>

            <FilterSection label="Source" count={sources.size}>
              <ChoiceChips
                multiple
                ariaLabel="Filter by source"
                options={SOURCE_OPTIONS}
                value={[...sources]}
                onChange={(next) => setSources(new Set(next as DeckSource[]))}
              />
            </FilterSection>

            <FilterSection label="Color" count={colors.size}>
              <ManaColorPicker
                colors={colorList}
                onColorsChange={(next) => setColors(new Set(next))}
                mode={colorMode}
                modes={COLOR_MODES}
                onModeChange={(next) => setColorMode(parseColorMatchMode(next, 'all'))}
                hint={colorModeNounHint(colorList, colorMode, 'decks')}
              />
            </FilterSection>

            <FilterPopoverFooter
              resultLabel={resultCountLabel(resultCount, 'deck')}
              onClear={activeCount > 0 ? clearAll : undefined}
            />
          </Surface>,
          document.body
        )}
    </div>
  );
}
