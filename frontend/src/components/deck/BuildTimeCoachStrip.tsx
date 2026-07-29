import type { JSX } from 'react';
import { ChevronRight, Gauge, Trophy, X, Zap } from 'lucide-react';
import './BuildTimeCoachStrip.css';
import type { BuildTimeNudge, BuildTimeNudgeKind } from '../../lib/use-build-time-nudge';

const KIND_ICON: Record<BuildTimeNudgeKind, JSX.Element> = {
  combo: <Zap width={16} height={16} aria-hidden />,
  wincon: <Trophy width={16} height={16} aria-hidden />,
  bracket: <Gauge width={16} height={16} aria-hidden />,
};

const KIND_VIEW_LABEL: Record<BuildTimeNudgeKind, string> = {
  combo: 'View combo',
  wincon: 'View win condition',
  bracket: 'View bracket',
};

interface Props {
  nudge: BuildTimeNudge | null;
  /** Navigates to the nudge's detail panel. The caller closes the add sheet
   *  first (see STYLE_GUIDE "Build-time coach strip") — this is a navigating
   *  strip, not a tap-opens-sheet one, so it can't silently drop the search
   *  session; the navigate itself is the deliberate close. */
  onView: (kind: BuildTimeNudgeKind) => void;
  onDismiss: () => void;
}

/**
 * One-row nudge surfaced inside the add-cards sheet the instant a mainboard
 * add completes a combo, hands the deck its first win condition, or (once
 * the deck is mostly built) moves the bracket estimate. Renders nothing when
 * there's no genuine signal — never a permanent fixture, never pushes the
 * search results around beyond its own row. See use-build-time-nudge.ts for
 * the guard against firing off a remote/analysis-only write.
 */
export function BuildTimeCoachStrip({ nudge, onView, onDismiss }: Props): JSX.Element | null {
  if (!nudge) return null;

  return (
    <div className="build-time-coach-strip" role="status" aria-live="polite">
      <span className={`build-time-coach-strip-icon is-${nudge.kind}`} aria-hidden="true">
        {KIND_ICON[nudge.kind]}
      </span>
      <div className="build-time-coach-strip-body">
        <p className="build-time-coach-strip-headline">{nudge.headline}</p>
        {nudge.detail && <p className="build-time-coach-strip-detail">{nudge.detail}</p>}
      </div>
      <button
        type="button"
        className="build-time-coach-strip-view"
        onClick={() => onView(nudge.kind)}
      >
        {KIND_VIEW_LABEL[nudge.kind]}
        <ChevronRight width={14} height={14} aria-hidden />
      </button>
      <button
        type="button"
        className="build-time-coach-strip-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X width={14} height={14} aria-hidden />
      </button>
    </div>
  );
}
