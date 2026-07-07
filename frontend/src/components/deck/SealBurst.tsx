import { useMemo } from 'react';
import { BrandMark } from '../shared/BrandMark';
import './SealBurst.css';

/**
 * One-shot completion flourish, Magic-native by design: the grimoire seal
 * flares (the same `#f0c368` brass glow as the <BrandMark> clasp seal) and
 * sheds mana sparks in the deck's own colour identity. NOT confetti — the
 * material is the brand's seal + WUBRG mana, so the celebration knows what
 * you built. Purely decorative (`aria-hidden`); the surrounding surface
 * carries the real announcement.
 *
 * Reduced-motion safe two ways: renders nothing when the user prefers reduced
 * motion, and every keyframe in SealBurst.css is also `reduce`-gated. Its only
 * mount site (GenerationTakeover's exit phase) already never fires under
 * reduced motion — this is the belt to that suspenders.
 *
 * ponytail: the seal flare visually rhymes with the real BrandMark seal
 * (brand-mark-seal-glow / -ring) rather than rendering the literal SVG — a
 * one-shot BrandMark would need a new motion mode on that component. Swap in
 * the actual seal layer if this graduates past deck-gen.
 */

/** WUBRG → a spark hex readable on the darkened takeover art. Black is lifted
 *  to a violet so a mono-B deck still throws visible sparks. */
const SPARK_HEX: Record<string, string> = {
  W: '#f5e8c0',
  U: '#4aa3e0',
  B: '#a986c9',
  R: '#e8564d',
  G: '#46c274',
};
/** Colourless / unknown identity — a warm gold in the seal's own family. */
const FALLBACK_HEX = '#e6d2a0';

// Restrained on purpose — a handful of drifting motes reads more refined than
// a dense firework. Taste lives in fewer, softer, slower.
const MOTE_COUNT = 16;

export interface SealMote {
  hex: string;
  angle: number;
  dist: number;
  size: number;
  delay: number;
  dur: number;
}

/**
 * Deterministic radial spark field for a colour identity. Colours cycle across
 * the identity so a two-colour deck alternates both; an empty identity (a
 * colourless commander) falls back to the seal gold so it still sparks. The
 * motes drift outward unhurriedly and fade — settling embers, not a burst.
 */
export function buildMotes(colors: string[]): SealMote[] {
  return Array.from({ length: MOTE_COUNT }, (_, i) => {
    const key = colors.length ? colors[i % colors.length] : undefined;
    const hex = (key && SPARK_HEX[key.toUpperCase()]) || FALLBACK_HEX;
    return {
      hex,
      // Even spread with a touch of jitter so it never reads as a clock face.
      angle: (i / MOTE_COUNT) * 360 + (i % 2 ? 9 : -6),
      dist: 74 + (i % 5) * 13, // 74–126px — a gentle drift, not an explosion
      size: 0.34 + (i % 3) * 0.05, // 0.34–0.44rem, lightly varied
      delay: (i % 6) * 26, // 0–130ms stagger
      dur: 880 + (i % 3) * 120, // 880–1120ms — slow enough to feel graceful
    };
  });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Deck-generation-complete celebration: seal flare + colour-identity sparks. */
export function SealBurst({ colors }: { colors: string[] }) {
  const motes = useMemo(() => buildMotes(colors), [colors]);

  if (prefersReducedMotion()) return null;

  return (
    <div className="seal-burst" aria-hidden="true">
      <span className="seal-burst-flare" />
      <span className="seal-burst-ring" />
      {/* The brand grimoire blooms at the centre — the icon does the
          celebrating; the sparks radiate from it in the deck's colours. */}
      <BrandMark size={112} className="seal-burst-mark" aria-hidden />
      {motes.map((m, i) => (
        <span
          key={i}
          className="seal-burst-mote"
          style={{
            background: m.hex,
            color: m.hex, // drives the soft glow via currentColor
            width: `${m.size}rem`,
            height: `${m.size}rem`,
            ['--angle' as never]: `${m.angle}deg`,
            ['--dist' as never]: `${m.dist}px`,
            animationDelay: `${m.delay}ms`,
            animationDuration: `${m.dur}ms`,
          }}
        />
      ))}
    </div>
  );
}
