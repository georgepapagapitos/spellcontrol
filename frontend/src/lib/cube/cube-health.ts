// "Cube health": the cube actually on screen, measured against the same
// corpus targets the generator itself shapes toward (see ./targets and
// ./objective). Pure and deterministic so the UI panel can stay a thin
// renderer — every count/range/flag is computed here, once.

import type { Pick } from './generate';
import { isLand, bucketOf, curveSlotOf } from './core';
import { typeOf } from './objective';
import { targetsForSize, type CubeSize, type CurveSlot, type Role, type Stat } from './targets';
import type { CubeFormat } from './play-format';

const CURVE_SLOTS: CurveSlot[] = ['0', '1', '2', '3', '4', '5', '6', '7'];
const TYPE_SLOTS = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
] as const;
const ROLE_SLOTS: Role[] = ['removal', 'boardwipe', 'ramp', 'cardDraw'];

export const TYPE_LABEL: Record<(typeof TYPE_SLOTS)[number], string> = {
  creature: 'Creatures',
  instant: 'Instants',
  sorcery: 'Sorceries',
  artifact: 'Artifacts',
  enchantment: 'Enchantments',
  planeswalker: 'Planeswalkers',
};

export const ROLE_LABEL: Record<Role, string> = {
  removal: 'Removal',
  boardwipe: 'Board wipes',
  ramp: 'Ramp',
  cardDraw: 'Card draw',
};

export type HealthStatus = 'ok' | 'low' | 'high';

/** One measured row: a count against the corpus's p25–p75 range for it. */
export interface HealthRow {
  key: string;
  label: string;
  count: number;
  lo: number;
  hi: number;
  median: number;
  status: HealthStatus;
}

export interface CubeHealth {
  /** True when the band was mined for this exact size (360/450/540/720,
   *  limited format) — false when it's a reused/scaled band (180/270, or any
   *  Commander cube), so the UI can say "real cubes" instead of "real Ns". */
  bandIsSizeSpecific: boolean;
  curve: HealthRow[];
  types: HealthRow[];
  roles: HealthRow[];
  fixingLands: HealthRow;
}

const MINED_SIZES = new Set([360, 450, 540, 720]);

function statusOf(count: number, lo: number, hi: number): HealthStatus {
  if (count < lo) return 'low';
  if (count > hi) return 'high';
  return 'ok';
}

/** A share `Stat` (0..1) plus a basis count, turned into a rounded-count row. */
function shareRow(key: string, label: string, count: number, stat: Stat, basis: number): HealthRow {
  const lo = Math.round(stat.p25 * basis);
  const hi = Math.round(stat.p75 * basis);
  const median = Math.round(stat.median * basis);
  return { key, label, count, lo, hi, median, status: statusOf(count, lo, hi) };
}

/** An absolute-count `Stat` (fixingLands, already scaled by size) turned into a row. */
function absoluteRow(key: string, label: string, count: number, stat: Stat): HealthRow {
  const lo = Math.round(stat.p25);
  const hi = Math.round(stat.p75);
  const median = Math.round(stat.median);
  return { key, label, count, lo, hi, median, status: statusOf(count, lo, hi) };
}

export function computeCubeHealth(
  picks: Pick[],
  size: CubeSize,
  format: CubeFormat = 'limited'
): CubeHealth {
  const band = targetsForSize(size, format);
  const cards = picks.map((p) => p.card);
  const nonland = cards.filter((c) => !isLand(c));
  const nlCount = Math.max(1, nonland.length);
  const totalCount = Math.max(1, cards.length);

  const curve = CURVE_SLOTS.map((slot) => {
    const count = nonland.filter((c) => curveSlotOf(c.cmc) === slot).length;
    const label = slot === '7' ? '7+ CMC' : `${slot} CMC`;
    return shareRow(slot, label, count, band.curve[slot], nlCount);
  });

  const types = TYPE_SLOTS.map((type) => {
    const count = cards.filter((c) => typeOf(c) === type).length;
    return shareRow(type, TYPE_LABEL[type], count, band.type[type], totalCount);
  });

  const roles = ROLE_SLOTS.map((role) => {
    const count = nonland.filter((c) => c.role === role).length;
    return shareRow(role, ROLE_LABEL[role], count, band.role[role], nlCount);
  });

  const landCount = cards.filter((c) => bucketOf(c) === 'land').length;
  const fixingLands = absoluteRow('fixingLands', 'Fixing lands', landCount, band.fixingLands);

  return {
    bandIsSizeSpecific: format !== 'commander' && MINED_SIZES.has(size),
    curve,
    types,
    roles,
    fixingLands,
  };
}

/** "real 360s" when the band was mined for this exact size, else "real cubes". */
export function corpusWord(size: CubeSize, bandIsSizeSpecific: boolean): string {
  return bandIsSizeSpecific ? `real ${size}s` : 'real cubes';
}

/** The always-visible one-line verdict: everything in range, or which
 *  measures aren't, named the way a cube builder would say them ("1-drops",
 *  not "1 CMC"). */
export interface CubeHealthSummary {
  allOk: boolean;
  /** Off-target measures, curve first then types/roles/fixing, in display order. */
  offLabels: string[];
}

/** "1-drops" / "7-drops" — the informal count-of-cards-at-this-cost term,
 *  distinct from a row's own "1 CMC" / "7+ CMC" label. */
function curveSummaryLabel(slot: string): string {
  return `${slot}-drops`;
}

export function summarizeCubeHealth(health: CubeHealth): CubeHealthSummary {
  const offLabels: string[] = [];
  for (const row of health.curve)
    if (row.status !== 'ok') offLabels.push(curveSummaryLabel(row.key));
  for (const row of health.types) if (row.status !== 'ok') offLabels.push(row.label.toLowerCase());
  for (const row of health.roles) if (row.status !== 'ok') offLabels.push(row.label.toLowerCase());
  if (health.fixingLands.status !== 'ok') offLabels.push(health.fixingLands.label.toLowerCase());
  return { allOk: offLabels.length === 0, offLabels };
}
