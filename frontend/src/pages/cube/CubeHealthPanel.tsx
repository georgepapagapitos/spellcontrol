import { useState, type JSX } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { MeterBar } from '../../components/shared/MeterBar';
import {
  computeCubeHealth,
  corpusWord,
  summarizeCubeHealth,
  type HealthRow,
} from '../../lib/cube/cube-health';
import type { GeneratedCube } from '../../lib/cube/generate';
// The mana-curve histogram reuses DeckCurvePhases' bar geometry (track/fill/
// count/target classes) rather than a second hand-rolled chart; the only
// addition is `.deck-curve-phases-bar-band` (see that stylesheet), the p25-p75
// range this panel needs and the deck chart doesn't.
import '../../components/deck/DeckCurvePhases.css';

/**
 * "Cube health": every measure the generator shapes toward (curve, card
 * types, roles, fixing) read back against the same corpus band, for the
 * cube actually on screen — not just the color balance shown above.
 *
 * Collapsed by default behind the same disclosure idiom as the Sample pack
 * section below it (a heading button with a chevron), so the always-visible
 * part is one summary line, not ~19 rows of chart pushing "The cards" down
 * the page. Open, each row states its count and the corpus range in words;
 * an out-of-range row also gets an icon + "Off target" label, never color
 * alone (the bar's success/warn fill is a supporting cue, not the only one).
 */
export function CubeHealthPanel({ cube }: { cube: GeneratedCube }): JSX.Element {
  const [open, setOpen] = useState(false);
  const health = computeCubeHealth(cube.picks, cube.size, cube.format ?? 'limited');
  const summary = summarizeCubeHealth(health);
  const corpus = corpusWord(cube.size, health.bandIsSizeSpecific);
  const summaryLine = summary.allOk
    ? 'This cube sits inside the range everywhere.'
    : `Off target: ${summary.offLabels.join(', ')}.`;

  return (
    <div className="cube-health">
      <h3 className="cube-health-head">
        <button
          type="button"
          className="cube-health-toggle"
          aria-expanded={open}
          aria-controls={open ? 'cube-health-body' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className="cube-group-chevron" width={14} height={14} aria-hidden />
          Cube health
        </button>
      </h3>
      <p className="cube-health-summary">{summaryLine}</p>
      {open && (
        <div id="cube-health-body" className="cube-health-body">
          <p className="cube-health-sub">
            How this {cube.size}-card cube&rsquo;s shape compares to {corpus} of its size.
          </p>
          <div className="cube-health-group cube-health-curve-group">
            <h4>Mana curve</h4>
            <CurveChart rows={health.curve} />
          </div>
          <HealthGroup title="Card types" rows={health.types} />
          <HealthGroup title="Roles" rows={health.roles} />
          <HealthGroup title="Fixing" rows={[health.fixingLands]} single />
        </div>
      )}
    </div>
  );
}

/** Nonland cards by mana value, 0..7+, as a column histogram: the same
 *  visual shape as the deck builder's curve chart (see DeckCurvePhases),
 *  in "count" mode, non-interactive (no drill-down — a summary panel, not
 *  a card list). One shared Y-scale across all 8 columns, so relative
 *  height reads as a curve. Each column also carries the corpus band as a
 *  shaded range and its median as a dashed line (DeckCurvePhases' existing
 *  target-dash class, reused unmodified). */
function CurveChart({ rows }: { rows: HealthRow[] }): JSX.Element {
  const max = Math.max(1, ...rows.flatMap((r) => [r.count, r.hi])) * 1.15;
  const pct = (v: number) => Math.min(100, (Math.max(0, v) / max) * 100);
  return (
    <>
      <ul
        className="deck-curve-phases-bars"
        data-mode="count"
        aria-label="Nonland cards by mana value"
      >
        {rows.map((row) => {
          const offTarget = row.status !== 'ok';
          const label = row.key === '7' ? '7+' : row.key;
          return (
            <li key={row.key} className="deck-curve-phases-bar-col">
              <div className="deck-curve-phases-bar-track">
                <span className="deck-curve-phases-bar-count">{row.count}</span>
                <div
                  className="deck-curve-phases-bar-band"
                  style={{ bottom: `${pct(row.lo)}%`, height: `${pct(row.hi) - pct(row.lo)}%` }}
                  aria-hidden="true"
                />
                <div
                  className="deck-curve-phases-bar-target"
                  style={{ bottom: `${pct(row.median)}%` }}
                  aria-hidden="true"
                />
                <div
                  className="deck-curve-phases-bar-fill"
                  style={{ height: `${pct(row.count)}%` }}
                />
              </div>
              <span className="deck-curve-phases-bar-label">
                <span aria-hidden="true">
                  {label}
                  {offTarget && (
                    <AlertTriangle className="cube-health-curve-flag" width={9} height={9} />
                  )}
                </span>
                <span className="sr-only">
                  Mana value {label}: {row.count} cards, typical {row.lo} to {row.hi}
                  {offTarget ? ', off target' : ''}.
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="cube-health-curve-caption">Dashed line: median. Shaded band: typical range.</p>
    </>
  );
}

function HealthGroup({
  title,
  rows,
  single = false,
}: {
  title: string;
  rows: HealthRow[];
  /** A single-row group (fixing lands) skips the multi-column grid. */
  single?: boolean;
}): JSX.Element {
  return (
    <div className="cube-health-group">
      <h4>{title}</h4>
      <ul className={single ? 'cube-health-rows cube-health-rows--single' : 'cube-health-rows'}>
        {rows.map((row) => (
          <HealthRowItem key={row.key} row={row} />
        ))}
      </ul>
    </div>
  );
}

function HealthRowItem({ row }: { row: HealthRow }): JSX.Element {
  const offTarget = row.status !== 'ok';
  const max = Math.max(row.count, row.hi, 1) * 1.2;
  return (
    <li className={`cube-health-row is-${row.status}`}>
      <span className="cube-health-row-label">{row.label}</span>
      <MeterBar
        value={row.count}
        max={max}
        tick={row.median}
        color={offTarget ? 'var(--warn-border)' : 'var(--success)'}
      />
      <p className="cube-health-row-caption">
        {row.count} · typical {row.lo}–{row.hi}
        {offTarget && (
          <span className="cube-health-row-flag">
            <AlertTriangle width={11} height={11} aria-hidden /> Off target
          </span>
        )}
      </p>
    </li>
  );
}
