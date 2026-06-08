import { useSyncExternalStore } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { isNativePlatform } from '@/lib/platform';
import { logger } from '@/lib/logger';

/**
 * Single keyboard layer for the whole app.
 *
 * Replaces the old split between `platform.initKeyboard()` (a `.keyboard-open`
 * class + a blunt scrollIntoView) and the one-off `useVisualViewport` hook
 * (consumed by exactly one component). There is now one writer of keyboard
 * state and two ways to consume it:
 *
 *   - **CSS** — `--keyboard-inset` (px) and the `.keyboard-open` class on
 *     <html>. Most surfaces need nothing else: a fixed bottom sheet docks at
 *     `bottom: var(--keyboard-inset)`, a scroll region sets
 *     `scroll-padding-bottom`, etc. This is the common, zero-JS path.
 *   - **JS** — `useKeyboard()` for the rare component that must compute
 *     geometry (e.g. a portaled tray measuring its own max-height).
 *
 * Why `visualViewport` is the cross-platform primitive: on native the WebView
 * itself resizes when the keyboard shows (`resize: 'native'` on iOS,
 * `resizeOnFullScreen: true` on Android — see capacitor.config.ts), so the
 * layout already sits above the keyboard and the inset stays ~0. On the web
 * the keyboard floats over the layout viewport, so the inset is the gap a
 * `position: fixed; bottom: 0` element must clear. The same number is correct
 * in both worlds. Capacitor's `keyboardWillShow/Hide` events are layered on
 * only to make `isOpen` reliable on native (where the inset alone can't tell).
 */

export interface KeyboardState {
  /** Pixels the on-screen keyboard occupies at the bottom of the layout
   *  viewport. ~0 on native (the WebView resizes); the real gap on web. */
  inset: number;
  /** Visible viewport height in px (excludes the keyboard). */
  viewportHeight: number;
  /** Whether the on-screen keyboard is currently shown. */
  isOpen: boolean;
}

let state: KeyboardState = {
  inset: 0,
  viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
  isOpen: false,
};

let nativeOpen = false;
let initialized = false;
const subscribers = new Set<() => void>();

function emit(next: KeyboardState): void {
  const wasOpen = state.isOpen;
  state = next;
  const root = document.documentElement;
  root.style.setProperty('--keyboard-inset', `${next.inset}px`);
  root.classList.toggle('keyboard-open', next.isOpen);
  // On the leading edge of the keyboard opening, pull the focused field clear
  // of it. Covers inputs inside fixed containers (sheets, modal headers) that
  // the native resize repositions but doesn't auto-scroll within.
  if (next.isOpen && !wasOpen) scrollFocusedIntoView();
  subscribers.forEach((fn) => fn());
}

function recompute(): void {
  const vv = window.visualViewport;
  let inset = 0;
  let viewportHeight = window.innerHeight;
  if (vv) {
    // The visual viewport spans [offsetTop, offsetTop + height] of the layout
    // viewport; whatever remains at the bottom is the keyboard.
    inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    viewportHeight = Math.round(vv.height);
  }
  emit({ inset, viewportHeight, isOpen: nativeOpen || inset > 0 });
}

function scrollFocusedIntoView(): void {
  requestAnimationFrame(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && isTextInput(el)) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

function isTextInput(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const skip = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range']);
    return !skip.has(el.type);
  }
  return el.isContentEditable;
}

/**
 * Wire the keyboard layer once at boot, before the first render so the initial
 * paint already carries `--keyboard-inset: 0px`. Idempotent; errors swallowed
 * (the Capacitor plugin throws on web-debug builds).
 */
export function initKeyboardLayer(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', recompute);
    vv.addEventListener('scroll', recompute);
  }
  window.addEventListener('resize', recompute);
  recompute();

  if (isNativePlatform()) {
    void (async () => {
      try {
        await Keyboard.addListener('keyboardWillShow', () => {
          nativeOpen = true;
          recompute();
        });
        await Keyboard.addListener('keyboardWillHide', () => {
          nativeOpen = false;
          recompute();
        });
      } catch (err) {
        logger.warn('[keyboard] native listener init failed:', err);
      }
    })();
  }
}

/**
 * `onMouseDown`/`onPointerDown` handler for a control that sits beside a focused
 * text field but must NOT steal focus from it — e.g. a show/hide-password eye
 * toggle. Pressing such a button normally blurs the input, and on native
 * (Capacitor) a blur dismisses the on-screen keyboard, so the user loses the
 * keyboard every time they peek at their password. Preventing the default on the
 * press stops the focus shift; the button's `onClick` still fires, so the toggle
 * itself is unaffected.
 */
export function preventFocusSteal(e: { preventDefault: () => void }): void {
  e.preventDefault();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Subscribe a component to keyboard state. Prefer the `--keyboard-inset` CSS
 * variable for pure layout — reach for this hook only when JS must read the
 * geometry (e.g. a portaled tray sizing itself).
 */
export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );
}
