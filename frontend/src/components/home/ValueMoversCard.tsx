import './ValueMoversCard.css';
import { useEffect, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useCurrency } from '../../lib/currency';
import { formatMoney } from '../../lib/format-money';
import { useCardThumb } from '../../lib/card-thumbs';
import {
  computeValueDelta,
  dayKey,
  daysBetween,
  formatDayKey,
  formatValueDeltaChip,
  getLatestMovers,
  getValueHistory,
  type MoverRecord,
  type ValuePoint,
} from '../../lib/value-history';
import { HomeCard } from './HomeCard';

const DISPLAY_LIMIT = 4;
/** A movers record older than this reads as stale, not "news" — mirrors ValueTrend's own gate. */
const FRESHNESS_DAYS = 2;
const SPARKLINE_HEIGHT = 44;
const SPARKLINE_PAD = 4;

interface MoversData {
  points: ValuePoint[];
  movers: MoverRecord | null;
  /** Day key captured when the read resolved — mirrors ValueTrend.tsx's own
   *  `today`, computed inside the async callback rather than the render body
   *  (react-hooks/purity forbids calling Date.now() while rendering). */
  today: string;
}

function MoverThumb({ name }: { name: string }) {
  const art = useCardThumb(name, 'normal');
  return (
    <span className="home-thumb card-thumb-tilt" aria-hidden="true">
      {art ? <img src={art} alt="" loading="lazy" /> : <span className="home-thumb-skeleton" />}
    </span>
  );
}

/**
 * Headline value sparkline: the device-local daily value log as a decorative
 * area chart with a hover/keyboard crosshair readout — no gridlines, ticks, or
 * legend (a single series names itself via the card title), per the
 * STYLE_GUIDE "Money deltas & value sparklines" ruling. This is deliberately
 * NOT the full plotted § Charts treatment `ValueTrend.tsx` already owns for
 * the Breakdown drawer — smaller, chrome-free, a headline not a reading tool.
 */
