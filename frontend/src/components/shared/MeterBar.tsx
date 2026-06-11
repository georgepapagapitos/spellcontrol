import './MeterBar.css';
import type { CSSProperties, JSX } from 'react';

/**
 * MeterBar / StackedBar — THE shared horizontal bar-track primitives.
 *
 * Every proportional bar on screen (collection breakdowns, deck stats, bracket
 * soft score, engine balance, readiness, upload progress) routes through these
 * so the geometry lives in exactly one place: one track (`var(--border)`,
 * 999px radius), one mount animation (grow from the left edge), one
 * reduced-motion gate. Never hand-roll a `<div style={{ width: '…%' }}>` fill —
 * see STYLE_GUIDE.md "Bars & meters".
 *
 * The primitive owns geometry/track/animation only; the **palette is the
 * caller's** (`color` / per-segment `color` props), so per-surface color
 * semantics stay at the call site.
 *
 * Accessibility story (consistent across the app): bars default to
 * `aria-hidden` because every call site renders the numbers as adjacent
 * visible text (counts, percentages, "value/max"). The exception is live
 * progress (ProgressBar), which opts into `role="progressbar"` +
 * `aria-valuenow`.
 */

type Size = 'sm' | 'md';

function joinClasses(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Fill percentage for a value/max pair — clamped to [0, 100]; degenerate
 *  inputs (non-finite, `max <= 0`) read as empty, never NaN/overflow. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper tested alongside the primitive; HMR cost only matters on dev edits, not worth a separate module
export function meterPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export interface MeterBarProps {
  /** Current value, in the same unit as `max`. */
  value: number;
  /** Scale ceiling — the value that fills the whole track. Default 100. */
  max?: number;
  /** Fill color (any CSS color / `var(--…)`). Default `var(--accent)`. */
  color?: string;
  /** Track height: 'sm' (default, inline meters) or 'md' (progress bars). */
  size?: Size;
  /** Visual floor (in %) so a tiny-but-nonzero value still reads — display
   *  only; `aria-valuenow` stays the true value. */
  minPct?: number;
  /** Looping sweep instead of a fixed fill (unknown progress). */
  indeterminate?: boolean;
  /**
   * Expose the bar to AT. Omitted (default) → `aria-hidden`; the call site is
   * expected to carry the numbers as visible text. `progressbar` is for live
   * operations, `meter` for static gauges without adjacent text.
   */
  role?: 'meter' | 'progressbar';
  /** Accessible name — only meaningful with `role`. */
  label?: string;
  /** Native tooltip on the track. */
  title?: string;
  /** Layout-only hook (margins/flex in the site's CSS) — never re-style the track. */
  className?: string;
}

/** Single-fill horizontal bar: `value` out of `max`. */
export function MeterBar({
  value,
  max = 100,
  color,
  size = 'sm',
  minPct = 0,
  indeterminate = false,
  role,
  label,
  title,
  className,
}: MeterBarProps): JSX.Element {
  const pct = Math.max(meterPct(value, max), Math.min(100, Math.max(0, minPct)));
  const fillStyle: CSSProperties | undefined = indeterminate
    ? color
      ? { background: color }
      : undefined
    : { width: `${pct}%`, ...(color ? { background: color } : undefined) };

  const ariaProps = role
    ? {
        role,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-valuenow': indeterminate ? undefined : Math.min(Math.max(value, 0), max),
        'aria-label': label,
      }
    : ({ 'aria-hidden': true } as const);

  return (
    <div
      className={joinClasses('meterbar', size === 'md' && 'meterbar--md', className)}
      title={title}
      {...ariaProps}
    >
      <div
        className={joinClasses('meterbar-fill', indeterminate && 'meterbar-fill--indeterminate')}
        style={fillStyle}
      />
    </div>
  );
}

export interface StackedBarSegment {
  /** Stable identity for React keys. */
  key: string;
  /** Segment magnitude, in the same unit as its siblings (and `max`). */
  value: number;
  /** Segment fill color — palette stays with the caller. */
  color: string;
  /** Native tooltip for the segment (hover-only enhancement). */
  title?: string;
}

/**
 * Per-segment track percentages. With no `max` the segments fill the track
 * proportionally; with `max` the stack spans `sum/max` of the track (partial-
 * width stacks, e.g. "30 creatures out of a 3,365-card collection, split by
 * color"). Overflow (`sum > max`) renormalizes to a full track so proportions
 * survive instead of clipping. Negative / non-finite values read as 0.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper tested alongside the primitive; HMR cost only matters on dev edits, not worth a separate module
export function stackedTrackPcts(
  segments: ReadonlyArray<{ value: number }>,
  max?: number
): number[] {
  const vals = segments.map((s) => (Number.isFinite(s.value) && s.value > 0 ? s.value : 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  const denom = max != null && Number.isFinite(max) && max > 0 ? Math.max(max, sum) : sum;
  if (denom <= 0) return vals.map(() => 0);
  return vals.map((v) => (v / denom) * 100);
}

export interface StackedBarProps {
  segments: StackedBarSegment[];
  /** Scale ceiling for the whole stack; default = the segments' sum (full track). */
  max?: number;
  size?: Size;
  /** Native tooltip on the track. */
  title?: string;
  /** Layout-only hook — never re-style the track. */
  className?: string;
}

/**
 * Multi-segment horizontal bar. Always `aria-hidden` — every call site renders
 * the segment numbers as visible text; segments carry an inset hairline
 * divider as a non-color (colorblind-safe) boundary cue.
 */
export function StackedBar({
  segments,
  max,
  size = 'sm',
  title,
  className,
}: StackedBarProps): JSX.Element {
  const pcts = stackedTrackPcts(segments, max);
  const totalPct = pcts.reduce((a, b) => a + b, 0);

  return (
    <div
      className={joinClasses('meterbar', size === 'md' && 'meterbar--md', className)}
      title={title}
      aria-hidden
    >
      {totalPct > 0 && (
        <div className="meterbar-segments" style={{ width: `${totalPct}%` }}>
          {segments.map((seg, i) =>
            pcts[i] > 0 ? (
              <div
                key={seg.key}
                className="meterbar-seg"
                style={{ width: `${(pcts[i] / totalPct) * 100}%`, background: seg.color }}
                title={seg.title}
              />
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
