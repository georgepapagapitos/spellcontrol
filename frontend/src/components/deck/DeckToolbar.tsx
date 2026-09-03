// Deck-list toolbar: sort/search/view controls plus the role-badge legend
// and narrow-viewport "View" popover. Split out of DeckDisplay.tsx purely to
// shrink the file — no logic changes.
import { useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Hand,
  LayoutGrid,
  List as ListIconLucide,
  Share2,
  Shapes,
  Tag as TagIcon,
  Tags,
} from 'lucide-react';
import { Legend, LegendContent } from '../Legend';
import { OverflowMenu } from '../OverflowMenu';
import { SearchPill } from '../SearchPill';
import { SortMenu, type SortMenuOption } from '../SortMenu';
import { ViewModeToggle as SharedViewModeToggle } from '../ViewModeToggle';
import { ZoomControl } from '../ZoomControl';
import { ZOOM_MAX, ZOOM_MAX_NARROW } from '@/lib/grid-zoom';
import { ROLE_BADGE_BY_TONE, ROLE_BADGE_GROUPS } from '../../lib/role-badges';
import { ToolbarPopover } from '../shared/ToolbarPopover';
import type { DeckGroupBy, DeckViewMode, ShowPrefs, SortMode } from './deck-display-rows';

// ── Toolbar ───────────────────────────────────────────────────────────────
interface ToolbarProps {
  title: string;
  sort: SortMode;
  sortDir: 'asc' | 'desc';
  onToggleSort: (s: SortMode) => void;
  search: string;
  onSearch: (s: string) => void;
  viewMode: DeckViewMode;
  onViewModeChange: (m: DeckViewMode) => void;
  groupBy: DeckGroupBy;
  onGroupByChange: (g: DeckGroupBy) => void;
  gridZoom: number;
  /** Measured width of a rendered card grid, so the stepper can skip steps
   *  that wouldn't change the column count at this size. */
  gridWidth: number;
  onGridZoomChange: (z: number) => void;
  isNarrowGrid: boolean;
  showPrefs: ShowPrefs;
  onShowPrefsChange: (next: ShowPrefs) => void;
  onExport: () => void;
  /** Reveal the standalone Test hand panel (goldfishing acts on this list). */
  onShowTestHand?: () => void;
  /** Sideboard + Considering combined count — drives the "Not in the deck"
   *  jump chip (E176). 0 still renders the chip (the zone always exists). */
  outzoneCount: number;
  /** E172 — whether ANY bulk-edit callback was passed; gates the "Select"
   *  toggle rendering at all (mirrors the tag props' own gating). */
  canBulkEdit: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
}

const SORT_LABEL: Record<SortMode, string> = {
  name: 'Name',
  cmc: 'Mana value',
  color: 'Color',
  price: 'Price',
  added: 'Added',
  custom: 'Custom order',
};
// 'custom' sits last — it's an escape hatch a user opts into deliberately
// (it's how drag-to-reorder becomes available at all; see DeckCardRow's
// drag handle), not a default anyone would reach for first.
const SORT_ORDER: SortMode[] = ['name', 'cmc', 'color', 'price', 'added', 'custom'];

// A deck sorts by card attributes but on its own key union, so the direction
// wording is authored here — phrased as the EFFECT on the decklist, never
// asc/desc. "Added" is the deck's own add order, not an import date.
const SORT_DIR_LABELS: Record<SortMode, [string, string]> = {
  name: ['A → Z', 'Z → A'],
  cmc: ['Low → high', 'High → low'],
  color: ['WUBRG', 'GRBUW'],
  price: ['Cheapest', 'Priciest'],
  added: ['Oldest first', 'Newest first'],
  custom: ['Your order', 'Reversed'],
};

const SORT_MENU_OPTIONS: SortMenuOption<SortMode>[] = SORT_ORDER.map((m) => ({
  value: m,
  label: SORT_LABEL[m],
  dirLabels: SORT_DIR_LABELS[m],
}));

const SHOW_PREFS_LABEL: Record<keyof ShowPrefs, string> = {
  price: 'Price',
  roles: 'Roles',
  mana: 'Mana cost',
};

