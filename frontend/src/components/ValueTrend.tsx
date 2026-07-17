import { useEffect, useRef, useState } from 'react';
import { useCurrency } from '../lib/currency';
import { formatMoney } from '../lib/format-money';
import {
  computeValueDelta,
  dayKey,
  daysBetween,
  formatDayKey,
  getLatestMovers,
  getValueHistory,
  type MoverRecord,
  type ValuePoint,
} from '../lib/value-history';
import './ValueTrend.css';

const HEIGHT = 132;
const PAD_TOP = 24; // room for tick labels + the endpoint label
const PAD_BOTTOM = 6;
const PAD_X = 6;

/** Snap a raw step to a clean 1/2/2.5/5×10^k value. */
function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

/** Up to ~3 clean gridline values strictly inside the domain. */
function niceTicks(min: number, max: number): number[] {
  const range = max - min;
  if (range <= 0) return [];
  const step = niceStep(range / 3);
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return ticks;
}

function TrendChart({ points }: { points: ValuePoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  // Hovered / keyboard-selected point index; null = no readout.
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // clientWidth is 0 in test DOMs (and ResizeObserver may be absent) — fall
    // back to a nominal width so the chart still renders.
    const measure = () => setWidth(el.clientWidth || 320);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const spanDays = Math.max(1, daysBetween(points[0].day, points[points.length - 1].day));
  const baseline = HEIGHT - PAD_BOTTOM;

  // Time-proportional x (a gappy log must not compress its gaps); flat
  // history centers the line rather than dividing by zero.
  const xs = points.map(
    (p) => PAD_X + (daysBetween(points[0].day, p.day) / spanDays) * (width - PAD_X * 2)
  );
  const ys = values.map((v) => {
    const norm = range === 0 ? 0.5 : (v - min) / range;
    return baseline - norm * (baseline - PAD_TOP);
  });
  const line = points.map((_, i) => `${xs[i]},${ys[i]}`).join(' ');
  const area = `${PAD_X},${baseline} ${line} ${xs[xs.length - 1]},${baseline}`;
  const last = points.length - 1;

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

  const activePoint = active === null ? null : points[active];

  return (
    <div
      ref={wrapRef}
      className="value-trend-chart"
      role="group"
      aria-label="Daily value chart. Use the arrow keys to read individual days."
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          aria-hidden="true"
          onPointerMove={(e) => setActive(nearestIdx(e.clientX))}
          onPointerDown={(e) => setActive(nearestIdx(e.clientX))}
          onPointerLeave={() => setActive(null)}
        >
          {niceTicks(min, min + range).map((t) => {
            const y = baseline - ((t - min) / range) * (baseline - PAD_TOP);
            return (
              <g key={t}>
                <line className="value-trend-grid" x1={PAD_X} x2={width - PAD_X} y1={y} y2={y} />
                <text className="value-trend-tick" x={PAD_X} y={y - 3}>
                  {formatMoney(t, { wholeDollars: true })}
                </text>
              </g>
            );
          })}
          <polygon className="value-trend-area" points={area} />
          <polyline
            className="value-trend-line"
            points={line}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {activePoint && active !== null && (
            <line
              className="value-trend-crosshair"
              x1={xs[active]}
              x2={xs[active]}
              y1={PAD_TOP - 6}
              y2={baseline}
            />
          )}
          <circle
            className="value-trend-dot"
            cx={active !== null ? xs[active] : xs[last]}
            cy={active !== null ? ys[active] : ys[last]}
            r={4}
          />
          {active === null && (
            <text
              className="value-trend-end-label"
              x={xs[last] - 8}
              y={ys[last] - 8}
              textAnchor="end"
            >
              {formatMoney(points[last].value, { wholeDollars: true })}
            </text>
          )}
        </svg>
      )}
      {activePoint && active !== null && (
        <div
          className="value-trend-tooltip"
          role="status"
          style={{ left: Math.min(Math.max(xs[active], 40), Math.max(width - 40, 40)) }}
        >
          <span className="value-trend-tooltip-value">
            {formatMoney(activePoint.value, { wholeDollars: true })}
          </span>
          <span className="value-trend-tooltip-day">{formatDayKey(activePoint.day)}</span>
        </div>
      )}
      <div className="value-trend-axis" aria-hidden="true">
        <span>{formatDayKey(points[0].day)}</span>
        <span>{formatDayKey(points[last].day)}</span>
      </div>
    </div>
  );
}

