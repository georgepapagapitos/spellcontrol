/**
 * BrandMark — the SpellControl card + S monogram.
 *
 * A tilted Magic-proportioned card whose "art" is the brand S, drawn as two
 * arcs in the fixed amber→coral gradient. Inline SVG so it renders crisply at
 * any size with no asset load, and the card face/edge follow the active theme
 * (surface-raised / border-strong) so the glyph works on light and dark alike.
 *
 * Usage:
 *   <BrandMark size={28} aria-hidden />          // in a header (label on parent)
 *   <BrandMark size={48} className="auth-mark" /> // hero moment
 */

interface Props {
  size?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export function BrandMark({ size = 28, className, 'aria-hidden': ariaHidden }: Props) {
  const id = 'bm-spark';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden={ariaHidden}
      focusable="false"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#fcd34d" />
          <stop offset="0.55" stopColor="#fb923c" />
          <stop offset="1" stopColor="#fb7185" />
        </linearGradient>
      </defs>
      <g transform="rotate(-8 256 256)">
        {/* Magic-proportioned card (63:88), themed face + edge */}
        <rect
          x="131"
          y="82"
          width="250"
          height="348"
          rx="22"
          fill="var(--surface-raised)"
          stroke="var(--border-strong)"
          strokeWidth="12"
        />
        {/* The S monogram — two arcs, round terminals */}
        <path
          d="M 298 202 A 42 42 0 1 0 256 256 A 42 42 0 1 1 214 310"
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="38"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
