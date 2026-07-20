import { useMemo } from 'react';
import { create } from 'qrcode';

interface Props {
  /** The URL (or arbitrary text) to encode as a QR code. */
  value: string;
  /**
   * Accessible name for the rendered QR image — describe what it opens,
   * don't repeat the full URL (already separately reachable via an
   * adjacent share-URL input/link).
   */
  label: string;
}

/** Quiet-zone width in modules around the data area — needed for reliable
 * real-world scanning. */
const QUIET_ZONE = 4;

/** Rendered box size in CSS px. Fixed rather than derived from module count
 * so the code clears the 200px floor at every breakpoint; the SVG scales to
 * this via viewBox, independent of how many modules the data needs. */
const DISPLAY_SIZE = 208;

/**
 * Renders a scannable QR code as a single inline SVG `<path>`, built from
 * `qrcode`'s synchronous, dependency-free `create()`. Deliberately avoids
 * `dangerouslySetInnerHTML` (no precedent anywhere in this codebase) and a
 * `<canvas>` element (DPI/blur risk at small sizes) — one `<path>` covering
 * every dark module is the standard efficient technique for a DOM-rendered
 * QR code (vs. one `<rect>` per module).
 *
 * Always renders black-on-white regardless of app theme: a QR is scanned by
 * a camera in the real world, so inverting the modules for dark mode would
 * tank real-world scan contrast. The card chrome around it (border/shadow/
 * radius — see `.share-qr-card`) still themes normally; only the QR itself
 * is a fixed, documented exception.
 */
export function ShareQrCode({ value, label }: Props) {
  const qr = useMemo(() => {
    try {
      const { modules } = create(value, { errorCorrectionLevel: 'M' });
      const size = modules.size;
      let d = '';
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (modules.get(row, col)) {
            d += `M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`;
          }
        }
      }
      return { d, dimension: size + QUIET_ZONE * 2 };
    } catch {
      // create() throws when the data exceeds the chosen error-correction
      // level's capacity — degrade to a text fallback instead of an
      // unhandled render crash.
      return null;
    }
  }, [value]);

  if (!qr) {
    return <p className="choice-dialog-body">QR code unavailable — use the link above.</p>;
  }

  return (
    <div className="share-qr-card" role="img" aria-label={label}>
      <svg
        viewBox={`0 0 ${qr.dimension} ${qr.dimension}`}
        width={DISPLAY_SIZE}
        height={DISPLAY_SIZE}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect width={qr.dimension} height={qr.dimension} fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
    </div>
  );
}
