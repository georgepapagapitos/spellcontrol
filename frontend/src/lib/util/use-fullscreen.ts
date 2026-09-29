import { useCallback, useEffect, useRef, useState } from 'react';

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
 *
 * `exitOnUnmount`: exit fullscreen when this hook's owner unmounts, but only
 * if THIS hook's own `enter`/`toggle` is what put the document into
 * fullscreen — never a fullscreen the user (or another feature) entered some
 * other way. Ownership is confirmed by `fullscreenchange`, not assumed the
 * moment `enter()` is called (the request is async and can be rejected), and
 * it clears the instant fullscreen exits for any reason, since there is
 * nothing left that's "ours" to hand back. The board is the one caller that
 * wants this — leaving it (Minimize, Clear the table, a route change) must
 * not strand the rest of the app in fullscreen.
 */
export function useFullscreen(options: { exitOnUnmount?: boolean } = {}): {
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
  // requestedRef: our request is in flight, awaiting the fullscreenchange
  // that confirms (or the rejection that denies) it. ownedRef: the document
  // is fullscreen BECAUSE of that request.
  const requestedRef = useRef(false);
  const ownedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(COARSE_QUERY);
    const update = () => setSupported(evaluateSupported());
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      const active = document.fullscreenElement != null;
      const nowOwned = active && requestedRef.current;
      setIsFullscreen(active);
      // Portrait lock rides fullscreen ownership: the board asked for both
      // with the same gesture, so it releases both together too. Every call
      // is optional-chained and wrapped — `screen.orientation.lock` is
      // unsupported on iOS Safari entirely and rejects outright on a
      // desktop/2-in-1 that allows free rotation, and `unlock` can throw if
      // nothing is locked; none of that should surface as a console error
      // or unhandled rejection for what is a nice-to-have.
      if (nowOwned) {
        try {
          void window.screen.orientation?.lock?.('portrait')?.catch(() => {});
        } catch {
          // ignored — unsupported or rejected, swallow
        }
      } else if (!active && ownedRef.current) {
        try {
          window.screen.orientation?.unlock?.();
        } catch {
          // ignored — nothing to unlock, or unsupported
        }
      }
      ownedRef.current = nowOwned;
      requestedRef.current = false;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(() => {
    if (!evaluateSupported() || document.fullscreenElement) return;
    requestedRef.current = true;
    document.documentElement.requestFullscreen().catch(() => {
      requestedRef.current = false;
    });
  }, []);

  const exit = useCallback(() => {
    if (!document.fullscreenElement) return;
    document.exitFullscreen().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) exit();
    else enter();
  }, [enter, exit]);

  const exitOnUnmount = options.exitOnUnmount ?? false;
  useEffect(() => {
    if (!exitOnUnmount) return undefined;
    return () => {
      if (ownedRef.current && document.fullscreenElement) {
        // Unlock directly here, not just via the fullscreenchange listener
        // above: that listener is torn down in this same unmount pass, so
        // the async fullscreenchange event it's waiting for would fire
        // after nothing is left to hear it.
        try {
          window.screen.orientation?.unlock?.();
        } catch {
          // ignored
        }
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [exitOnUnmount]);

  return { supported, isFullscreen, enter, exit, toggle };
}
