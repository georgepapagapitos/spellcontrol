import { useEffect, useState } from 'react';

/**
 * Detects whether the device is plausibly capable of (and a good fit for)
 * the camera-based card scanner.
 *
 * Gating signal: `(pointer: coarse)` OR a narrow viewport. Coarse-pointer
 * matches phones and tablets (touchscreens with imprecise input), and the
 * width breakpoint catches the rare desktop-with-touchscreen as well as
 * desktop browsers in a narrow window. Desktops without a touchscreen are
 * hidden — they're almost never near a built-in rear camera, and even when
 * a webcam exists the framing UX is awkward.
 *
 * We also require `mediaDevices.getUserMedia` to exist; without it the
 * scanner couldn't open the camera anyway.
 */
const QUERY = '(pointer: coarse), (max-width: 1024px)';

export function useCanScan(): boolean {
  const [canScan, setCanScan] = useState(() => evaluate());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(QUERY);
    const update = () => setCanScan(evaluate());
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return canScan;
}

function evaluate(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  return window.matchMedia(QUERY).matches;
}
