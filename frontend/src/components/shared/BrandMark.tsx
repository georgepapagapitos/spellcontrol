import './BrandMark.css';
import { joinClasses } from '@/lib/join-classes';

/**
 * BrandMark — the SpellControl clasped grimoire.
 *
 * A closed spellbook strapped shut with a brass clasp: the spell-book, under
 * control. Inline SVG so it renders crisply at any size with no asset load.
 * The palette is fixed (arcane blue cover, brass strap, no gradients on the
 * static mark) — the mark reads on light and dark surfaces alike, and flat
 * colors keep it stampable and animatable.
 *
 * `motion` opts a rendered instance into one of the three brand loops (see
 * STYLE_GUIDE.md "Brand mark motion"): `idle` breathes an aura behind the
 * book on hero/landing moments, `busy` pulses the clasp as a loading tell,
 * `boot` sends the clasp gem on one orbit while the app cold-boots. Leaving
 * `motion` unset renders exactly the static mark (unchanged from before this
 * prop existed) — no extra DOM, no animation cost.
 *
 * Usage:
 *   <BrandMark size={28} aria-hidden />                          // header (label on parent)
 *   <BrandMark size={48} className="auth-mark" motion="idle" />  // hero moment
 *   <BrandMark size={64} motion="busy" aria-hidden />             // loading surface
 *   <BrandMark size={96} motion="boot" aria-hidden />             // cold-boot screen
 */

type BrandMotion = 'boot' | 'busy' | 'idle';

/* The clasp seal's brass gold. Mirrors --brand-seal-gold in styles/tokens.css
   (the CSS-side canonical value) — SVG presentation attributes can't take
   var(), so the hex lives here once instead of on every fill/stroke. */
const SEAL_GOLD = '#f0c368';

/* boot mode: one full sweep around the book, starting and ending at the
   clasp (256,287) — with a hold at the clasp on both ends of the cycle via
   the animateMotion keyPoints/keyTimes. */
const ORBIT_PATH =
  'M256 287 C380 300 470 240 440 160 C410 80 320 50 256 55 C150 60 70 110 75 200 C80 290 170 330 240 300 C250 295 254 290 256 287';

interface Props {
  size?: number;
  className?: string;
  motion?: BrandMotion;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export function BrandMark({ size = 28, className, motion, 'aria-hidden': ariaHidden }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden={ariaHidden}
      focusable="false"
      className={joinClasses('brand-mark', motion && `brand-mark-${motion}`, className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {(motion === 'idle' || motion === 'busy') && (
        <defs>
          <radialGradient id="bm-glow-gradient">
            <stop offset="0%" stopColor={SEAL_GOLD} stopOpacity="0.8" />
            <stop offset="100%" stopColor={SEAL_GOLD} stopOpacity="0" />
          </radialGradient>
        </defs>
      )}

      {motion === 'idle' && (
        <>
          <circle
            className="brand-mark-aura"
            cx="256"
            cy="256"
            r="225"
            fill="url(#bm-glow-gradient)"
          />
          <circle
            className="brand-mark-aura-core"
            cx="256"
            cy="256"
            r="150"
            fill="url(#bm-glow-gradient)"
          />
        </>
      )}

      {/* cover */}
      <rect x="136" y="84" width="240" height="344" rx="26" fill="#42539e" />
      {/* spine band */}
      <path d="M162 84 a26 26 0 0 0 -26 26 v 292 a26 26 0 0 0 26 26 h 26 V 84 Z" fill="#333f78" />
      {/* strap */}
      <rect x="136" y="264" width="240" height="46" rx="6" fill="#d9a441" />

      {motion === 'idle' && (
        <circle
          className="brand-mark-clasp-glow"
          cx="256"
          cy="287"
          r="80"
          fill="url(#bm-glow-gradient)"
        />
      )}
      {motion === 'busy' && (
        <circle
          className="brand-mark-seal-glow"
          cx="256"
          cy="287"
          r="86"
          fill="url(#bm-glow-gradient)"
        />
      )}

      {/* diamond clasp — a centered seal on the strap */}
      <rect
        x="228"
        y="259"
        width="56"
        height="56"
        rx="10"
        transform="rotate(45 256 287)"
        fill={SEAL_GOLD}
      />

      {motion === 'busy' && (
        <>
          <rect
            className="brand-mark-seal-highlight"
            x="228"
            y="259"
            width="56"
            height="56"
            rx="10"
            transform="rotate(45 256 287)"
            fill="#fdeab7"
          />
          <circle
            className="brand-mark-seal-ring"
            cx="256"
            cy="287"
            r="70"
            fill="none"
            stroke={SEAL_GOLD}
            strokeWidth="6"
          />
        </>
      )}

      {motion === 'boot' && (
        <>
          {/* empty socket left behind while the gem is out orbiting */}
          <rect
            className="brand-mark-boot-socket"
            x="234"
            y="265"
            width="44"
            height="44"
            rx="8"
            transform="rotate(45 256 287)"
            fill="#b8871f"
          />
          {/* The orbit is SMIL, not CSS offset-path — Chrome mis-anchors
              offset-path coordinates on SVG children, while animateMotion
              resolves the path in viewBox units. Each gem is a <g> carried
              along the path; the rect inside is drawn centered on the local
              origin so the anchor point is the diamond's visual center. The
              ghosts lag the main gem via negative begin offsets of
              (0.09s|0.18s) short of a full 5s cycle. */}
          <g className="brand-mark-gem brand-mark-gem--trail2">
            <rect
              x="-21"
              y="-21"
              width="42"
              height="42"
              rx="8"
              transform="rotate(45)"
              fill={SEAL_GOLD}
            />
            <animateMotion
              dur="5s"
              repeatCount="indefinite"
              begin="-4.82s"
              calcMode="spline"
              keyPoints="0;0;1;1"
              keyTimes="0;0.1;0.88;1"
              keySplines="0 0 1 1;0.45 0.05 0.4 1;0 0 1 1"
              path={ORBIT_PATH}
            />
          </g>
          <g className="brand-mark-gem brand-mark-gem--trail1">
            <rect
              x="-23"
              y="-23"
              width="46"
              height="46"
              rx="9"
              transform="rotate(45)"
              fill={SEAL_GOLD}
            />
            <animateMotion
              dur="5s"
              repeatCount="indefinite"
              begin="-4.91s"
              calcMode="spline"
              keyPoints="0;0;1;1"
              keyTimes="0;0.1;0.88;1"
              keySplines="0 0 1 1;0.45 0.05 0.4 1;0 0 1 1"
              path={ORBIT_PATH}
            />
          </g>
          <g className="brand-mark-gem brand-mark-gem--main">
            <rect
              x="-26"
              y="-26"
              width="52"
              height="52"
              rx="10"
              transform="rotate(45)"
              fill={SEAL_GOLD}
            />
            <animateMotion
              dur="5s"
              repeatCount="indefinite"
              calcMode="spline"
              keyPoints="0;0;1;1"
              keyTimes="0;0.1;0.88;1"
              keySplines="0 0 1 1;0.45 0.05 0.4 1;0 0 1 1"
              path={ORBIT_PATH}
            />
          </g>
          <circle
            className="brand-mark-orbit-ring"
            cx="256"
            cy="287"
            r="60"
            fill="none"
            stroke={SEAL_GOLD}
            strokeWidth="6"
          />
        </>
      )}
    </svg>
  );
}
