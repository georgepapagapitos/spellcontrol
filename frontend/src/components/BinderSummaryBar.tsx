import {
  AlignJustify,
  BookOpen,
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  LayoutGrid,
  List as ListIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { SortEntry, SortField } from '../types';
import { SortPopover } from './SortPopover';
import { ViewModeToggle, type ViewModeOption } from './ViewModeToggle';
import { Legend, LegendContent } from './Legend';
import { ToolbarPopover } from './shared/ToolbarPopover';
import { useMediaQuery } from '../lib/use-media-query';
import { Button, buttonClass } from '@/components/shared/Button';

export type BinderViewMode = 'pages' | 'list' | 'compact';

const VIEW_OPTIONS: Array<ViewModeOption<BinderViewMode>> = [
  {
    value: 'pages',
    label: 'Pages view',
    icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
  },
  {
    value: 'list',
    label: 'List view (with thumbnails)',
    icon: <ListIcon width={14} height={14} strokeWidth={2} aria-hidden />,
  },
  {
    value: 'compact',
    label: 'Compact list (text only)',
    icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
  },
];

export interface BinderDisplayToggle {
  key: string;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** The untouched state, so the trigger can badge only real changes. */
  defaultValue?: boolean;
}

/** The page's display state, owned by BinderPage and threaded to whichever view is mounted. */
export interface BinderViewControls {
  view: BinderViewMode;
  onViewChange: (next: BinderViewMode) => void;
  /** Display preferences that apply to the current view (empty in the lists). */
  toggles: BinderDisplayToggle[];
}

interface Props {
  binderName: string;
  /** Absent when the binder has no pages to browse. */
  onBrowsePages?: () => void;
  /** Absent when the order is manual, so there is no sort to edit. */
  sort?: {
    sorts: SortEntry[];
    valueOrders: Partial<Record<SortField, string[]>>;
    onSortsChange: (next: SortEntry[]) => void;
    onValueOrdersChange: (next: Partial<Record<SortField, string[]>>) => void;
  };
  /** Absent when there is only one section to collapse. */
  collapse?: { allCollapsed: boolean; onToggle: () => void };
  controls: BinderViewControls;
}

// Same wall as the collection toolbar: below it the display preferences fold
// into one View popover so the row holds on a single line.
const NARROW = '(max-width: 640px)';

/**
 * The binder's one control row, shared by the page grid and both lists so the
 * three views can't drift apart. Data controls (browse, sort, collapse) stay on
 * the row at every width; display preferences (layout, card images, grouping,
 * the symbol key) sit inline on desktop and fold into the View popover on a
 * phone. STYLE_GUIDE § Toolbars & action rows, § Binder views.
 */
export function BinderSummaryBar({ binderName, onBrowsePages, sort, collapse, controls }: Props) {
  const narrow = useMediaQuery(NARROW);
  const { view, onViewChange, toggles } = controls;
  const changed = toggles.filter((t) => t.value !== (t.defaultValue ?? false)).length;
  const collapseLabel = collapse?.allCollapsed ? 'Expand all' : 'Collapse all';

  return (
    <div className="binder-summary">
      {onBrowsePages && (
        <button
          type="button"
          className="binder-summary-browse-pages"
          onClick={onBrowsePages}
          aria-label={`Browse pages of ${binderName}`}
        >
          <BookOpen width={14} height={14} strokeWidth={2} aria-hidden />
          <span>Browse pages</span>
        </button>
      )}
      {sort && <SortPopover {...sort} />}
      <div className="binder-summary-end">
        {collapse && (
          <Button
            placement="toolbar"
            onClick={collapse.onToggle}
            aria-label={collapseLabel}
            title={collapseLabel}
            icon={
              collapse.allCollapsed ? (
                <ChevronsUpDown width={14} height={14} strokeWidth={2} />
              ) : (
                <ChevronsDownUp width={14} height={14} strokeWidth={2} />
              )
            }
          >
            {!narrow && <span>{collapseLabel}</span>}
          </Button>
        )}
        {!narrow && (
          <ViewModeToggle<BinderViewMode>
            ariaLabel="Binder view mode"
            value={view}
            onChange={onViewChange}
            options={VIEW_OPTIONS}
          />
        )}
        {!narrow && <Legend context="binder" variant="pill" align="right" />}
        {(narrow || toggles.length > 0) && (
          <ToolbarPopover
            triggerContent={
              <>
                <Eye width={14} height={14} strokeWidth={2} aria-hidden />
                {changed > 0 && (
                  <span className="collection-filters-badge" aria-hidden>
                    {changed}
                  </span>
                )}
              </>
            }
            triggerClassName={`${buttonClass({ placement: 'toolbar' })} binder-summary-view`}
            triggerAriaLabel={changed > 0 ? `View options (${changed} changed)` : 'View options'}
            triggerTitle="View options"
            haspopup="dialog"
            panelRole="dialog"
            panelAriaLabel="View options"
            panelClassName="toolbar-popover-panel toolbar-popover-panel--fixed view-popover-panel"
          >
            {() => (
              <ViewPanel
                narrow={narrow}
                view={view}
                onViewChange={onViewChange}
                toggles={toggles}
              />
            )}
          </ToolbarPopover>
        )}
      </div>
    </div>
  );
}

function ViewPanel({
  narrow,
  view,
  onViewChange,
  toggles,
}: {
  narrow: boolean;
  view: BinderViewMode;
  onViewChange: (next: BinderViewMode) => void;
  toggles: BinderDisplayToggle[];
}) {
  // The symbol key opens as a sub-page: the standalone Legend popover's
  // lifetime is tied to a trigger that doesn't exist on a phone.
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
        <LegendContent context="binder" />
      </div>
    );
  }
  return (
    <>
      {narrow && (
        <div className="view-popover-row">
          <span className="view-popover-row-label">Layout</span>
          <ViewModeToggle<BinderViewMode>
            ariaLabel="Binder view mode"
            value={view}
            onChange={onViewChange}
            options={VIEW_OPTIONS}
          />
        </div>
      )}
      {toggles.length > 0 && (
        <div className={narrow ? 'view-popover-section' : undefined}>
          {toggles.map((t) => (
            <label key={t.key} className="filter-popover-row">
              <input
                type="checkbox"
                checked={t.value}
                onChange={(e) => t.onChange(e.target.checked)}
              />
              <span className="filter-popover-label">{t.label}</span>
            </label>
          ))}
        </div>
      )}
      {narrow && (
        <div className="view-popover-section">
          <button type="button" className="toolbar-popover-item" onClick={() => setKeyOpen(true)}>
            <span>Symbol key</span>
          </button>
        </div>
      )}
    </>
  );
}
