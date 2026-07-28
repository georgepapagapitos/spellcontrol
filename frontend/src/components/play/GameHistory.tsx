import { useEffect, useMemo, useState } from 'react';
import type { GameEvent, GameState, GameSummary } from '../../lib/game-state';
import { isKeyMoment, summarizeGame } from '../../lib/game-state';
import { describeGameEvent } from '../../lib/game-event-text';
import { paletteForSeat } from '../../lib/seat-palette';

interface Props {
  game: GameState;
}

/**
 * The game menu's "Game" tab: what happened, ordered by how often anyone
 * actually asks. Derived stats first (they answer "who's winning / who hit
 * me" at a glance), then the life chart, then the log — which defaults to key
 * moments, because a real game's raw log is overwhelmingly ±1 taps.
 */
export function GameHistory({ game }: Props) {
  // One walk of the log feeds every stat; the log below does its own grouping
  // pass for display. Recomputes only when the game object changes.
  const summary = useMemo(() => summarizeGame(game), [game]);
  return (
    <>
      <GameStats game={game} summary={summary} />
      <section className="game-menu-section">
        <h3 className="game-history-title">Life over time</h3>
        <LifeChart game={game} />
      </section>
      <GameLog game={game} />
    </>
  );
}

// ── Derived stats ───────────────────────────────────────────────────────────

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}

/** Whole minutes once past a minute, else seconds. Table-side glanceability —
 *  the shared formatRelativeTime is for wall-clock ages, not elapsed spans. */
function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return `${Math.floor(ms / 1000)}s`;
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function GameStats({ game, summary }: { game: GameState; summary: GameSummary }) {
  const seatName = (seat: number): string =>
    game.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;

  // Winner-first once every seat has a placement; seat order while the game is
  // live, so rows don't reshuffle under the reader mid-game.
  const rows = useMemo(() => {
    if (summary.seats.some((s) => s.placement == null)) return summary.seats;
    return [...summary.seats].sort((a, b) => a.placement! - b.placement!);
  }, [summary.seats]);

  const started = summary.turns > 0 || summary.seats.some((s) => s.damageTaken > 0);

  return (
    <section className="game-menu-section game-stats">
      <header className="game-history-header">
        <h3 className="game-history-title">This game</h3>
        {summary.durationMs > 0 && (
          <span className="game-history-count">{formatDuration(summary.durationMs)}</span>
        )}
      </header>

      {!started ? (
        <p className="game-history-empty">Stats appear once life totals start moving.</p>
      ) : (
        <>
          <div className="game-stats-chips">
            {summary.turns > 0 && <span className="game-menu-chip">Turn {summary.turns}</span>}
            {summary.firstBlood && (
              <span className="game-menu-chip">
                First blood: {seatName(summary.firstBlood.seat)}
                {summary.firstBlood.bySeat != null && ` — ${seatName(summary.firstBlood.bySeat)}`}
                {summary.firstBlood.turn != null && `, turn ${summary.firstBlood.turn}`}
              </span>
            )}
          </div>

          <ul className="game-stats-rows">
            {rows.map((s) => {
              const palette = paletteForSeat(game.id, s.seat);
              return (
                <li key={s.seat} className="game-stats-row">
                  <span
                    className="game-stats-dot"
                    style={{ background: palette.base, boxShadow: `0 0 0 2px ${palette.edge}33` }}
                    aria-hidden
                  />
                  <span className="game-stats-name">{seatName(s.seat)}</span>
                  {s.placement != null && (
                    <span className={`game-stats-place${s.placement === 1 ? ' is-winner' : ''}`}>
                      {ordinal(s.placement)}
                    </span>
                  )}
                  <span className="game-stats-facts">
                    <span>
                      <b>{s.damageTaken}</b> taken
                    </span>
                    <span>
                      <b>{s.biggestHit}</b> biggest hit
                    </span>
                    <span>
                      low <b>{s.lowestLife}</b>
                    </span>
                    {s.killedBySeat != null && (
                      <span className="game-stats-ko">
                        KO by <b>{seatName(s.killedBySeat)}</b>
                        {s.eliminatedOnTurn != null && ` · turn ${s.eliminatedOnTurn}`}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {summary.commanderDamage.length > 0 && (
            <>
              <h4 className="game-stats-subtitle">Commander damage</h4>
              <ul className="game-stats-cmd">
                {summary.commanderDamage.map((e) => (
                  <li key={`${e.fromSeat}>${e.toSeat}`}>
                    <span>
                      {seatName(e.fromSeat)} → {seatName(e.toSeat)}
                    </span>
                    <b>{e.amount}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
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

function GameLog({ game }: { game: GameState }) {
  const [showAll, setShowAll] = useState(false);
  // Group across the last 200 raw events; grouping over a larger raw window
  // keeps long bursts intact even when they sit just past the display cutoff.
  const { all, key } = useMemo(() => {
    const grouped = groupEvents(game.events.slice(-200));
    return { all: grouped, key: grouped.filter(isKeyMoment) };
  }, [game.events]);
  const rows = showAll ? all : key;

  return (
    <section className="game-history game-menu-section">
      <header className="game-history-header">
        <h3 className="game-history-title">{showAll ? 'Full log' : 'Key moments'}</h3>
        <span className="game-history-count">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="game-history-empty">
          {all.length === 0 ? 'No events yet.' : 'Nothing notable yet — just life changes so far.'}
        </p>
      ) : (
        <Timeline game={game} rows={rows} />
      )}
      {all.length > key.length && (
        <button
          type="button"
          className="game-history-toggle"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show key moments only' : `Show all ${all.length} events`}
        </button>
      )}
    </section>
  );
}

function Timeline({ game, rows: allRows }: { game: GameState; rows: TimelineRow[] }) {
  // Newest first, capped so a long game can't render hundreds of nodes.
  const rows = useMemo(() => allRows.slice(-80).reverse(), [allRows]);
  // Re-render every 30s so relative timestamps stay fresh while the menu is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const seatName = (seat: number | null | undefined): string | undefined => {
    if (seat == null) return undefined;
    return game.players.find((p) => p.seat === seat)?.name ?? `seat ${seat}`;
  };
  const describeRow = (row: TimelineRow) => describeGameEvent(row, seatName);

  return (
    <ol className="game-history-timeline">
      {rows.map((row) => {
        const palette = row.targetSeat != null ? paletteForSeat(game.id, row.targetSeat) : null;
        const meta = describeRow(row);
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
