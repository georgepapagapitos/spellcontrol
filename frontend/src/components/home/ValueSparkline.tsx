import './ValueSparkline.css';
import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../lib/format-money';
import { daysBetween, formatDayKey, type ValuePoint } from '../../lib/value-history';

/** Fallback when the box can't be measured (test DOMs). */
const HEIGHT = 48;
const PAD = 4;

/**
 * Headline value sparkline: the device-local daily value log as a decorative
 * area chart with a hover/keyboard crosshair readout — no gridlines, ticks, or
 * legend (a single series names itself through the figure above it), per the
 * STYLE_GUIDE "Money deltas & value sparklines" ruling. This is deliberately
 * NOT the full plotted § Charts treatment `ValueTrend.tsx` already owns for
 * the Breakdown drawer — smaller, chrome-free, a headline not a reading tool.
 *
 * Lives under the hero's value (one fact, one place): it used to sit in the
 * Value movers card, which restated the hero's figure word for word above it.
 * The two end labels are the only axis — the window's first day and "Today"
 * when the log is current — so the delta beside the value has a visible span.
 * Callers render it only from two points up (no trend, no chart).
 */
export function ValueSparkline({ points, today }: { points: ValuePoint[]; today: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(HEIGHT);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // clientWidth is 0 in test DOMs — fall back to a nominal width so the
    // sparkline still renders (mirrors ValueTrend.tsx's own TrendChart).
    // Both axes: from 600px the hero gives the chart whatever height the
    // card beside it leaves, so the line fills that space instead of a band
    // of nothing opening under it.
    const measure = () => {
      setWidth(el.clientWidth || 240);
      setHeight(el.clientHeight || HEIGHT);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const last = points.length - 1;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const spanDays = Math.max(1, daysBetween(points[0].day, points[last].day));
  const baseline = height - PAD;

  const xs = points.map(
    (p) => PAD + (daysBetween(points[0].day, p.day) / spanDays) * (width - PAD * 2)
  );
  const ys = values.map((v) => {
    const norm = range === 0 ? 0.5 : (v - min) / range;
    return baseline - norm * (baseline - PAD);
  });
  const line = points.map((_, i) => `${xs[i]},${ys[i]}`).join(' ');
  const area = `${PAD},${baseline} ${line} ${xs[last]},${baseline}`;

  const nearestIdx = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    return best;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = (d: number) => setActive((cur) => Math.min(last, Math.max(0, (cur ?? last) + d)));
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const first = points[0];
  const latest = points[last];
  const pctChange =
    first.value !== 0 ? Math.round(((latest.value - first.value) / first.value) * 100) : null;
  const ariaLabel =
    `Collection value, ${formatDayKey(first.day)} to ${formatDayKey(latest.day)}: ` +
    `${formatMoney(first.value, { wholeDollars: true })} to ${formatMoney(latest.value, { wholeDollars: true })}` +
    (pctChange !== null ? ` (${pctChange > 0 ? '+' : ''}${pctChange}%)` : '');

  const activePoint = active === null ? null : points[active];

  return (
    <div className="home-value-sparkline-wrap">
      <div
        ref={wrapRef}
        className="home-value-sparkline"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={active ?? last}
        aria-valuetext={`${formatMoney((activePoint ?? latest).value, { wholeDollars: true })} on ${formatDayKey((activePoint ?? latest).day)}`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            onPointerMove={(e) => setActive(nearestIdx(e.clientX))}
            onPointerDown={(e) => setActive(nearestIdx(e.clientX))}
            onPointerLeave={() => setActive(null)}
          >
            <line
              className="home-value-sparkline-baseline"
              x1={PAD}
              x2={width - PAD}
              y1={baseline}
              y2={baseline}
            />
            <polygon className="home-value-sparkline-area" points={area} />
            <polyline
              className="home-value-sparkline-line"
              points={line}
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {active !== null && (
              <line
                className="home-value-sparkline-crosshair"
                x1={xs[active]}
                x2={xs[active]}
                y1={PAD}
                y2={baseline}
              />
            )}
            <circle
              className="home-value-sparkline-dot"
              cx={active !== null ? xs[active] : xs[last]}
              cy={active !== null ? ys[active] : ys[last]}
              r={4}
            />
          </svg>
        )}
        {activePoint && active !== null && (
          <div
            className="home-value-sparkline-tooltip"
            role="status"
            style={{ left: Math.min(Math.max(xs[active], 30), Math.max(width - 30, 30)) }}
          >
            <span className="home-value-sparkline-tooltip-value">
              {formatMoney(activePoint.value, { wholeDollars: true })}
            </span>
            <span className="home-value-sparkline-tooltip-day">
              {formatDayKey(activePoint.day)}
            </span>
          </div>
        )}
      </div>
      <div className="home-value-sparkline-axis" aria-hidden="true">
        <span>{formatDayKey(first.day)}</span>
        <span>{latest.day === today ? 'Today' : formatDayKey(latest.day)}</span>
      </div>
    </div>
  );
}