function ValueSparkline({ points }: { points: ValuePoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // clientWidth is 0 in test DOMs — fall back to a nominal width so the
    // sparkline still renders (mirrors ValueTrend.tsx's own TrendChart).
    const measure = () => setWidth(el.clientWidth || 240);
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
  const baseline = SPARKLINE_HEIGHT - SPARKLINE_PAD;

  const xs = points.map(
    (p) =>
      SPARKLINE_PAD + (daysBetween(points[0].day, p.day) / spanDays) * (width - SPARKLINE_PAD * 2)
  );
  const ys = values.map((v) => {
    const norm = range === 0 ? 0.5 : (v - min) / range;
    return baseline - norm * (baseline - SPARKLINE_PAD);
  });
  const line = points.map((_, i) => `${xs[i]},${ys[i]}`).join(' ');
  const area = `${SPARKLINE_PAD},${baseline} ${line} ${xs[last]},${baseline}`;

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
    <div
      ref={wrapRef}
      className="home-value-sparkline"
      role="group"
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={SPARKLINE_HEIGHT}
          viewBox={`0 0 ${width} ${SPARKLINE_HEIGHT}`}
          aria-hidden="true"
          // Pointer hit area is the full strip, not just the line itself.
          onPointerMove={(e) => setActive(nearestIdx(e.clientX))}
          onPointerDown={(e) => setActive(nearestIdx(e.clientX))}
          onPointerLeave={() => setActive(null)}
        >
          <line
            className="home-value-sparkline-baseline"
            x1={SPARKLINE_PAD}
            x2={width - SPARKLINE_PAD}
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
              y1={SPARKLINE_PAD}
              y2={baseline}
            />
          )}
          <circle
            className="home-value-sparkline-dot"
            cx={active !== null ? xs[active] : xs[last]}
            cy={active !== null ? ys[active] : ys[last]}
            r={3.5}
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
          <span className="home-value-sparkline-tooltip-day">{formatDayKey(activePoint.day)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Home's value-movers summary — the top price movers from the latest local
 * price refresh, headlined by the device-local value sparkline. Mount-time
 * `Promise.all` read of the same device-local IndexedDB log ValueTrend.tsx
 * already reads; this surfaces a smaller slice of the same signal, never a
 * re-capture.
 */
export function ValueMoversCard() {
  const [data, setData] = useState<MoversData | undefined>(undefined);
  // getLatestMovers/getValueHistory filter to the active display currency —
  // reload on switch.
  const currency = useCurrency();

  useEffect(() => {
    let stale = false;
    Promise.all([getValueHistory(), getLatestMovers()])
      .then(([points, latest]) => {
        if (!stale) setData({ points, movers: latest, today: dayKey(Date.now()) });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) — reads as "nothing yet".
        if (!stale) setData({ points: [], movers: null, today: dayKey(Date.now()) });
      });
    return () => {
      stale = true;
    };
  }, [currency]);

  const movers = data?.movers;
  const fresh =
    !!data &&
    movers != null &&
    movers.movers.length > 0 &&
    daysBetween(movers.day, data.today) <= FRESHNESS_DAYS;

  const points = data?.points ?? [];
  const delta = computeValueDelta(points);
  // Fewer than 2 snapshot points → skip the sparkline block entirely; the
  // mover rows below still render on their own (STYLE_GUIDE "no trend, no
  // chart" — never an empty-state chart).
  const showSparkline = points.length >= 2 && delta !== null;

  // formatValueDeltaChip is shared with the Home hero's own value chip (see
  // its doc comment) so the two never drift out of sync — `data?.today`
  // defaults to '' when still loading, which is safe: delta is only
  // non-null once `data` has resolved, so formatValueDeltaChip's null-delta
  // branch (which never reads `today`) is what actually fires until then.
  const heroChip = formatValueDeltaChip(delta, data?.today ?? '', FRESHNESS_DAYS);
  const heroDeltaText = showSparkline ? heroChip.text : '';
  const heroDirection = heroChip.direction;

  return (
    <HomeCard
      title="Value movers"
      icon={TrendingUp}
      loading={data === undefined}
      empty={!fresh}
      emptyText="Price history builds after your next refresh."
      viewAllHref="/collection"
      viewAllLabel="View trend"
    >
      {fresh && movers && (
        <>
          {showSparkline && (
            <div className="home-value-hero">
              <div className="home-value-hero-figures">
                <span className="home-value-hero-amount">
                  {formatMoney(points[points.length - 1].value, { wholeDollars: true })}
                </span>
                <span className={`home-value-hero-delta home-value-hero-delta--${heroDirection}`}>
                  {heroDeltaText}
                </span>
              </div>
              <ValueSparkline points={points} />
            </div>
          )}
          <ul className="home-movers-list">
            {movers.movers.slice(0, DISPLAY_LIMIT).map((m) => {
              const moveAmount = m.after - m.before;
              const up = moveAmount > 0;
              const pct = m.before !== 0 ? Math.round((moveAmount / m.before) * 100) : null;
              return (
                <li key={`${m.scryfallId}:${m.finish}`} className="home-movers-row">
                  <MoverThumb name={m.name} />
                  <span className="home-movers-info">
                    <span className="home-movers-name">{m.name}</span>
                    <span className="home-movers-price">{formatMoney(m.after)}</span>
                  </span>
                  <span className={`home-movers-delta home-movers-delta--${up ? 'up' : 'down'}`}>
                    <span aria-hidden="true">{up ? '▲' : '▼'}</span>
                    <span className="sr-only">{up ? 'up' : 'down'}</span>
                    <span className="home-movers-delta-amount">
                      {up ? '+' : '−'}
                      {formatMoney(Math.abs(moveAmount))}
                    </span>
                    {pct !== null && (
                      <span className="home-movers-delta-pct">
                        ({up ? '+' : '−'}
                        {Math.abs(pct)}%)
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </HomeCard>
  );
}