/**
 * "Value" section of the collection Breakdown drawer (E76 follow-up): the
 * device-local daily value log as a real line chart — the hero ValuePulse
 * sparkline moved here so the trend is opt-in (behind the Stats tap) instead
 * of a permanent hero fixture.
 *
 * Renders nothing until the log has two points — a fresh device has no trend
 * to show and gets no empty state.
 */
export function ValueTrend() {
  // "today" is captured with the load (not at render) so render stays pure.
  const [data, setData] = useState<{
    points: ValuePoint[];
    movers: MoverRecord | null;
    today: string;
  } | null>(null);
  // getValueHistory filters to the active display currency — reload on switch.
  const currency = useCurrency();

  useEffect(() => {
    let stale = false;
    Promise.all([getValueHistory(), getLatestMovers()])
      .then(([history, movers]) => {
        if (!stale) setData({ points: history, movers, today: dayKey(Date.now()) });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) — the section just stays hidden.
      });
    return () => {
      stale = true;
    };
  }, [currency]);

  const points = data?.points ?? [];
  const delta = computeValueDelta(points);
  if (!data || !delta) return null;

  // Movers are only "news" while fresh — an old record names its date, but a
  // stale one (device idle for days) is noise and stays hidden.
  const moversRecord =
    data.movers && data.movers.movers.length > 0 && daysBetween(data.movers.day, data.today) <= 2
      ? data.movers
      : null;

  const amount = Math.round(delta.amount);
  // "this week" only when the log actually covers a recent ~week; a gappy or
  // stale log names the baseline date instead of implying a weekly read.
  const isCurrent = daysBetween(delta.latestDay, data.today) <= 2;
  const period =
    isCurrent && delta.spanDays <= 8 ? 'this week' : `since ${formatDayKey(delta.baselineDay)}`;
  const text =
    amount === 0
      ? `Steady ${period}`
      : `${amount > 0 ? '+' : '−'}${formatMoney(Math.abs(amount), { wholeDollars: true })} ${period}`;
  const direction = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';
  const first = points[0];
  const latest = points[points.length - 1];

  return (
    <section className="breakdown-card value-trend" aria-label="Collection value over time">
      <h3 className="breakdown-title">Value</h3>
      <p className="value-trend-delta">
        <span className={`value-trend-delta-text value-trend-delta-text--${direction}`}>
          {text}
        </span>
        <span className="value-trend-delta-sub">
          One point per day, on this device (last 90 days)
        </span>
      </p>
      <p className="sr-only">
        Collection value went from {formatMoney(first.value, { wholeDollars: true })} on{' '}
        {formatDayKey(first.day)} to {formatMoney(latest.value, { wholeDollars: true })} on{' '}
        {formatDayKey(latest.day)}.
      </p>
      <TrendChart points={points} />
      {moversRecord && (
        <div className="value-movers">
          <h4 className="value-movers-head">
            {moversRecord.day === data.today
              ? "Today's movers"
              : `Movers · ${formatDayKey(moversRecord.day)}`}
          </h4>
          <ul className="value-movers-list">
            {moversRecord.movers.slice(0, 6).map((m) => {
              const moveAmount = m.after - m.before;
              const up = moveAmount > 0;
              return (
                <li key={`${m.scryfallId}:${m.finish}`} className="value-movers-row">
                  <span className="value-movers-card">
                    <span className="value-movers-name">{m.name}</span>
                    <span className="value-movers-meta">
                      {m.setCode.toUpperCase()}
                      {m.finish === 'foil' && ' · Foil'}
                      {m.finish === 'etched' && ' · Etched'}
                      {m.copies > 1 && ` · ×${m.copies}`}
                    </span>
                  </span>
                  <span className={`value-movers-delta value-movers-delta--${up ? 'up' : 'down'}`}>
                    <span aria-hidden="true">{up ? '▲' : '▼'}</span>
                    <span className="sr-only">{up ? 'up' : 'down'}</span>
                    {up ? '+' : '−'}
                    {formatMoney(Math.abs(moveAmount))}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="value-movers-sub">Per copy, vs the previous refresh on this device</p>
        </div>
      )}
    </section>
  );
}
