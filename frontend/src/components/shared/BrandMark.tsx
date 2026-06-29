/**
 * BrandMark — the SpellControl grid+spark mark (design D).
 *
 * Inline SVG so it renders crisply at any size with no asset load, theming
 * just works, and it can be embedded in accessible contexts with aria-hidden.
 *
 * The spark gradient is fixed amber→coral (the brand palette); the grid cells
 * stroke is a warm taupe that works on both light and dark backgrounds.
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
      {/* 3×3 grid with the centre cell open (occupied by the spark) */}
      <g fill="none" stroke="var(--brand-mark-grid)" strokeWidth="13">
        <rect x="120" y="120" width="78" height="78" rx="17" />
        <rect x="217" y="120" width="78" height="78" rx="17" />
        <rect x="314" y="120" width="78" height="78" rx="17" />
        <rect x="120" y="217" width="78" height="78" rx="17" />
        {/* centre cell deliberately omitted — the spark fills that space */}
        <rect x="314" y="217" width="78" height="78" rx="17" />
        <rect x="120" y="314" width="78" height="78" rx="17" />
        <rect x="217" y="314" width="78" height="78" rx="17" />
        <rect x="314" y="314" width="78" height="78" rx="17" />
      </g>
      {/* Four-point spark / asterisk — the animated moment in the grid */}
      <path
        d="M256 168
           C264 226 286 248 344 256
           C286 264 264 286 256 344
           C248 286 226 264 168 256
           C226 248 248 226 256 168 Z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}
