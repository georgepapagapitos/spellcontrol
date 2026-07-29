import { ZoomIn, ZoomOut } from 'lucide-react';
import { ZOOM_MIN, nextZoomStep, zoomTier } from '../lib/grid-zoom';

interface Props {
  /** Current zoom step, already clamped to the viewport's range. */
  zoom: number;
  /** Measured width of the grid this control sizes, in px (0 pre-measure). */
  width: number;
  /** Largest step reachable on this viewport. */
  max: number;
  onChange: (next: number) => void;
}

/**
 * Magnifier −/+ stepper for card-grid zoom — replaces the 1×/2×/3× preset
 * toggle. Same `.toolbar-viewmode` pill family as the view-mode toggles so
 * it reads as part of the toolbar group.
 *
 * A press moves to the next step that renders a *different column count*, not
 * simply `zoom ± 1`. The ladder is a set of px minimums, but the user sees a
 * whole number of columns, so flooring collapses adjacent steps onto the same
 * layout at most widths — at 360px, steps 0 and 1 are both 3 columns and the
 * default is 1, which made the first − press on a phone do visibly nothing.
 * The step math lives here rather than in each caller so the four call sites
 * only have to hand over their measured width.
 */
export function ZoomControl({ zoom, width, max, onChange }: Props) {
  const tier = zoomTier(width);
  const smaller = nextZoomStep(zoom, -1, tier, width, ZOOM_MIN, max);
  const bigger = nextZoomStep(zoom, 1, tier, width, ZOOM_MIN, max);

  return (
    <div className="toolbar-viewmode" role="group" aria-label="Card size">
      <button
        type="button"
        className="toolbar-viewmode-btn"
        aria-label="Smaller cards"
        title="Smaller cards"
        // Range ends disable, never hide (STYLE_GUIDE). "No distinct step in
        // this direction" is the same condition as hitting the ladder end.
        disabled={smaller === zoom}
        onClick={() => onChange(smaller)}
      >
        <ZoomOut width={14} height={14} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="toolbar-viewmode-btn"
        aria-label="Bigger cards"
        title="Bigger cards"
        disabled={bigger === zoom}
        onClick={() => onChange(bigger)}
      >
        <ZoomIn width={14} height={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
