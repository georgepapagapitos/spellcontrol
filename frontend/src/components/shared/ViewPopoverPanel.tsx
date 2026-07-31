import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { LegendContent } from '../Legend';
import { ViewModeToggle, type ViewModeOption } from '../ViewModeToggle';
import { ZoomControl } from '../ZoomControl';
import { GridCaptionList, type GridCaptionPrefs } from './CardGridCell';

/**
 * Narrow-viewport "View" popover panel — consolidates the display controls
 * (layout, card size, Details captions, symbol key) that would otherwise wrap
 * a sticky card toolbar onto extra rows on a phone. Shared by every card
 * surface that offers those controls, so a phone gets the same panel whether
 * it's looking at the collection or a list. The symbol key opens as a sub-page
 * of the same panel (the standalone Legend popover's lifetime is tied to its
 * trigger, which unmounts with this panel). State lives here so it resets
 * whenever the popover closes. See STYLE_GUIDE "Toolbars & action rows".
 */
export function ViewPopoverPanel<T extends string>({
  view,
  setView,
  options,
  ariaLabel,
  zoom,
  zoomMax,
  gridWidth,
  onZoomChange,
  captionPrefs,
  onCaptionPrefsChange,
}: {
  view: T;
  setView: (v: T) => void;
  options: Array<ViewModeOption<T>>;
  /** aria-label for the layout toggle, e.g. "Collection view mode". */
  ariaLabel: string;
  zoom: number;
  zoomMax: number;
  /** Measured width of the grid, so the stepper can skip steps that wouldn't
   *  change the column count at this size. */
  gridWidth: number;
  onZoomChange: (next: number) => void;
  captionPrefs: GridCaptionPrefs;
  onCaptionPrefsChange: (next: GridCaptionPrefs) => void;
}) {
  const [keyOpen, setKeyOpen] = useState(false);
  // The zoom + caption controls only govern the grid; both callers name their
  // grid mode 'grid'.
  const isGrid = (view as string) === 'grid';
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
        <LegendContent context="collection" />
      </div>
    );
  }
  return (
    <>
      <div className="view-popover-row">
        <span className="view-popover-row-label">Layout</span>
        <ViewModeToggle<T>
          ariaLabel={ariaLabel}
          value={view}
          onChange={setView}
          options={options}
        />
      </div>
      {isGrid && (
        <div className="view-popover-row">
          <span className="view-popover-row-label">Card size</span>
          <ZoomControl zoom={zoom} width={gridWidth} max={zoomMax} onChange={onZoomChange} />
        </div>
      )}
      {isGrid && (
        <div className="view-popover-section">
          <span className="view-popover-section-title">Details</span>
          <GridCaptionList prefs={captionPrefs} onChange={onCaptionPrefsChange} />
        </div>
      )}
      <div className="view-popover-section">
        <button type="button" className="toolbar-popover-item" onClick={() => setKeyOpen(true)}>
          <span>Symbol key…</span>
        </button>
      </div>
    </>
  );
}
