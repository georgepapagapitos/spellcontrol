import { createPortal } from 'react-dom';
import {
  ChoiceChips,
  FilterSection,
  ManaColorPicker,
  colorModeOptions,
} from '@/components/filter-kit';
import '@/components/filter-kit/filter-kit.css';
import { Chip } from '@/components/shared/Chip';
import { FilterPopoverFooter } from '@/components/shared/FilterPopoverFooter';
import { FilterTrigger } from '@/components/shared/FilterTrigger';
import { Surface } from '@/components/shared/Surface';
import { colorModeNounHint } from '@/components/filter-kit/color-mode-noun-hint';
import { parseColorMatchMode } from '@spellcontrol/binder-routing';
import { useAnchoredPanel } from '@/lib/overlays/use-anchored-panel';
import {
  COMBO_RESULT_LABELS,
  countActiveFilters,
  emptyComboFilters,
  type ComboFilterState,
  type ComboPieceCount,
  type ComboResultKind,
} from '@/lib/deck-analysis/combo-filters';

const RESULT_OPTIONS = (
  Object.entries(COMBO_RESULT_LABELS) as Array<[ComboResultKind, string]>
).map(([value, label]) => ({ value, label }));

const PIECE_OPTIONS: Array<{ value: ComboPieceCount; label: string }> = [
  { value: '2', label: '2 cards' },
  { value: '3', label: '3 cards' },
  { value: '4+', label: '4+ cards' },
];

const COLOR_MODES = colorModeOptions(['any', 'all', 'within']);

interface Props {
  filters: ComboFilterState;
  setFilters: (next: ComboFilterState) => void;
  /** Disables the host toggle when the user owns no commanders to check against. */
  hasCommanders: boolean;
  /** The footer's live count ("14 combos"), taken from the list the page shows. */
  resultLabel: string;
}

/**
 * Filters anchored to the combos search pill's trailing slot, built on the
 * filter kit like the decks and discover popovers: live toggling with a live
 * count and "Clear filters" in the footer. The color row defaults to 'within'
 * ("fits in these colors"), the reading that answers "what can I build".
 */
export function ComboFiltersPopover({ filters, setFilters, hasCommanders, resultLabel }: Props) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel();

  const activeCount = countActiveFilters(filters);
  const colorList = [...filters.colors];

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
            <FilterSection label="Color" count={filters.colors.size}>
              <ManaColorPicker
                ariaLabel="Filter by color identity"
                colors={colorList}
                onColorsChange={(next) => setFilters({ ...filters, colors: new Set(next) })}
                mode={filters.colorMode}
                modes={COLOR_MODES}
                onModeChange={(next) =>
                  setFilters({ ...filters, colorMode: parseColorMatchMode(next, 'within') })
                }
                hint={colorModeNounHint(colorList, filters.colorMode, 'combos')}
              />
            </FilterSection>

            <FilterSection label="Result" count={filters.results.size}>
              <ChoiceChips
                multiple
                ariaLabel="Filter by result"
                options={RESULT_OPTIONS}
                value={[...filters.results]}
                onChange={(next) =>
                  setFilters({ ...filters, results: new Set(next as ComboResultKind[]) })
                }
              />
            </FilterSection>

            <FilterSection label="Pieces" count={filters.pieceCounts.size}>
              <ChoiceChips
                multiple
                ariaLabel="Filter by piece count"
                options={PIECE_OPTIONS}
                value={[...filters.pieceCounts]}
                onChange={(next) =>
                  setFilters({ ...filters, pieceCounts: new Set(next as ComboPieceCount[]) })
                }
              />
            </FilterSection>

            <FilterSection label="Commanders" count={filters.hostOnly ? 1 : 0}>
              <div className="filter-kit-chips" role="group" aria-label="Filter by hostability">
                <Chip
                  className="filter-chip filter-kit-chip"
                  onClick={() => setFilters({ ...filters, hostOnly: !filters.hostOnly })}
                  pressed={filters.hostOnly}
                  disabled={!hasCommanders}
                  title={
                    hasCommanders
                      ? 'Only combos one of your commanders could legally run'
                      : "You don't own any commander-eligible cards yet"
                  }
                >
                  One of mine can host it
                </Chip>
              </div>
            </FilterSection>

            <FilterPopoverFooter
              resultLabel={resultLabel}
              onClear={activeCount > 0 ? () => setFilters(emptyComboFilters()) : undefined}
            />
          </Surface>,
          document.body
        )}
    </div>
  );
}
