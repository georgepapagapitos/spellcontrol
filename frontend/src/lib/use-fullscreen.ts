import { useCallback, useEffect, useState } from 'react';

const COARSE_QUERY = '(pointer: coarse)';

function evaluateSupported(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (document.fullscreenEnabled !== true) return false;
  return window.matchMedia(COARSE_QUERY).matches;
}

/**
 * Fullscreen for the local life-counter board, touch devices only: a real
 * table game sits with the phone flat for an hour, and browser chrome is dead
 * weight the whole time. Desktop/fine-pointer sessions never see it (mirrors
 * `useCanScan`'s pointer gate) — a mouse user already owns their window.
 *
 * `enter`/`toggle` must be called from a genuine user gesture; the Fullscreen
 * API silently rejects anything else, and the `.catch(() => {})` here keeps
 * that rejection from surfacing as an unhandled promise. `supported` covers
 * both gates — `document.fullscreenEnabled` and the pointer query — so a
 * caller only needs the one flag to decide whether to offer it at all.
 */
export function useFullscreen(): {
  supported: boolean;
  isFullscreen: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
} {
  const [supported, setSupported] = useState(evaluateSupported);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement != null
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(COARSE_QUERY);
    const update = () => setSupported(evaluateSupported());
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(() => {
    if (!evaluateSupported() || document.fullscreenElement) return;
    document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  const exit = useCallback(() => {
    if (!document.fullscreenElement) return;
    document.exitFullscreen().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) exit();
    else enter();
  }, [enter, exit]);

  return { supported, isFullscreen, enter, exit, toggle };
}
