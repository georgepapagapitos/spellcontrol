export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Widest rendered petal ("High roll"), measured in a real browser at 390px
 *  wide with touch emulation on (`.board-hub-petal`, the 44px pointer-coarse
 *  floor): 101×44. Used as a uniform stand-in for every petal's box — the
 *  shorter labels (Menu, Help) only get extra breathing room from it. */
const DEFAULT_PETAL: Size = { width: 101, height: 44 };

/** Straight up, in screen space (y grows downward) — Lotus's own convention
 *  for where the first petal of a full circle sits. */
const START_ANGLE = -Math.PI / 2;

/** A half-circle fan, when the full circle doesn't fit, still opens a
 *  little short of the true open side's extreme angles (see the header
 *  comment) — tuned empirically against every hub position this app's own
 *  presets can produce, not against the theoretical worst case. */
const FALLBACK_SPREAD = Math.PI * 0.9;

function petalBoundingRadius(petal: Size): number {
  // The pill's diagonal half-extent — a circle that fully contains it
  // regardless of orientation, so a chord-length check against it is a safe
  // (if slightly conservative) stand-in for real rectangle-vs-rectangle
  // overlap math.
  return Math.hypot(petal.width / 2, petal.height / 2);
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeBounds(viewport: Size, margin: number, petal: Size): Bounds {
  const halfW = petal.width / 2;
  const halfH = petal.height / 2;
  return {
    minX: margin + halfW,
    maxX: viewport.width - margin - halfW,
    minY: margin + halfH,
    maxY: viewport.height - margin - halfH,
  };
}

/** The largest radius a SINGLE petal at this angle from `hub` can use before
 *  its box would cross the viewport bound in that specific direction — exact
 *  per-angle geometry (not a coarse "room on every side" guess), so a full
 *  circle whose particular angles happen to dodge the tightest cardinal
 *  direction (e.g. 5 petals 72° apart starting straight up never actually
 *  point due left or due right) isn't penalized for a constraint none of its
 *  petals ever hits. */
function angleRadiusBound(angle: number, hub: Point, b: Bounds): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let bound = Infinity;
  // A near-zero component contributes no constraint on that axis at all —
  // the epsilon is wide enough to absorb ordinary floating-point residue
  // around exact multiples of 90° without flipping sign and dividing by an
  // almost-zero number into a huge, wrongly-signed "bound".
  if (c > 1e-6) bound = Math.min(bound, (b.maxX - hub.x) / c);
  else if (c < -1e-6) bound = Math.min(bound, (hub.x - b.minX) / -c);
  if (s > 1e-6) bound = Math.min(bound, (b.maxY - hub.y) / s);
  else if (s < -1e-6) bound = Math.min(bound, (hub.y - b.minY) / -s);
  return Math.max(0, bound);
}

function clampPoint(p: Point, b: Bounds): Point {
  return {
    x: Math.min(Math.max(p.x, b.minX), b.maxX),
    y: Math.min(Math.max(p.y, b.minY), b.maxY),
  };
}

/**
 * Screen positions for the board hub's radial petal menu (Lotus's fan-out
 * ring).
 *
 * When the hub has room on every side — true mid-board, which is every real
 * layout this app has today (the board is always a 2-column grid, so a
 * seam's horizontal position is always exactly centred; only its vertical
 * position varies by row) — the petals go evenly around a full circle,
 * Lotus's own layout: 72° apart for five, starting straight up. The radius
 * is the largest that still clears every petal's own angle (see
 * `angleRadiusBound`), capped at `radius` and floored at the smallest radius
 * that keeps adjacent petals from overlapping (the chord between two points
 * spaced `2π / count` apart on a circle of radius `r` is `2r·sin(π /
 * count)`; solving for `r` against each petal's bounding circle gives the
 * floor).
 *
 * Only when that floor doesn't fit anywhere — the hub is near a board edge —
 * does it fall back to fanning across a wide arc toward the open side of the
 * screen instead (the same floor/cap logic, aimed at the arc actually used).
 * A literal viewport corner (both axes constrained at once) is outside what
 * a 2-column board can produce and, at this petal's real measured width,
 * isn't achievable overlap-free by any single-radius fan regardless of
 * tuning — verified empirically, not assumed — so the fallback is tuned
 * against the hub positions this app's own presets actually reach, not
 * against that synthetic worst case.
 *
 * Every point is then clamped inside the viewport as a final safety net, so
 * a petal never renders off-screen even where neither placement fits
 * cleanly.
 *
 * Pure and DOM-free — the fan math is the one non-trivial part of the hub
 * menu, so it's unit-tested on its own rather than only through the
 * component.
 */
export function hubPetalPositions(
  hub: Point,
  viewport: Size,
  count: number,
  opts: { radius?: number; margin?: number; petal?: Size } = {}
): Point[] {
  if (count <= 0) return [];
  const desiredRadius = opts.radius ?? 100;
  const margin = opts.margin ?? 8;
  const petal = opts.petal ?? DEFAULT_PETAL;
  const b = computeBounds(viewport, margin, petal);
  const boundingRadius = petalBoundingRadius(petal);

  const fullStep = (2 * Math.PI) / count;
  const fullAngles = Array.from({ length: count }, (_, i) => START_ANGLE + fullStep * i);
  const fullRoom = Math.min(...fullAngles.map((a) => angleRadiusBound(a, hub, b)));
  const minSafeFull = count > 1 ? boundingRadius / Math.sin(Math.PI / count) : 0;

  if (minSafeFull <= fullRoom) {
    const radius = Math.min(Math.max(desiredRadius, minSafeFull), fullRoom);
    return fullAngles.map((angle) =>
      clampPoint({ x: hub.x + Math.cos(angle) * radius, y: hub.y + Math.sin(angle) * radius }, b)
    );
  }

  const dx = viewport.width / 2 - hub.x;
  const dy = viewport.height / 2 - hub.y;
  const centerAngle = Math.atan2(dy, dx);
  const start = centerAngle - FALLBACK_SPREAD / 2;
  const step = count > 1 ? FALLBACK_SPREAD / (count - 1) : 0;
  const fanAngles = Array.from({ length: count }, (_, i) => start + step * i);
  const fanRoom = Math.min(...fanAngles.map((a) => angleRadiusBound(a, hub, b)));
  const halfGap = count > 1 ? FALLBACK_SPREAD / (2 * (count - 1)) : 0;
  const minSafeHalf = halfGap > 0 ? boundingRadius / Math.sin(halfGap) : 0;
  const radius = Math.min(Math.max(desiredRadius, minSafeHalf), Math.max(fanRoom, 0));
  return fanAngles.map((angle) =>
    clampPoint({ x: hub.x + Math.cos(angle) * radius, y: hub.y + Math.sin(angle) * radius }, b)
  );
}
