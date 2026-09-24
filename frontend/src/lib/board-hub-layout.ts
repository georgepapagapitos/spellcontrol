export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Screen positions for the board hub's radial petal menu (Lotus's fan-out
 * ring). Petals are spread across a half-circle centered on the direction
 * from the hub toward the middle of the screen, so a hub sitting near an
 * edge (the seam can land anywhere depending on layout/player count) opens
 * its ring toward the open side rather than off the nearest edge. Every
 * point is then clamped inside the viewport (minus a margin and half the
 * petal's own box) so a petal never renders off-screen, even at 320px wide.
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
  const radius = opts.radius ?? 100;
  const margin = opts.margin ?? 8;
  const petal = opts.petal ?? { width: 128, height: 48 };

  // Direction from the hub toward the viewport's centre. The `|| 0.0001`
  // guards atan2(0, 0), which is well-defined (0) but would make every board
  // whose hub sits exactly at centre fan out identically along one axis.
  const dx = viewport.width / 2 - hub.x || 0.0001;
  const dy = viewport.height / 2 - hub.y || 0.0001;
  const centerAngle = Math.atan2(dy, dx);
  const spread = Math.PI; // half circle
  const start = centerAngle - spread / 2;
  const step = count > 1 ? spread / (count - 1) : 0;

  const halfW = petal.width / 2;
  const halfH = petal.height / 2;
  const minX = margin + halfW;
  const maxX = Math.max(minX, viewport.width - margin - halfW);
  const minY = margin + halfH;
  const maxY = Math.max(minY, viewport.height - margin - halfH);

  return Array.from({ length: count }, (_, i) => {
    const angle = start + step * i;
    const x = Math.min(Math.max(hub.x + Math.cos(angle) * radius, minX), maxX);
    const y = Math.min(Math.max(hub.y + Math.sin(angle) * radius, minY), maxY);
    return { x, y };
  });
}
