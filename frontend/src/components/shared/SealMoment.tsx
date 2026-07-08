import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SealBurst } from './SealBurst';
import './SealMoment.css';

/** Compact SealBurst runs ~1000ms; unmount just after it settles. */
const MOMENT_MS = 1250;

/**
 * The app-wide completion moment: a compact SealBurst, viewport-centered via
 * a portal (fixed positioning must escape transformed/container-type
 * ancestors), gone after one play. Purely decorative and pointer-transparent —
 * the calling surface carries the words (banner, toast, status row).
 *
 * Usage: `const { fire, moment } = useSealMoment();` — render `{moment}`
 * anywhere in the tree, call `fire(colorIdentity)` on the completion event.
 * Under reduced motion `fire` is a no-op (SealBurst also self-gates; this
 * just avoids mounting an empty portal).
 */
export function useSealMoment(): {
  fire: (colors?: string[]) => void;
  moment: React.ReactNode;
} {
  const [burst, setBurst] = useState<{ colors: string[]; key: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const count = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const fire = useCallback((colors: string[] = []) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    count.current += 1;
    // A fresh key remounts SealBurst so back-to-back fires replay cleanly.
    setBurst({ colors, key: count.current });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBurst(null), MOMENT_MS);
  }, []);

  const moment = burst
    ? createPortal(
        <div className="seal-moment" aria-hidden="true">
          <SealBurst key={burst.key} colors={burst.colors} compact />
        </div>,
        document.body
      )
    : null;

  return { fire, moment };
}
