import { useMemo } from 'react';
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

const MOTE_COUNT = 30;

export interface SealMote {
  hex: string;
  angle: number;
  dist: number;
  delay: number;
  dur: number;
}

/**
 * Deterministic radial spark field for a colour identity. Colours cycle across
 * the identity so a two-colour deck alternates both; an empty identity (a
 * colourless commander) falls back to the seal gold so it still sparks.
 */
export function buildMotes(colors: string[]): SealMote[] {
  return Array.from({ length: MOTE_COUNT }, (_, i) => {
    const key = colors.length ? colors[i % colors.length] : undefined;
    const hex = (key && SPARK_HEX[key.toUpperCase()]) || FALLBACK_HEX;
    return {
      hex,
      angle: (i / MOTE_COUNT) * 360 + (i % 3) * 7,
      dist: 80 + (i % 6) * 18, // 80–170px radial spread
      delay: (i % 8) * 18, // 0–126ms stagger
      dur: 720 + (i % 4) * 100, // 720–1020ms
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
      {motes.map((m, i) => (
        <span
          key={i}
          className="seal-burst-mote"
          style={{
            background: m.hex,
            color: m.hex, // drives the box-shadow bloom via currentColor
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
