import { useEffect, useState } from 'react';
import { formatMoney } from '../lib/format-money';
import {
  computeValueDelta,
  dayKey,
  daysBetween,
  getValueHistory,
  type ValuePoint,
} from '../lib/value-history';
import './ValuePulse.css';

const SPARK_W = 72;
const SPARK_H = 20;
const PAD = 2.5;

function sparkGeometry(points: ValuePoint[]): { line: string; endX: number; endY: number } {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const coords = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (SPARK_W - PAD * 2);
    // Flat history centers the line rather than dividing by zero.
    const norm = range === 0 ? 0.5 : (v - min) / range;
    const y = SPARK_H - PAD - norm * (SPARK_H - PAD * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const last = coords[coords.length - 1];
  return { line: coords.map(([x, y]) => `${x},${y}`).join(' '), endX: last[0], endY: last[1] };
}

function formatDayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(y, m - 1, d)
  );
}

/**
 * Collection value pulse (E76): a small sparkline of the device-local daily
 * value log plus a delta line ("+$18 this week") for the collection hero.
 *
 * Renders nothing until the log has two points — a fresh device has no trend
 * to show and gets no empty state. `refreshing` is the store's
 * isRefreshingPrices flag; the history is re-read when a refresh completes so
 * the point it just snapshotted appears without a reload.
 */
export function ValuePulse({ refreshing }: { refreshing: boolean }) {
  // "today" is captured with the load (not at render) so render stays pure.
  const [data, setData] = useState<{ points: ValuePoint[]; today: string } | null>(null);

  useEffect(() => {
    if (refreshing) return;
    let stale = false;
    getValueHistory()
      .then((history) => {
        if (!stale) setData({ points: history, today: dayKey(Date.now()) });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) — the pulse just stays hidden.
      });
    return () => {
      stale = true;
    };
  }, [refreshing]);

  const points = data?.points ?? [];
  const delta = computeValueDelta(points);
  if (!data || !delta) return null;

  const amount = Math.round(delta.amount);
  // "this week" only when the log actually covers a recent ~week; a gappy or
  // stale log names the baseline date instead of implying a weekly read.
  const isCurrent = daysBetween(delta.latestDay, data.today) <= 2;
  const period =
    isCurrent && delta.spanDays <= 8 ? 'this week' : `since ${formatDayShort(delta.baselineDay)}`;
  const text =
    amount === 0
      ? `Steady ${period}`
      : `${amount > 0 ? '+' : '−'}${formatMoney(Math.abs(amount), { wholeDollars: true })} ${period}`;
  const direction = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';

  const { line, endX, endY } = sparkGeometry(points);

  return (
    <p className="value-pulse" title="Collection value trend, one point per day (last 90 days)">
      <svg
        className="value-pulse-spark"
        width={SPARK_W}
        height={SPARK_H}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        aria-hidden="true"
      >
        <polyline
          className="value-pulse-spark-line"
          points={line}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="value-pulse-spark-dot" cx={endX} cy={endY} r={2.5} />
      </svg>
      <span className="sr-only">Collection value trend: </span>
      <span className={`value-pulse-delta value-pulse-delta--${direction}`}>{text}</span>
    </p>
  );
}