// The full role-badge key: every 2-letter abbreviation spelled out,
// grouped by top-level role. Shared by the toolbar legend (below) and
// the tap-to-reveal badge popover so the two can't drift. `highlightTone`
// emphasises the row for the badge a user just tapped.
function RoleBadgeKey({ highlightTone }: { highlightTone?: string }) {
  return (
    <div className="deck-role-legend-body" role="group" aria-label="Role badge key">
      {ROLE_BADGE_GROUPS.map((g) => (
        <div key={g.group} className="deck-role-legend-group">
          <div className="deck-role-legend-group-title">{g.group}</div>
          {g.tones.map((tone) => (
            <div
              key={tone}
              className={`deck-role-legend-item${
                tone === highlightTone ? ' deck-role-legend-item--active' : ''
              }`}
            >
              <span className={`deck-row-role-badge deck-row-role-${tone}`} aria-hidden>
                {ROLE_BADGE_BY_TONE[tone].label}
              </span>
              {ROLE_BADGE_BY_TONE[tone].title}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Collapsible key for the cryptic 2-letter role badges, surfaced from
// the toolbar "Show" popover (next to the Roles toggle). Lives inside
// that popover so it inherits its dismiss handling.
function RoleBadgeLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="deck-role-legend">
      <button
        type="button"
        className="deck-role-legend-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown width={13} height={13} strokeWidth={2} aria-hidden />
        ) : (
          <ChevronRight width={13} height={13} strokeWidth={2} aria-hidden />
        )}
        What do the role badges mean?
      </button>
      {open && <RoleBadgeKey />}
    </div>
  );
}

// Shared checkbox list for the row-detail prefs — rendered by the desktop
// "Show" popover and inside the narrow-viewport "View" popover.
function ShowPrefsList({
  showPrefs,
  onShowPrefsChange,
}: {
  showPrefs: ShowPrefs;
  onShowPrefsChange: (next: ShowPrefs) => void;
}) {
  return (
    <ul className="toolbar-popover-list" role="menu" aria-label="Row details">
      {(Object.keys(SHOW_PREFS_LABEL) as (keyof ShowPrefs)[]).map((k) => (
        <li key={k}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showPrefs[k]}
            className={`toolbar-popover-item${showPrefs[k] ? ' active' : ''}`}
            onClick={() => onShowPrefsChange({ ...showPrefs, [k]: !showPrefs[k] })}
          >
            <span className="toolbar-popover-check" aria-hidden>
              {showPrefs[k] ? '✓' : ''}
            </span>
            {SHOW_PREFS_LABEL[k]}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Narrow-viewport "View" popover panel — consolidates the display controls
// (layout, grouping, card size, row details, symbol key) that would otherwise
// wrap the deck toolbar onto three rows on a phone, pushing the card list off
// the first screen entirely. Mirrors the collection toolbar's ViewPopoverPanel
// (CardListTable) down to the sub-page key, per STYLE_GUIDE "Toolbars & action
// rows". State lives here so it resets whenever the popover closes.
function DeckViewPopoverPanel({
  viewMode,
  onViewModeChange,
  groupBy,
  onGroupByChange,
  gridZoom,
  onGridZoomChange,
  gridWidth,
  zoomMax,
  showPrefs,
  onShowPrefsChange,
}: {
  viewMode: DeckViewMode;
  onViewModeChange: (m: DeckViewMode) => void;
  groupBy: DeckGroupBy;
  onGroupByChange: (g: DeckGroupBy) => void;
  gridZoom: number;
  onGridZoomChange: (z: number) => void;
  gridWidth: number;
  zoomMax: number;
  showPrefs: ShowPrefs;
  onShowPrefsChange: (next: ShowPrefs) => void;
}) {
  const [keyOpen, setKeyOpen] = useState(false);
  if (keyOpen) {
    return (
      <div className="view-popover-key">
        <button
          type="button"
          className="toolbar-popover-item view-popover-back"
          onClick={() => setKeyOpen(false)}
        >
          <ChevronLeft width={14} height={14} strokeWidth={2} aria-hidden />
          <span>Back</span>
        </button>
        <LegendContent context="deck" />
      </div>
    );
  }
  return (
    <>
      <div className="view-popover-row">
        <span className="view-popover-row-label">Layout</span>
        <DeckViewModeToggle value={viewMode} onChange={onViewModeChange} />
      </div>
      <div className="view-popover-row">
        <span className="view-popover-row-label">Group by</span>
        <DeckGroupByToggle value={groupBy} onChange={onGroupByChange} />
      </div>
      {viewMode === 'grid' && (
        <div className="view-popover-row">
          <span className="view-popover-row-label">Card size</span>
          <ZoomControl
            zoom={gridZoom}
            width={gridWidth}
            max={zoomMax}
            onChange={onGridZoomChange}
          />
        </div>
      )}
      <div className="view-popover-section">
        <span className="view-popover-section-title">Details</span>
        <ShowPrefsList showPrefs={showPrefs} onShowPrefsChange={onShowPrefsChange} />
        <RoleBadgeLegend />
      </div>
      <div className="view-popover-section">
        <button type="button" className="toolbar-popover-item" onClick={() => setKeyOpen(true)}>
          <span>Symbol key</span>
        </button>
      </div>
    </>
  );
}

export function DeckToolbar({
  title,
  sort,
  sortDir,
  onToggleSort,
  search,
  onSearch,
  viewMode,
  onViewModeChange,
  groupBy,
  onGroupByChange,
  gridZoom,
  gridWidth,
  onGridZoomChange,
  isNarrowGrid,
  showPrefs,
  onShowPrefsChange,
  onExport,
  onShowTestHand,
  outzoneCount,
  canBulkEdit,
  selectMode,
  onToggleSelectMode,
}: ToolbarProps) {
  return (
    <header className="deck-toolbar">
      {/* Grade and missing-cards count live in the Statistics → Overview panel
          now, so the toolbar stays focused on controls. The summary column's
          only visible content is the "Not in the deck" jump chip (E176) —
          .deck-toolbar-title is display:none — so at an empty out-zone the
          whole column goes with it rather than leaving an empty flex child
          holding a gap. A jump link to an empty zone is pure chrome, and on a
          phone it cost a full row above the fold. */}
      {outzoneCount > 0 && (
        <div className="deck-toolbar-summary">
          <span className="deck-toolbar-title">{title}</span>
          <a
            href="#deck-outzone"
            className="deck-toolbar-outzone-chip"
            aria-label={`Not in the deck — ${outzoneCount} ${outzoneCount === 1 ? 'card' : 'cards'} — jump to sideboard and considering`}
          >
            Not in deck
            <span className="deck-toolbar-outzone-count" aria-hidden>
              {outzoneCount}
            </span>
          </a>
        </div>
      )}
      <div className="deck-toolbar-controls">
        {canBulkEdit && !isNarrowGrid && (
          <button
            type="button"
            className="toolbar-pill deck-toolbar-select-toggle"
            aria-pressed={selectMode}
            onClick={onToggleSelectMode}
          >
            <CheckSquare width={14} height={14} strokeWidth={2} aria-hidden />
            <span>{selectMode ? 'Done' : 'Select'}</span>
          </button>
        )}
        {/* Narrow: Select stays visible only while active, so leaving the mode
            never requires hunting through the kebab. */}
        {canBulkEdit && isNarrowGrid && selectMode && (
          <button
            type="button"
            className="toolbar-pill deck-toolbar-select-toggle"
            aria-pressed
            onClick={onToggleSelectMode}
          >
            <CheckSquare width={14} height={14} strokeWidth={2} aria-hidden />
            <span>Done</span>
          </button>
        )}

        <SortMenu
          ariaLabel="Sort"
          value={sort}
          dir={sortDir}
          options={SORT_MENU_OPTIONS}
          onChange={onToggleSort}
        />

        {!isNarrowGrid && (
          <ToolbarPopover
            label="Show"
            icon={<Eye width={14} height={14} strokeWidth={2} aria-hidden />}
          >
            {() => (
              <>
                <ShowPrefsList showPrefs={showPrefs} onShowPrefsChange={onShowPrefsChange} />
                <RoleBadgeLegend />
              </>
            )}
          </ToolbarPopover>
        )}

        <SearchPill
          className="deck-toolbar-search"
          placeholder="Search…"
          value={search}
          onChange={onSearch}
          ariaLabel="Search this deck"
        />

        {!isNarrowGrid && <DeckViewModeToggle value={viewMode} onChange={onViewModeChange} />}

        {!isNarrowGrid && <DeckGroupByToggle value={groupBy} onChange={onGroupByChange} />}

        {!isNarrowGrid && viewMode === 'grid' && (
          <ZoomControl
            zoom={gridZoom}
            width={gridWidth}
            max={ZOOM_MAX}
            onChange={onGridZoomChange}
          />
        )}

        {/* The symbol key is the trailing reference control, grouped with the
            view-mode toggles — it sits after them and before the action buttons
            (Test hand / Export), per STYLE_GUIDE § Symbol key / Legend. */}
        {!isNarrowGrid && <Legend context="deck" align="right" variant="pill" />}

        {/* ≤640px: the display controls above (layout, grouping, card size,
            row details, key) collapse into one "View" popover so the toolbar
            stays a single row and the card list clears the fold — same
            treatment as the collection toolbar. */}
        {isNarrowGrid && (
          <ToolbarPopover
            label="View"
            icon={<Eye width={14} height={14} strokeWidth={2} aria-hidden />}
            haspopup="dialog"
            panelRole="dialog"
            panelAriaLabel="View options"
            panelClassName="toolbar-popover-panel toolbar-popover-panel--fixed view-popover-panel"
          >
            {() => (
              <DeckViewPopoverPanel
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                groupBy={groupBy}
                onGroupByChange={onGroupByChange}
                gridZoom={gridZoom}
                onGridZoomChange={onGridZoomChange}
                gridWidth={gridWidth}
                zoomMax={ZOOM_MAX_NARROW}
                showPrefs={showPrefs}
                onShowPrefsChange={onShowPrefsChange}
              />
            )}
          </ToolbarPopover>
        )}

        {!isNarrowGrid && onShowTestHand && (
          <button
            type="button"
            className="btn deck-toolbar-test-hand"
            onClick={onShowTestHand}
            title="Draw an opening hand"
          >
            <Hand width={14} height={14} strokeWidth={2} aria-hidden />
            Test hand
          </button>
        )}

        {!isNarrowGrid && (
          <button type="button" className="btn btn-primary deck-toolbar-export" onClick={onExport}>
            Export
          </button>
        )}

        {/* ≤640px: the list *actions* (select, test hand, export) collapse into
            the standard kebab rather than the View panel — they act on the
            deck, they don't configure the display. */}
        {isNarrowGrid && (
          <OverflowMenu
            ariaLabel="Deck list actions"
            triggerClassName="toolbar-pill"
            items={[
              ...(canBulkEdit && !selectMode
                ? [
                    {
                      label: 'Select cards',
                      icon: CheckSquare,
                      onClick: onToggleSelectMode,
                    },
                  ]
                : []),
              ...(onShowTestHand
                ? [{ label: 'Test hand', icon: Hand, onClick: onShowTestHand }]
                : []),
              { label: 'Export', icon: Share2, onClick: onExport },
            ]}
          />
        )}
      </div>
    </header>
  );
}

// ── View mode segmented control ──────────────────────────────────────────
// Thin wrapper around the shared <SharedViewModeToggle /> with deck-specific
// options (grid / list / text). No 'compact' — see the type declaration.
function DeckViewModeToggle({
  value,
  onChange,
}: {
  value: DeckViewMode;
  onChange: (m: DeckViewMode) => void;
}) {
  return (
    <SharedViewModeToggle<DeckViewMode>
      ariaLabel="Deck view mode"
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'grid',
          label: 'Grid view',
          icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
        },
        {
          value: 'list',
          label: 'List view',
          icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
        },
      ]}
    />
  );
}

// ── Group-by segmented control (E124) ────────────────────────────────────
// Thin wrapper around <SharedViewModeToggle />, same family as
// DeckViewModeToggle above — 'type' (canonical card type, the long-standing
// default) or 'category' (the generator's 8-bucket DeckCategory shape, with
// target gauges).
function DeckGroupByToggle({
  value,
  onChange,
}: {
  value: DeckGroupBy;
  onChange: (g: DeckGroupBy) => void;
}) {
  return (
    <SharedViewModeToggle<DeckGroupBy>
      ariaLabel="Group cards by"
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'type',
          label: 'Group by type',
          icon: <Shapes width={14} height={14} strokeWidth={2} aria-hidden />,
        },
        {
          value: 'category',
          label: 'Group by category',
          icon: <Tags width={14} height={14} strokeWidth={2} aria-hidden />,
        },
        {
          value: 'tag',
          label: 'Group by tag',
          icon: <TagIcon width={14} height={14} strokeWidth={2} aria-hidden />,
        },
      ]}
    />
  );
}
