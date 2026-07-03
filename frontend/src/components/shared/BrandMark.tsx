/**
 * BrandMark — the SpellControl clasped grimoire.
 *
 * A closed spellbook strapped shut with a brass clasp: the spell-book, under
 * control. Inline SVG so it renders crisply at any size with no asset load.
 * The palette is fixed (arcane blue cover, brass strap, no gradients) — the
 * mark reads on light and dark surfaces alike, and flat colors keep it
 * stampable and animatable (the loading story is this book opening).
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
      {/* cover */}
      <rect x="136" y="84" width="240" height="344" rx="26" fill="#42539e" />
      {/* spine band */}
      <path d="M162 84 a26 26 0 0 0 -26 26 v 292 a26 26 0 0 0 26 26 h 26 V 84 Z" fill="#333f78" />
      {/* strap */}
      <rect x="136" y="264" width="240" height="46" rx="6" fill="#d9a441" />
      {/* diamond clasp, latched over the fore-edge */}
      <rect
        x="348"
        y="259"
        width="56"
        height="56"
        rx="10"
        transform="rotate(45 376 287)"
        fill="#f0c368"
      />
    </svg>
  );
}
