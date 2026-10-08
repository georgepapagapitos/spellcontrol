import type { ReactNode } from 'react';
import { AlignJustify, Captions, Eye, LayoutGrid, List as ListIcon } from 'lucide-react';
import { SearchPill } from '@/components/search/SearchPill';
import { SortMenu, type SortMenuOption } from '@/components/search/SortMenu';
import { Chip } from '@/components/shared/Chip';
import { GridCaptionList, type GridCaptionPrefs } from '@/components/shared/CardGridCell';
import { ToolbarPopover } from '@/components/shared/ToolbarPopover';
import { useMediaQuery } from '@/lib/util/use-media-query';
import type { SharedSortKey, SortDir } from '@/lib/social/shared-grouping';
import { ViewModeToggle, type ViewModeOption } from '../ViewModeToggle';
import type { BrowserChip, BrowserChipId, BrowserView } from './use-collection-browser';

/** The phone tier (STYLE_GUIDE § Responsive): matches the stylesheet's
 *  `max-width: 599px` blocks, so the JS fold and the CSS never disagree. */
export const PHONE_QUERY = '(max-width: 599px)';

// Public read-only page — it can't import the collection's sort machinery
// (its keys are this projection's own), so the direction wording is authored
// here to match the private surfaces word for word.
const BASE_SORT_OPTIONS: SortMenuOption<SharedSortKey>[] = [
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'cmc', label: 'Mana value', dirLabels: ['Low → high', 'High → low'] },
  { value: 'price', label: 'Price', dirLabels: ['Cheapest', 'Priciest'] },
  { value: 'set', label: 'Set', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'rarity', label: 'Rarity', dirLabels: ['Mythic first', 'Common first'] },
  { value: 'qty', label: 'Quantity', dirLabels: ['Fewest', 'Most'] },
];
const POPULARITY_OPTION: SortMenuOption<SharedSortKey> = {
  value: 'popularity',
  label: 'Popularity',
  dirLabels: ['Most popular', 'Least popular'],
};

const VIEW_OPTIONS: ViewModeOption<BrowserView>[] = [
  {
    value: 'grid',
    label: 'Grid view',
    icon: <LayoutGrid width={14} height={14} strokeWidth={1.8} aria-hidden />,
  },
  {
    value: 'list',
    label: 'List view',
    icon: <ListIcon width={14} height={14} strokeWidth={1.8} aria-hidden />,
  },
  {
    value: 'compact',
    label: 'Compact list (text only)',
    icon: <AlignJustify width={14} height={14} strokeWidth={1.8} aria-hidden />,
  },
];

interface Props {
  ownerName: string;
  query: string;
  onQueryChange: (q: string) => void;
  filterNode: ReactNode;
  sort: SharedSortKey;
  dir: SortDir;
  onSort: (key: SharedSortKey) => void;
  hasPopularity: boolean;
  view: BrowserView;
  onView: (v: BrowserView) => void;
  chips: BrowserChip[];
  onChip: (id: BrowserChipId) => void;
  /** Owned by the browser so the tiles repaint when Details changes. */
  captionPrefs: GridCaptionPrefs;
  onCaptionPrefs: (next: GridCaptionPrefs) => void;
}

/**
 * The browser's sticky toolbar. Search takes Scryfall syntax and carries the
 * facet dialog in its trailing slot; the chips are one-tap answers ("what can
 * I get?"). Above 600px sort, layout and Details sit on the search row. On a
 * phone the layout toggle and Details fold behind one "View options" popover
 * (as on the owner's own collection, CardListControls) and sort moves into the
 * chip row, so the tool row stays a single line.
 */
export function CollectionBrowserToolbar({
  ownerName,
  query,
  onQueryChange,
  filterNode,
  sort,
  dir,
  onSort,
  hasPopularity,
  view,
  onView,
  chips,
  onChip,
  captionPrefs,
  onCaptionPrefs: setCaptionPrefs,
}: Props) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const sortOptions = hasPopularity ? [POPULARITY_OPTION, ...BASE_SORT_OPTIONS] : BASE_SORT_OPTIONS;
  const sortMenu = (
    <SortMenu<SharedSortKey>
      ariaLabel="Sort"
      value={sort}
      dir={dir}
      options={sortOptions}
      onChange={onSort}
    />
  );

  return (
    <div className="collection-browser-toolbar">
      <div className="collection-browser-tools">
        <SearchPill
          value={query}
          onChange={onQueryChange}
          placeholder={`Search ${ownerName}'s cards (Scryfall syntax works)`}
          ariaLabel="Search cards"
          className="collection-browser-search"
          trailing={filterNode}
        />
        {!isPhone && sortMenu}
        {!isPhone && (
          <ViewModeToggle<BrowserView>
            ariaLabel="Collection view mode"
            value={view}
            onChange={onView}
            options={VIEW_OPTIONS}
          />
        )}
        {!isPhone && view === 'grid' && (
          <DetailsPopover prefs={captionPrefs} onChange={setCaptionPrefs} />
        )}
        {isPhone && (
          <ToolbarPopover
            icon={<Eye width={14} height={14} strokeWidth={1.8} aria-hidden />}
            triggerAriaLabel="View options"
            triggerTitle="View options"
            haspopup="dialog"
            panelRole="dialog"
            panelAriaLabel="View options"
            panelClassName="toolbar-popover-panel toolbar-popover-panel--fixed view-popover-panel"
          >
            {() => (
              <>
                <div className="view-popover-row">
                  <span className="view-popover-row-label">Layout</span>
                  <ViewModeToggle<BrowserView>
                    ariaLabel="Collection view mode"
                    value={view}
                    onChange={onView}
                    options={VIEW_OPTIONS}
                  />
                </div>
                {view === 'grid' && (
                  <div className="view-popover-section">
                    <GridCaptionList prefs={captionPrefs} onChange={setCaptionPrefs} />
                  </div>
                )}
              </>
            )}
          </ToolbarPopover>
        )}
      </div>
      {(chips.length > 0 || isPhone) && (
        <div className="collection-browser-chips" role="group" aria-label="Quick filters">
          {isPhone && sortMenu}
          {chips.map((chip) => (
            <Chip
              key={chip.id}
              className="filter-chip collection-browser-chip"
              pressed={chip.pressed}
              onClick={() => onChip(chip.id)}
              trailing={
                <span className="collection-browser-chip-count">{chip.count.toLocaleString()}</span>
              }
            >
              {chip.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailsPopover({
  prefs,
  onChange,
}: {
  prefs: GridCaptionPrefs;
  onChange: (next: GridCaptionPrefs) => void;
}) {
  return (
    <ToolbarPopover
      label="Details"
      icon={<Captions width={14} height={14} strokeWidth={1.8} aria-hidden />}
    >
      {() => <GridCaptionList prefs={prefs} onChange={onChange} />}
    </ToolbarPopover>
  );
}
