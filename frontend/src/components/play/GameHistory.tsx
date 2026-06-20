import { useEffect, useMemo, useState } from 'react';
import type { GameEvent, GameState } from '../../lib/game-state';
import { paletteForSeat } from '../../lib/seat-palette';

type Tab = 'timeline' | 'chart';

interface Props {
  game: GameState;
}

export function GameHistory({ game }: Props) {
  const [tab, setTab] = useState<Tab>('timeline');
  const total = game.events.length;

  return (
    <section className="game-history game-menu-section">
      <header className="game-history-header">
        <h3 className="game-history-title">History</h3>
        <span className="game-history-count">{total} events</span>
      </header>
      <div className="game-history-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'timeline'}
          className={`game-history-tab ${tab === 'timeline' ? 'is-active' : ''}`}
          onClick={() => setTab('timeline')}
        >
          Timeline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chart'}
          className={`game-history-tab ${tab === 'chart' ? 'is-active' : ''}`}
          onClick={() => setTab('chart')}
        >
          Life chart
        </button>
      </div>
      {tab === 'timeline' ? <Timeline game={game} /> : <LifeChart game={game} />}
    </section>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

/**
 * Consecutive same-target, same-kind delta events within this window collapse
 * into one row showing the net change and tap count. Underlying events are
 * left intact in the store — this is purely presentation.
 */
const GROUP_WINDOW_MS = 2000;
const GROUPABLE_KINDS: ReadonlySet<GameEvent['kind']> = new Set(['life', 'poison', 'cmd-dmg']);

interface TimelineRow {
  /** Stable key — id of the last event in the group. */
  key: string;
  kind: GameEvent['kind'];
  targetSeat: number | null;
  actorSeat: number | null;
  fromSeat?: number;
  /** Net delta for grouped delta events; original delta otherwise. */
  delta?: number;
  /** How many underlying events folded into this row (1 = single event). */
  count: number;
  /** Timestamp of the last event in the group. */
  ts: number;
  message?: string;
}

function groupEvents(events: readonly GameEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const ev of events) {
    const last = rows[rows.length - 1];
    if (
      last &&
      GROUPABLE_KINDS.has(ev.kind) &&
      last.kind === ev.kind &&
      last.targetSeat === ev.targetSeat &&
      last.actorSeat === ev.actorSeat &&
      last.fromSeat === ev.fromSeat &&
      typeof ev.delta === 'number' &&
      typeof last.delta === 'number' &&
      ev.ts - last.ts <= GROUP_WINDOW_MS
    ) {
      last.delta += ev.delta;
      last.count += 1;
      last.ts = ev.ts;
      last.key = ev.id;
      continue;
    }
    rows.push({
      key: ev.id,
      kind: ev.kind,
      targetSeat: ev.targetSeat,
      actorSeat: ev.actorSeat,
      fromSeat: ev.fromSeat,
      delta: ev.delta,
      count: 1,
      ts: ev.ts,
      message: ev.message,
    });
  }
  return rows;
}

function Timeline({ game }: { game: GameState }) {
  // Group across the last 200 raw events, then take the latest 80 grouped
  // rows for display. Grouping over a larger raw window keeps long bursts
  // intact even when they sit just past the display cutoff.
  const rows = useMemo(() => {
    const grouped = groupEvents(game.events.slice(-200));
    return grouped.slice(-80).reverse();
  }, [game.events]);
  // Re-render every 30s so relative timestamps stay fresh while the menu is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (rows.length === 0) {
    return <p className="game-history-empty">No events yet.</p>;
  }

  return (
    <ol className="game-history-timeline">
      {rows.map((row) => {
        const palette = row.targetSeat != null ? paletteForSeat(game.id, row.targetSeat) : null;
        const meta = describeRow(row, game);
        return (
          <li key={row.key} className={`timeline-row kind-${row.kind}`}>
            <span
              className="timeline-dot"
              style={
                palette
                  ? { background: palette.base, boxShadow: `0 0 0 2px ${palette.edge}33` }
                  : undefined
              }
              aria-hidden
            />
            <div className="timeline-body">
              <div className="timeline-line">
                {meta.target && <span className="timeline-name">{meta.target}</span>}
                <span className="timeline-action">{meta.action}</span>
                {meta.delta != null && (
                  <span
                    className={`timeline-delta ${meta.delta > 0 ? 'is-up' : meta.delta < 0 ? 'is-down' : ''}`}
                  >
                    {meta.delta > 0 ? '+' : ''}
                    {meta.delta}
                  </span>
                )}
                {meta.source && <span className="timeline-source">from {meta.source}</span>}
                {row.count > 1 && <span className="timeline-count">×{row.count}</span>}
              </div>
              <time className="timeline-time" dateTime={new Date(row.ts).toISOString()}>
                {formatRelative(row.ts, now)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface RichEvent {
  target?: string;
  action: string;
  delta?: number;
  source?: string;
}

function describeRow(row: TimelineRow, game: GameState): RichEvent {
  const seatName = (seat: number | null | undefined): string | undefined => {
    if (seat == null) return undefined;
    return game.players.find((p) => p.seat === seat)?.name ?? `seat ${seat}`;
  };
  switch (row.kind) {
    case 'life':
      return { target: seatName(row.targetSeat), action: 'life', delta: row.delta };
    case 'set-life':
      return { target: seatName(row.targetSeat), action: 'life set', delta: row.delta };
    case 'poison':
      return { target: seatName(row.targetSeat), action: 'poison', delta: row.delta };
    case 'cmd-dmg':
      return {
        target: seatName(row.targetSeat),
        action: 'cmd dmg',
        delta: row.delta,
        source: seatName(row.fromSeat),
      };
    case 'eliminate':
      return {
        target: seatName(row.targetSeat),
        action: row.message === 'auto' ? 'eliminated (auto)' : 'eliminated',
      };
    case 'revive':
      return { target: seatName(row.targetSeat), action: 'revived' };
    case 'start':
      return { action: 'Game started' };
    case 'end':
      return row.targetSeat != null
        ? { target: seatName(row.targetSeat), action: 'wins — game ended' }
        : { action: 'Game ended' };
    case 'reset':
      return { action: 'Game reset' };
    case 'join':
      return { action: `${row.message ?? seatName(row.targetSeat) ?? 'player'} joined` };
    case 'leave':
      return { action: `${row.message ?? seatName(row.targetSeat) ?? 'player'} left` };
    case 'note':
      return { action: row.message ?? 'note' };
    case 'settings':
      return { action: 'Settings changed' };
    default:
      return { action: row.kind };
  }
}

// Game event granularity: shows seconds. Injectable `now` for deterministic renders.
// Different from lib/format-time.ts:formatRelativeTime (minute granularity, no injectable now).
function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleString();
}

// ── Life chart ──────────────────────────────────────────────────────────────

/**
 * Reconstructs each player's life trajectory by replaying life-affecting
 * events in order. Returns one polyline per player.
 */
function LifeChart({ game }: { game: GameState }) {
  const data = useMemo(() => buildLifeSeries(game), [game]);

  if (data.series.length === 0 || data.totalPoints <= 1) {
    return <p className="game-history-empty">Not enough life changes yet to chart.</p>;
  }

  const width = 320;
  const height = 140;
  const padX = 8;
  const padY = 10;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xStep = data.totalPoints > 1 ? innerW / (data.totalPoints - 1) : 0;
  const yMin = Math.min(0, data.minLife);
  const yMax = Math.max(data.maxLife, game.startingLife);
  const ySpan = Math.max(1, yMax - yMin);
  const yFor = (life: number) => padY + innerH - ((life - yMin) / ySpan) * innerH;
  const xFor = (idx: number) => padX + idx * xStep;

  return (
    <div className="game-history-chart">
      <svg
        className="life-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Player life over time"
      >
        {/* Starting-life baseline */}
        <line
          x1={padX}
          x2={width - padX}
          y1={yFor(game.startingLife)}
          y2={yFor(game.startingLife)}
          className="life-chart-baseline"
        />
        {/* Zero baseline if it's in range */}
        {yMin <= 0 && (
          <line x1={padX} x2={width - padX} y1={yFor(0)} y2={yFor(0)} className="life-chart-zero" />
        )}
        {data.series.map((s) => {
          const palette = paletteForSeat(game.id, s.seat);
          const points = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
          return (
            <polyline
              key={s.seat}
              points={points}
              fill="none"
              stroke={palette.edge}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <ul className="life-chart-legend">
        {data.series.map((s) => {
          const player = game.players.find((p) => p.seat === s.seat);
          const palette = paletteForSeat(game.id, s.seat);
          const current = s.values[s.values.length - 1];
          return (
            <li key={s.seat} className="life-chart-legend-item">
              <span
                className="life-chart-swatch"
                style={{ background: palette.edge }}
                aria-hidden
              />
              <span className="life-chart-legend-name">{player?.name ?? `seat ${s.seat}`}</span>
              <span className="life-chart-legend-value">{current}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface LifeSeries {
  seat: number;
  values: number[];
}

interface LifeSeriesData {
  series: LifeSeries[];
  totalPoints: number;
  minLife: number;
  maxLife: number;
}

function buildLifeSeries(game: GameState): LifeSeriesData {
  const seats = game.players.map((p) => p.seat);
  // Initialize each seat at starting life.
  const life = new Map<number, number>();
  const values = new Map<number, number[]>();
  for (const seat of seats) {
    life.set(seat, game.startingLife);
    values.set(seat, [game.startingLife]);
  }

  // Walk events chronologically (events are appended in order).
  let touched = false;
  let min = game.startingLife;
  let max = game.startingLife;
  for (const ev of game.events) {
    let changed = false;
    if (ev.kind === 'life' && ev.targetSeat != null && typeof ev.delta === 'number') {
      const cur = life.get(ev.targetSeat);
      if (cur != null) {
        life.set(ev.targetSeat, cur + ev.delta);
        changed = true;
      }
    } else if (ev.kind === 'set-life' && ev.targetSeat != null && typeof ev.delta === 'number') {
      if (life.has(ev.targetSeat)) {
        life.set(ev.targetSeat, ev.delta);
        changed = true;
      }
    } else if (ev.kind === 'reset' || ev.kind === 'start') {
      // Reset all known seats to starting life.
      for (const seat of seats) life.set(seat, game.startingLife);
      changed = true;
    }

    if (changed) {
      touched = true;
      for (const seat of seats) {
        const v = life.get(seat) ?? game.startingLife;
        values.get(seat)!.push(v);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }

  const totalPoints = touched ? (values.get(seats[0])?.length ?? 1) : 1;
  return {
    series: seats.map((seat) => ({ seat, values: values.get(seat) ?? [game.startingLife] })),
    totalPoints,
    minLife: min,
    maxLife: max,
  };
}
