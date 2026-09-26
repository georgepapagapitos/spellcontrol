import type { CSSProperties } from 'react';
import { foilSeed } from '@/lib/foil-style';

/**
 * The foil engine's three overlay layers (holographic.css): spectrum shine,
 * sparkle grain, glare. Render inside any element carrying `is-foil
 * foil-{style}` that clips to the card's rounded corners — the preview face,
 * a grid tile, a binder pocket.
 *
 * `seed` (any stable id) phase-shifts the ambient drift so a page of foils
 * never moves in lockstep. The cursor-driven preview needs none.
 */
export function FoilShimmer({ seed }: { seed?: string }) {
  const style =
    seed === undefined ? undefined : ({ '--foil-seed': foilSeed(seed) } as CSSProperties);
  return (
    <>
      <div className="card-preview-foil-shine" style={style} aria-hidden="true" />
      <div className="card-preview-foil-grain" aria-hidden="true" />
      <div className="card-preview-foil-glare" aria-hidden="true" />
    </>
  );
}
