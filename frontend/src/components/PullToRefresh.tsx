import { usePullToRefresh, PTR_THRESHOLD, PTR_MAX } from '@/lib/use-pull-to-refresh';
import './PullToRefresh.css';

/**
 * Native pull-to-refresh indicator. Render once inside the app's scroll
 * container (`app-main`); it stays out of layout (sticky, zero-height) and
 * descends a spinner from the top edge as the user drags down, Android
 * Material-style — the content itself does not move. `onRefresh` should be
 * awaitable so the spinner holds until the refresh settles.
 *
 * Native-only: gate the render site with `isNativePlatform()`.
 */
export function PullToRefresh({
  scrollEl,
  onRefresh,
}: {
  scrollEl: HTMLElement | null;
  onRefresh: () => Promise<void>;
}) {
  const { pull, status } = usePullToRefresh(scrollEl, onRefresh);

  // Nothing in the DOM at rest.
  if (status === 'idle' && pull === 0) return null;

  const progress = Math.min(1, pull / PTR_THRESHOLD);
  const spinning = status === 'refreshing';

  return (
    <div className="ptr-host" data-status={status}>
      <div
        className="ptr-badge"
        style={{
          transform: `translateY(${pull}px) scale(${0.7 + progress * 0.3})`,
          opacity: Math.min(1, progress + 0.15),
        }}
        aria-hidden="true"
      >
        <svg
          className="ptr-spinner"
          viewBox="0 0 24 24"
          // While dragging, the arc rotates with the pull for feedback; while
          // refreshing we drop the inline transform and let the CSS spin run.
          style={spinning ? undefined : { transform: `rotate(${progress * 280}deg)` }}
        >
          <circle className="ptr-arc" cx="12" cy="12" r="9" pathLength={100} />
        </svg>
      </div>
      <span role="status" className="sr-only">
        {spinning ? 'Refreshing' : status === 'armed' ? 'Release to refresh' : ''}
      </span>
    </div>
  );
}

// Re-export so the indicator's fill math and the hook's thresholds stay in lockstep.
export { PTR_THRESHOLD, PTR_MAX };
