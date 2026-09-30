import type { Ref } from 'react';
import { Captions, CheckSquare, ChevronsDownUp, ChevronsUpDown, Eye, Layers } from 'lucide-react';
import { ZOOM_MAX, ZOOM_MAX_NARROW } from '@/lib/util/grid-zoom';
import { Legend } from '@/components/Legend';
import { ViewModeToggle } from '@/components/ViewModeToggle';
import { ZoomControl } from '@/components/ZoomControl';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { SortMenu } from '@/components/search/SortMenu';
import { Button } from '@/components/shared/Button';
import { GridCaptionList, type GridCaptionPrefs } from '@/components/shared/CardGridCell';
import { ToolbarPopover } from '@/components/shared/ToolbarPopover';
import { ViewPopoverPanel } from '@/components/shared/ViewPopoverPanel';
import {
  GROUP_FIELDS,
  SORT_MENU_OPTIONS,
  VIEW_MODE_OPTIONS,
  type GroupKey,
  type SortKey,
  type ViewMode,
} from './card-list-table-config';

interface Props {
  rowRef: Ref<HTMLDivElement>;
  /** Show "N of M cards" (a filter or search narrows the set). */
  showResultCount: boolean;
  sortedCount: number;
  rowCount: number;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  isNarrow: boolean;
  groupKey: GroupKey;
  setGroupKey: (g: GroupKey) => void;
  hasSections: boolean;
  allCollapsed: boolean;
  toggleAllCollapsed: () => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  toggleSort: (key: SortKey) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  effectiveZoom: number;
  gridWidth: number;
  setGridZoom: (z: number) => void;
  gridCaptionPrefs: GridCaptionPrefs;
  setGridCaptionPrefs: (next: GridCaptionPrefs) => void;
}

/** The sticky sort / group / view controls row under CardListTable's search
 *  bar. Presentational: every value and handler comes in as a prop, so it
 *  carries none of the table's state (T176 split). */
export function CardListControls({
  rowRef,
  showResultCount,
  sortedCount,
  rowCount,
  selectMode,
  onToggleSelectMode,
  isNarrow,
  groupKey,
  setGroupKey,
  hasSections,
  allCollapsed,
  toggleAllCollapsed,
  sortKey,
  sortDir,
  toggleSort,
  view,
  setView,
  effectiveZoom,
  gridWidth,
  setGridZoom,
  gridCaptionPrefs,
  setGridCaptionPrefs,
}: Props) {
  return (
    <div ref={rowRef} className="card-list-summary-line card-list-controls-sticky">
      <div className="card-list-summary-actions">
        {/* Result count — only when filters/search narrow the set */}
        {showResultCount && (
          <span className="card-list-result-count" aria-live="polite">
            {sortedCount.toLocaleString()} of {rowCount.toLocaleString()} cards
          </span>
        )}
        {sortedCount > 0 && (
          <Button
            placement="toolbar"
            className="card-list-select-toggle"
            aria-pressed={selectMode}
            // Idle label hides on phones (`.toolbar-label-compact`) — see
            // SelectToggle in BulkSelectBar.tsx, same control, same reason.
            aria-label={selectMode ? 'Done selecting' : 'Select'}
            title={selectMode ? 'Done selecting' : 'Select'}
            onClick={onToggleSelectMode}
            icon={<CheckSquare width={14} height={14} strokeWidth={2} />}
            labelClassName="toolbar-label-compact"
          >
            {selectMode ? 'Done' : 'Select'}
          </Button>
        )}
        <SelectMenu<GroupKey>
          ariaLabel="Group by"
          value={groupKey}
          options={GROUP_FIELDS.map((f) => ({
            value: f.key,
            label: f.label,
            // On phones the trigger for the default state says what the
            // control DOES rather than restating that nothing is set — the
            // menu row still reads "No grouping", and the 43px saved is
            // what keeps this toolbar on one row at 360px.
            triggerLabel: isNarrow && f.key === 'none' ? 'Group' : undefined,
          }))}
          onChange={setGroupKey}
          leadingIcon={<Layers width={14} height={14} strokeWidth={2} aria-hidden />}
        />
        {groupKey !== 'none' && hasSections && (
          <Button
            placement="toolbar"
            aria-pressed={allCollapsed}
            onClick={toggleAllCollapsed}
            title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
            aria-label={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
            icon={
              allCollapsed ? (
                <ChevronsUpDown width={14} height={14} strokeWidth={2} />
              ) : (
                <ChevronsDownUp width={14} height={14} strokeWidth={2} />
              )
            }
          >
            {/* Icon-only on phones — the chevrons glyph + tooltip carry it,
                and the label is what pushed the grouped toolbar to a 2nd row. */}
            {!isNarrow && <span>{allCollapsed ? 'Expand all' : 'Collapse all'}</span>}
          </Button>
        )}
        <SortMenu
          ariaLabel="Sort"
          value={sortKey}
          dir={sortDir}
          options={SORT_MENU_OPTIONS}
          onChange={toggleSort}
        />
        {!isNarrow && view === 'grid' && (
          <ZoomControl
            zoom={effectiveZoom}
            width={gridWidth}
            max={ZOOM_MAX}
            onChange={setGridZoom}
          />
        )}
        {!isNarrow && view === 'grid' && (
          <ToolbarPopover
            label="Details"
            icon={<Captions width={14} height={14} strokeWidth={2} aria-hidden />}
          >
            {() => <GridCaptionList prefs={gridCaptionPrefs} onChange={setGridCaptionPrefs} />}
          </ToolbarPopover>
        )}
        {!isNarrow && (
          <ViewModeToggle<ViewMode>
            ariaLabel="Collection view mode"
            value={view}
            onChange={setView}
            options={VIEW_MODE_OPTIONS}
          />
        )}
        {!isNarrow && <Legend context="collection" align="right" variant="pill" />}
        {/* ≤640px: the display controls above (zoom, Details, layout, key)
            collapse into one "View" popover so the sticky toolbar stays a
            single row — see STYLE_GUIDE "Toolbars & action rows". Icon-only:
            with the label it was 95px on a 344px row and the row wrapped,
            which put this one control on a line of its own above the cards. */}
        {isNarrow && (
          <ToolbarPopover
            icon={<Eye width={14} height={14} strokeWidth={2} aria-hidden />}
            triggerAriaLabel="View options"
            triggerTitle="View options"
            haspopup="dialog"
            panelRole="dialog"
            panelAriaLabel="View options"
            panelClassName="toolbar-popover-panel toolbar-popover-panel--fixed view-popover-panel"
          >
            {() => (
              <ViewPopoverPanel<ViewMode>
                view={view}
                setView={setView}
                options={VIEW_MODE_OPTIONS}
                ariaLabel="Collection view mode"
                zoom={effectiveZoom}
                zoomMax={ZOOM_MAX_NARROW}
                gridWidth={gridWidth}
                onZoomChange={setGridZoom}
                captionPrefs={gridCaptionPrefs}
                onCaptionPrefsChange={setGridCaptionPrefs}
              />
            )}
          </ToolbarPopover>
        )}
      </div>
    </div>
  );
}
