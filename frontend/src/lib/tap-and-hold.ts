import { useEffect, useRef } from 'react';
import { haptics } from './haptics';
import { HOLD_DWELL_MS, HOLD_JUMP_REPEAT_MS, HOLD_REPEAT_MS, holdStepFor } from './hold-ramp';

/**
 * The tap/press-and-hold gesture that drives every ±1 life/counter control in
 * the app (`GameBoard`'s player panels, `OnlineGameView`'s per-device life
 * controls). A leaf module (no component imports) so both surfaces can share
 * the exact gesture — dwell timing, hold-ramp, swipe detection — without one
 * dragging in the other's whole component tree.
 */

export interface TapAndHoldOpts {
  onTap: (arg: number) => void;
  onHoldTick: (arg: number, gearUp: boolean) => void;
  onPointerStart?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** Panel rotation in degrees; affects swipe direction interpretation. */
  rotation?: number;
  /**
   * A fixed jump per hold tick instead of the time ramp: a long press moves
   * this much at once, then repeats every HOLD_JUMP_REPEAT_MS. Life totals
   * use ±10 (Lotus's long tap); counters leave it unset, because a held
   * poison counter must never land on 10 in one go.
   */
  holdStep?: number;
  disabled: boolean;
}

const SWIPE_THRESHOLD_PX = 40;
const SWIPE_AXIS_RATIO = 1.5;

/** A screen-space delta in the axes of a panel rotated `rot`° clockwise. */
export function toPanelSpace(dx: number, dy: number, rot: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return [dy, -dx];
    case 180:
      return [-dx, -dy];
    case 270:
      return [-dy, dx];
    default:
      return [dx, dy];
  }
}

/**
 * Hook that returns a getHandlers(arg) factory which produces the pointer
 * event handlers for a tap-and-hold zone. A single click fires `onTap(arg)`;
 * a long press (>=HOLD_DWELL_MS) starts a repeater that fires
 * `onHoldTick(delta, gearUp)` every HOLD_REPEAT_MS, where `delta` ramps up
 * over time via `holdStepFor`: ×1 initially, ×5 after 1.5 s from repeater
 * start, ×10 after 3.5 s from repeater start (i.e. after the dwell, not from
 * pointer-down). A haptic bump fires — before the tick — each time the step
 * size increases; `gearUp` is true on that tick so the caller can skip the
 * redundant light tap. With `holdStep` set there is no ramp: every tick is
 * that fixed jump, and each one gets its own tap.
 *
 * Also detects vertical swipes in the PANEL's own space: if the pointer moves
 * >40px along the panel's up/down axis (and predominantly along it) before
 * lift, the hold timer is cancelled and onSwipeUp/onSwipeDown fires instead
 * of a tap or repeater. "Up" is away from the seat's player whatever the
 * rotation — on a sideways (90°/270°) seat that is a horizontal screen motion,
 * which a screen-vertical check used to ignore.
 *
 * Using pointer events (not touch/mouse separately) lets the same handler
 * cover mouse, touch, and pen with no synthetic-click double-fire.
 */
export function useTapAndHold({
  onTap,
  onHoldTick,
  onPointerStart,
  onPointerMove,
  onSwipeUp,
  onSwipeDown,
  rotation = 0,
  holdStep,
  disabled,
}: TapAndHoldOpts) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const holdStartRef = useRef<number>(0);
  const prevStepRef = useRef<number>(1);

  const clear = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    holdTimer.current = null;
    repeatTimer.current = null;
  };

  useEffect(() => () => clear(), []);

  return (arg: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled) {
        // Still record start so a swipe-up (e.g. open seat menu while
        // eliminated) can fire. But don't arm tap/hold.
        startRef.current = { x: e.clientX, y: e.clientY };
        swipedRef.current = false;
        onPointerStart?.(e);
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      heldRef.current = false;
      swipedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      onPointerStart?.(e);
      clear();
      holdTimer.current = setTimeout(() => {
        heldRef.current = true;
        if (holdStep != null) {
          const jump = Math.sign(arg) * holdStep;
          onHoldTick(jump, false);
          repeatTimer.current = setInterval(() => onHoldTick(jump, false), HOLD_JUMP_REPEAT_MS);
          return;
        }
        holdStartRef.current = performance.now();
        prevStepRef.current = 1;
        // First tick at step 1 (elapsed ≈ 0) — never a gear-up.
        onHoldTick(Math.sign(arg) * holdStepFor(0), false);
        repeatTimer.current = setInterval(() => {
          const elapsed = performance.now() - holdStartRef.current;
          const step = holdStepFor(elapsed);
          const gearUp = step > prevStepRef.current;
          if (gearUp) {
            haptics.bump();
            prevStepRef.current = step;
          }
          onHoldTick(Math.sign(arg) * step, gearUp);
        }, HOLD_REPEAT_MS);
      }, HOLD_DWELL_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      onPointerMove?.(e);
      const s = startRef.current;
      if (!s || swipedRef.current) return;
      const [dx, dy] = toPanelSpace(e.clientX - s.x, e.clientY - s.y, rotation);
      if (Math.abs(dy) >= SWIPE_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS_RATIO) {
        // Crossed the swipe threshold — cancel any pending tap/hold.
        swipedRef.current = true;
        clear();
        if (dy < 0) onSwipeUp?.();
        else onSwipeDown?.();
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      const wasHeld = heldRef.current;
      const wasSwipe = swipedRef.current;
      clear();
      startRef.current = null;
      if (disabled) return;
      if (!wasHeld && !wasSwipe) onTap(arg);
    },
    onPointerCancel: () => {
      clear();
      startRef.current = null;
    },
    onPointerLeave: () => {
      clear();
      startRef.current = null;
    },
  });
}
