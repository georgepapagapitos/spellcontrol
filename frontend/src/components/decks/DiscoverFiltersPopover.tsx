import { createPortal } from 'react-dom';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { BRACKET_LABELS } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { useAnchoredPanel } from '@/lib/overlays/use-anchored-panel';
import {
  DISCOVER_BUDGET_LABELS,
  DISCOVER_COLOR_ORDER,
  type DiscoverBudgetKey,
  type DiscoverFilters,
} from '@/lib/discover/discover-filters';
import { colorModeNounHint } from '@/components/filter-kit/color-mode-noun-hint';
import { parseColorMatchMode } from '@spellcontrol/binder-routing';
import type { DeckFormat } from '@/deck-builder/types';
import {
  ChoiceChips,
  FilterSection,
  ManaColorPicker,
  colorModeOptions,
} from '@/components/filter-kit';
import { FilterPopoverFooter } from '@/components/shared/FilterPopoverFooter';
import { FilterTrigger } from '@/components/shared/FilterTrigger';
import { Surface } from '@/components/shared/Surface';

const FORMAT_OPTIONS = Object.values(DECK_FORMAT_CONFIGS).map((cfg) => ({
  value: cfg.format,
  label: cfg.label,
}));

const BRACKET_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: BRACKET_LABELS[n],
}));

const BUDGET_OPTIONS = (
  Object.entries(DISCOVER_BUDGET_LABELS) as Array<[DiscoverBudgetKey, string]>
).map(([value, label]) => ({ value, label }));

const COLOR_MODES = colorModeOptions(['any', 'all', 'within']);

interface Props {
  filters: DiscoverFilters;
  onChange: (next: DiscoverFilters) => void;
  /**
   * Drop the Budget section. A person's deck library (`DeckLibrary`, used by
   * the friend hub and `/u/:username`) lists decks from summaries that carry no
   * estimated value — only Discover's listing computes one — so offering the
   * filter there would silently match nothing. Omitting the control is honest;
   * a dead filter is not.
   */
  hideBudget?: boolean;
  /**
   * The footer's live count ("14 decks"), taken from the list the page shows.
   * Omit while the list is still loading.
   */
  resultLabel?: string;
}

/**
 * Format / Bracket / Color / Budget filters for the Discover browse, built on
 * the filter kit. Portal, placement and dismiss come from `useAnchoredPanel`;
 * every pick applies as you tap and leaves the panel open, with a live count
 * and "Clear filters" in the footer (STYLE_GUIDE § Filter kit).
 */
export function DiscoverFiltersPopover({ filters, onChange, hideBudget, resultLabel }: Props) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel();

  const budgetCount = !hideBudget && filters.budget ? 1 : 0;
  const activeCount =
    (filters.format ? 1 : 0) + filters.colors.length + filters.brackets.length + budgetCount;

  const clearAll = () =>
    onChange({
      ...filters,
      format: null,
      colors: [],
      colorMode: 'within',
      brackets: [],
      budget: null,
    });

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
          <Surface
            as="div"
            variant="popover"
            ref={panelRef}
            className="filter-popover-panel deck-filters-panel"
            role="dialog"
            aria-label="Filters"
            style={panelStyle}
          >
            <FilterSection label="Format" count={filters.format ? 1 : 0}>
              <ChoiceChips
                ariaLabel="Filter by format"
                anyLabel="Any"
                options={FORMAT_OPTIONS}
                value={filters.format ?? ''}
                onChange={(next) =>
                  onChange({ ...filters, format: (next || null) as DeckFormat | null })
                }
              />
            </FilterSection>

            <FilterSection label="Color" count={filters.colors.length}>
              <ManaColorPicker
                colors={filters.colors}
                onColorsChange={(next) =>
                  onChange({
                    ...filters,
                    colors: DISCOVER_COLOR_ORDER.filter((k) => next.includes(k)),
                  })
                }
                mode={filters.colorMode}
                modes={COLOR_MODES}
                onModeChange={(next) =>
                  onChange({ ...filters, colorMode: parseColorMatchMode(next, 'within') })
                }
                hint={colorModeNounHint(filters.colors, filters.colorMode, 'decks')}
              />
            </FilterSection>

            <FilterSection label="Bracket" count={filters.brackets.length}>
              <ChoiceChips
                multiple
                ariaLabel="Filter by bracket"
                options={BRACKET_OPTIONS}
                value={filters.brackets.map(String)}
                onChange={(next) =>
                  onChange({ ...filters, brackets: next.map(Number).sort((a, b) => a - b) })
                }
              />
            </FilterSection>

            {!hideBudget && (
              <FilterSection label="Budget" count={budgetCount}>
                <ChoiceChips
                  ariaLabel="Filter by budget"
                  anyLabel="Any"
                  options={BUDGET_OPTIONS}
                  value={filters.budget ?? ''}
                  onChange={(next) =>
                    onChange({ ...filters, budget: (next || null) as DiscoverBudgetKey | null })
                  }
                />
              </FilterSection>
            )}

            <FilterPopoverFooter
              resultLabel={resultLabel}
              onClear={activeCount > 0 ? clearAll : undefined}
            />
          </Surface>,
          document.body
        )}
    </div>
  );
}
