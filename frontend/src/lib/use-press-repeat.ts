import { useCallback, useEffect, useRef } from 'react';

/**
 * Press-and-hold to repeat a ±1 step. Losing 10 life in one swing, or putting
 * five counters on a creature, was ten separate taps; holding the button now
 * ramps instead.
 *
 * The pointer path fires immediately on press and then repeats, while `onClick`
 * fires only for *keyboard*-activated clicks (`detail === 0`) — that split is
 * what keeps a real tap from counting twice without any "did a pointer already
 * handle this" bookkeeping to get out of sync.
 */
export function usePressRepeat(
  onPress: () => void,
  { delay = 450, interval = 90 }: { delay?: number; interval?: number } = {}
) {
  // Held in a ref so a caller passing a fresh closure each render (the common
  // case — `() => onAdjust(-1)`) doesn't restart the timers mid-hold. Synced
  // in an effect rather than during render: writing a ref while rendering is
  // a react-hooks/refs error, and the initial value already covers the first
  // paint.
  const cb = useRef(onPress);
  useEffect(() => {
    cb.current = onPress;
  });
  const rampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (rampTimer.current !== null) clearTimeout(rampTimer.current);
    if (repeatTimer.current !== null) clearInterval(repeatTimer.current);
    rampTimer.current = null;
    repeatTimer.current = null;
  }, []);

  // A component unmounting mid-hold (e.g. the panel closes) must not leave an
  // interval firing into a dead callback.
  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(() => {
    stop();
    cb.current();
    rampTimer.current = setTimeout(() => {
      repeatTimer.current = setInterval(() => cb.current(), interval);
    }, delay);
  }, [delay, interval, stop]);

  const onClick = useCallback((e: React.MouseEvent) => {
    // detail === 0 means the click was synthesized by Enter/Space rather than
    // by a pointer, so the pointer path above hasn't already run.
    if (e.detail === 0) cb.current();
  }, []);

  return {
    onPointerDown,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick,
  };
}
