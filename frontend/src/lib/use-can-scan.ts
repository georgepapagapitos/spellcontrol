import { useEffect, useState } from 'react';
import { isNativePlatform } from './platform';

/**
 * Detects whether the user can use the camera-based card scanner.
 *
 * **The scanner is native-only as of scanner v2 (Phase 2).** Shipping it on
 * the web build means a ~50 MB lazy-load (opencv WASM + ONNX model +
 * embedding DB) the first time the user opens the scanner, which is a
 * non-starter for casual web visitors. The native APK bundles the assets
 * once and pays no per-open cost. The web flow funnels users to the APK
 * download instead.
 *
 * Secondary gates (still evaluated for forward-compat / unit-test parity):
 * `(pointer: coarse)` OR a narrow viewport matches phones and tablets, and
 * `mediaDevices.getUserMedia` must exist. These rarely fail on a native
 * Capacitor WebView but the checks keep the test contract honest.
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
  if (!isNativePlatform()) return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  return window.matchMedia(QUERY).matches;
}
