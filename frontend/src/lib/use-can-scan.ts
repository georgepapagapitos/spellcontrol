import { useEffect, useState } from 'react';

/**
 * Detects whether the user can use the camera-based card scanner.
 *
 * Gated to phones and tablets: `(pointer: coarse)` OR a narrow viewport, plus
 * `mediaDevices.getUserMedia`. Scanning from a desktop webcam points a fixed
 * lens at a card the user has to hold steady in front of it, which never
 * produced a usable frame.
 *
 * The scanner's assets (opencv WASM + ONNX model + embedding DB) are a ~50 MB
 * lazy-load on first open, so the entry point stays behind this gate and the
 * component itself behind `React.lazy` — a visitor who never taps Scan pays
 * nothing.
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
