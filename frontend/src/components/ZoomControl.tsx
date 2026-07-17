import { ZoomIn, ZoomOut } from 'lucide-react';
import { ZOOM_MIN } from '../lib/grid-zoom';

interface Props {
  /** Current zoom step, already clamped to the viewport's range. */
  zoom: number;
  /** Largest step reachable on this viewport. */
  max: number;
  onChange: (next: number) => void;
}

/**
 * Magnifier −/+ stepper for card-grid zoom — replaces the 1×/2×/3× preset
 * toggle. Same `.toolbar-viewmode` pill family as the view-mode toggles so
 * it reads as part of the toolbar group.
 */
export function ZoomControl({ zoom, max, onChange }: Props) {
  return (
    <div className="toolbar-viewmode" role="group" aria-label="Card size">
      <button
        type="button"
        className="toolbar-viewmode-btn"
        aria-label="Smaller cards"
        title="Smaller cards"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => onChange(Math.max(ZOOM_MIN, zoom - 1))}
      >
        <ZoomOut width={14} height={14} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="toolbar-viewmode-btn"
        aria-label="Bigger cards"
        title="Bigger cards"
        disabled={zoom >= max}
        onClick={() => onChange(Math.min(max, zoom + 1))}
      >
        <ZoomIn width={14} height={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
