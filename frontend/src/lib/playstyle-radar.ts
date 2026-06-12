/**
 * Pure geometry and axis-selection helpers for the PlaystyleRadar SVG component.
 *
 * Two exports:
 *   `selectRadarAxes` — picks the top axes by total, mirroring `buildSynergyAnalysis`'s
 *     MAX_AXES_SHOWN ordering so the radar and EnginePanel agree on which axes matter.
 *   `radarLayout`     — polar→cartesian geometry for N vertices with label anchors.
 *
 * Both are pure (no DOM, no network) so they land in the `src/lib/**` coverage gate.
 */

import type { AxisSummary, DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';

/** Maximum axes the radar shows — mirrors `buildSynergyAnalysis`'s MAX_AXES_SHOWN. */
export const RADAR_MAX_AXES = 6;

/**
 * Pick the top axes for the radar.
 * - Mirrors `buildSynergyAnalysis`'s `deck.axes.slice(0, MAX_AXES_SHOWN)` selection:
 *   axes are already sorted busiest-first by `analyzeDeckSynergy`, so a slice is all
 *   that's needed to agree with EnginePanel.
 * - Filters zero-total axes (an axis with 0 cards can't appear in the polygon).
 * - Returns at most `max` axes (default 6).
 *
 * The radar uses this selection; a fixture test asserts it produces the same top-N
 * as the engine's own ordering — so the two surfaces can never disagree on which
 * axes matter.
 */
export function selectRadarAxes(
  deckSynergy: DeckSynergy,
  max: number = RADAR_MAX_AXES
): AxisSummary[] {
  return deckSynergy.axes.filter((a) => a.total > 0).slice(0, max);
}

/** Per-vertex geometry: polygon vertex + label position + text anchor. */
export interface RadarVertex {
  /** Polygon vertex (SVG user units, origin at center). */
  x: number;
  y: number;
  /** Label anchor point — shifted outward from the vertex. */
  labelX: number;
  labelY: number;
  /** CSS text-anchor value — chosen so labels sit outside the polygon. */
  anchor: 'start' | 'middle' | 'end';
}

/** Full layout for one radar render. */
export interface RadarLayout {
  /** Per-vertex geometry, in the same order as the input `values` array. */
  vertices: RadarVertex[];
  /** SVG `points` attribute string for the value polygon. */
  polygonPoints: string;
  /**
   * Spoke endpoints: each spoke goes from the center (0,0) to `tip`.
   * Rendered as `<line x1="0" y1="0" x2={s.tip.x} y2={s.tip.y}>`.
   */
  spokes: Array<{ tip: { x: number; y: number } }>;
  /**
   * A single reference ring at 50% radius.
   * The caller may render additional rings; this library provides one.
   */
  referenceRadius: number;
  /** Radius of the fully-extended spoke (= half SVG size). */
  outerRadius: number;
}

/**
 * Compute polar→cartesian layout for an N-vertex radar.
 *
 * Contract:
 * - `values` must have N entries where 3 ≤ N ≤ 6. For N < 3 return null —
 *   a polygon needs at least 3 vertices; callers should render a fallback instead.
 * - `values` are pre-normalized to [0..1] (caller divides by max axis total).
 * - `size` is the total SVG canvas dimension (viewBox spans [-size/2..size/2] on
 *   each axis when the caller sets `viewBox="-{h} -{h} {size} {size}"` where h=size/2).
 * - **The canvas reserves a label band**: the polygon's outer radius is 30% of
 *   `size` and label points sit at 42% of `size` — both strictly inside the
 *   half-size canvas edge. This is what lets a caller position HTML label
 *   overlays by percentage of the square wrapper without them ever hanging
 *   outside it (the identity card clips at `overflow: hidden`).
 *
 * Vertex 0 is placed at the top (12 o'clock, angle = -π/2). Vertices proceed
 * clockwise, which is the natural screen-space reading order.
 *
 * Label anchors are chosen by quadrant for SVG-text consumers; HTML-overlay
 * consumers (the PlaystyleRadar component) center their boxes on the label
 * point instead, since an edge-anchored HTML box would extend outside the
 * wrapper:
 * - right half (cos > 0.15)  → 'start'  (label extends rightward)
 * - left half  (cos < -0.15) → 'end'    (label extends leftward)
 * - near-vertical (|cos| ≤ 0.15) → 'middle' (centered below/above)
 */
export function radarLayout(values: number[], size: number): RadarLayout | null {
  const n = values.length;
  if (n < 3) return null;

  // Polygon at 30% of size; labels at 42% — the canvas itself carries the
  // label band, so nothing positioned from these coords can leave the square.
  const outerRadius = size * 0.3;
  const referenceRadius = outerRadius * 0.5;
  const labelRadius = size * 0.42;

  const vertices: RadarVertex[] = [];
  const spokeTips: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < n; i++) {
    // Start at top (−π/2), proceed clockwise.
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const r = values[i] * outerRadius;
    const x = r * cos;
    const y = r * sin;

    const labelX = labelRadius * cos;
    const labelY = labelRadius * sin;

    // Anchor by quadrant
    let anchor: 'start' | 'middle' | 'end';
    if (cos > 0.15) {
      anchor = 'start';
    } else if (cos < -0.15) {
      anchor = 'end';
    } else {
      anchor = 'middle';
    }

    vertices.push({ x, y, labelX, labelY, anchor });
    spokeTips.push({ x: outerRadius * cos, y: outerRadius * sin });
  }

  const polygonPoints = vertices.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ');
  const spokes = spokeTips.map((tip) => ({ tip }));

  return { vertices, polygonPoints, spokes, referenceRadius, outerRadius };
}
