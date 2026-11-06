import './ProxySegment.css';

/**
 * "Proxy" as a segment of an on-art plate: the first thing the grid tile's
 * plate says about a proxy stack (CopyPlaces), or the plate's only segment
 * on a tile with no plate of its own (CardGridCell's corner). Warn-toned and
 * spelled out, so it never rests on color alone. Decorative: the tile's own
 * label already says "proxy".
 */
export function ProxySegment() {
  return (
    <span className="art-proxy" aria-hidden>
      Proxy
    </span>
  );
}
