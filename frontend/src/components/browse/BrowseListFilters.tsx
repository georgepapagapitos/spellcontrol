import './BrowseListFilters.css';
// The popover's sections and radio chips are Discover's filter popover's own.
import '@/components/decks/DiscoverFiltersPopover.css';
import { useId } from 'react';
import { ListFilter } from 'lucide-react';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { Button } from '@/components/shared/Button';
import { ColorIdentityPicker } from '@/components/shared/ColorIdentityPicker';
import { SegmentedControl } from '@/components/shared/form';
import { ToolbarPopover } from '@/components/shared/ToolbarPopover';
import {
  effectivePeriod,
  periodLocked,
  type BrowseFilters,
  type BrowseListDef,
} from '@/lib/discover/browse-lists';
import {
  EDHREC_TOP_TYPES,
  type EdhrecTopPeriod,
  type EdhrecTopType,
} from '@/lib/discover/edhrec-top';
import { useMediaQuery } from '@/lib/util/use-media-query';

/** The phone tier (STYLE_GUIDE § Layout system, density tiers). */
const PHONE = '(max-width: 599px)';

const TYPE_OPTIONS: Array<{ value: EdhrecTopType | ''; label: string }> = [
  { value: '', label: 'All types' },
  ...EDHREC_TOP_TYPES.map((t) => ({ value: t.value, label: t.label })),
];

/**
 * A browse list's filters. On a tablet or desktop they sit in one row: the
 * period, the colour pips, the type menu and the owned toggle. A phone keeps
 * the period in the row and folds the rest into one Filters popover, since
 * the four controls would stack three rows deep above the cards (STYLE_GUIDE
 * § Toolbars & action rows: a control row that wraps to a third row isn't
 * responsive). Inside the popover the type is a row of radio chips: a
 * SelectMenu nested in a popover would close its host on the first pick.
 */
export function BrowseListFilters({
  def,
  filters,
  ownedFilter,
  onChange,
}: {
  def: BrowseListDef;
  filters: BrowseFilters;
  /** Offer "In my collection" (the viewer has a collection, the list isn't paged). */
  ownedFilter: boolean;
  onChange: (next: BrowseFilters) => void;
}) {
  const phone = useMediaQuery(PHONE);
  const typeName = useId();
  const locked = periodLocked(filters);

  const period = def.filters.period && (
    <SegmentedControl<EdhrecTopPeriod>
      ariaLabel="Time period"
      value={effectivePeriod(filters)}
      onChange={(next) => onChange({ ...filters, period: next })}
      options={[
        { value: 'week', label: 'Week', disabled: locked },
        { value: 'month', label: 'Month', disabled: locked },
        { value: 'year', label: '2 years' },
      ]}
    />
  );
  const colors = def.filters.colors && (
    <div className="browse-list-colors" role="group" aria-label="Color identity">
      <ColorIdentityPicker
        colors={new Set(filters.colors ? [...filters.colors] : [])}
        onChange={(next) => onChange({ ...filters, colors: [...next].join('') })}
      />
    </div>
  );
  const owned = ownedFilter && (
    <SegmentedControl<boolean>
      ariaLabel="Show"
      value={filters.ownedOnly}
      onChange={(ownedOnly) => onChange({ ...filters, ownedOnly })}
      options={[
        { value: false, label: 'All' },
        { value: true, label: 'In my collection' },
      ]}
    />
  );
  const hint = locked && (
    <p className="browse-list-hint">Color and type lists cover the past 2 years.</p>
  );

  if (!period && !colors && !def.filters.type && !owned) return null;

  // A list with nothing to fold (salt, bans, Game Changers) keeps its one
  // toggle in the row at every width.
  if (!phone || (!colors && !def.filters.type)) {
    return (
      <div className="browse-list-filters">
        {period}
        {colors}
        {def.filters.type && (
          <SelectMenu<EdhrecTopType | ''>
            label="Type"
            value={filters.type}
            onChange={(type) => onChange({ ...filters, type })}
            options={TYPE_OPTIONS}
          />
        )}
        {owned}
        {hint}
      </div>
    );
  }

  const active =
    (filters.colors ? 1 : 0) + (filters.type ? 1 : 0) + (ownedFilter && filters.ownedOnly ? 1 : 0);
  return (
    <div className="browse-list-filters">
      {period}
      <ToolbarPopover
        label={active > 0 ? `Filters · ${active}` : 'Filters'}
        icon={<ListFilter width={14} height={14} strokeWidth={1.8} aria-hidden />}
        triggerAriaLabel={active > 0 ? `Filters (${active} active)` : 'Filters'}
        haspopup="dialog"
        panelRole="dialog"
        panelAriaLabel="Filters"
        panelClassName="toolbar-popover-panel toolbar-popover-panel--fixed discover-filters-panel"
      >
        {() => (
          <>
            {colors && (
              <fieldset className="discover-filters-section">
                <legend className="discover-filters-legend">Colors</legend>
                {colors}
              </fieldset>
            )}
            {def.filters.type && (
              <fieldset className="discover-filters-section">
                <legend className="discover-filters-legend">Type</legend>
                <div className="discover-filters-chips">
                  {TYPE_OPTIONS.map((t) => (
                    <label key={t.value || 'all'} className="discover-filter-chip">
                      <input
                        type="radio"
                        name={typeName}
                        checked={filters.type === t.value}
                        onChange={() => onChange({ ...filters, type: t.value })}
                      />
                      <span className="filter-chip">{t.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {owned && (
              <fieldset className="discover-filters-section">
                <legend className="discover-filters-legend">Show</legend>
                {owned}
              </fieldset>
            )}
            {active > 0 && (
              <div className="browse-list-filters-footer">
                <Button
                  variant="link"
                  onClick={() => onChange({ ...filters, colors: '', type: '', ownedOnly: false })}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </>
        )}
      </ToolbarPopover>
      {hint}
    </div>
  );
}
