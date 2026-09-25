import type { JSX } from 'react';
import { AlertTriangle } from 'lucide-react';
import { MeterBar } from '../../components/shared/MeterBar';
import { computeCubeHealth, corpusWord, type HealthRow } from '../../lib/cube/cube-health';
import type { GeneratedCube } from '../../lib/cube/generate';

/**
 * "Cube health": every measure the generator shapes toward (curve, card
 * types, roles, fixing) read back against the same corpus band, for the
 * cube actually on screen — not just the color balance shown above. Each
 * row states its count and the corpus range in words; an out-of-range row
 * also gets an icon + "Off target" label, never color alone (the bar's
 * success/warn fill is a supporting cue, not the only one).
 */
export function CubeHealthPanel({ cube }: { cube: GeneratedCube }): JSX.Element {
  const health = computeCubeHealth(cube.picks, cube.size, cube.format ?? 'limited');
  const corpus = corpusWord(cube.size, health.bandIsSizeSpecific);

  return (
    <div className="cube-health">
      <h3>Cube health</h3>
      <p className="cube-health-sub">
        How this {cube.size}-card cube&rsquo;s shape compares to {corpus} of its size.
      </p>
      <HealthGroup title="Mana curve" rows={health.curve} corpus={corpus} />
      <HealthGroup title="Card types" rows={health.types} corpus={corpus} />
      <HealthGroup title="Roles" rows={health.roles} corpus={corpus} />
      <HealthGroup title="Fixing" rows={[health.fixingLands]} corpus={corpus} single />
    </div>
  );
}

function HealthGroup({
  title,
  rows,
  corpus,
  single = false,
}: {
  title: string;
  rows: HealthRow[];
  corpus: string;
  /** A single-row group (fixing lands) skips the multi-column grid. */
  single?: boolean;
}): JSX.Element {
  return (
    <div className="cube-health-group">
      <h4>{title}</h4>
      <ul className={single ? 'cube-health-rows cube-health-rows--single' : 'cube-health-rows'}>
        {rows.map((row) => (
          <HealthRowItem key={row.key} row={row} corpus={corpus} />
        ))}
      </ul>
    </div>
  );
}

function HealthRowItem({ row, corpus }: { row: HealthRow; corpus: string }): JSX.Element {
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
        {row.count} · {corpus} run {row.lo}–{row.hi}
        {offTarget && (
          <span className="cube-health-row-flag">
            <AlertTriangle width={11} height={11} aria-hidden /> Off target
          </span>
        )}
      </p>
    </li>
  );
}
