import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

// Tag <html> so platform-specific CSS can branch (e.g. fullscreen camera on
// native, bottom safe-area inset for the mobile tab bar). Call once at boot,
// before the first render, so initial paint already has the right class.
export function tagPlatform(): void {
  if (isNativePlatform()) {
    document.documentElement.classList.add('capacitor', `capacitor-${Capacitor.getPlatform()}`);
  }
}

// Read --bg, resolve it to rgb() via a transient element, and return a 0..1
// luminance estimate. Used only to choose light vs dark status-bar icons, so
// precision doesn't matter.
function computeBgLuminance(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (!raw) return 0.5;
  const probe = document.createElement('div');
  probe.style.color = raw;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = rgb.match(/\d+(?:\.\d+)?/g);
  if (!m || m.length < 3) return 0.5;
  const [r, g, b] = m.slice(0, 3).map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Sync the native status bar to the active theme: light icons on dark
// backgrounds, dark on light. The WebView keeps overlaying the system area
// (the app-shell's env(safe-area-inset-top) padding reserves the visual
// strip), so the status-bar background is the app's own paint underneath.
export async function syncStatusBar(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const lum = computeBgLuminance();
    await StatusBar.setStyle({ style: lum < 0.5 ? Style.Dark : Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch (err) {
    console.warn('[platform] status bar sync failed:', err);
  }
}

// Wire the soft keyboard so it never covers focused inputs.
//
// The plugin config already does the heavy lifting (WebView resizes on
// iOS via `resize: 'native'`; on Android the system keyboard-resize
// callback is re-enabled with `resizeOnFullScreen: true`). This adds two
// JS-side pieces:
//
//   - A `keyboard-open` class on <html> so CSS can adjust fixed/sticky
//     surfaces (bottom sheets, sticky footers) that the WebView resize
//     can't see.
//   - A `scrollIntoView` fallback for the focused input on
//     `keyboardWillShow` — covers inputs inside `position: fixed`
//     containers (bottom sheets, modal headers) that the native resize
//     repositions but doesn't auto-scroll within.
//
// Idempotent — safe to call once at boot. Errors are swallowed because
// the keyboard plugin throws on web-debug builds.
export async function initKeyboard(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Keyboard.addListener('keyboardWillShow', () => {
      document.documentElement.classList.add('keyboard-open');
      // Defer one frame so layout has settled after the WebView resize.
      requestAnimationFrame(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement && isTextInput(el)) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });
    });
    await Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.classList.remove('keyboard-open');
    });
  } catch (err) {
    console.warn('[platform] keyboard init failed:', err);
  }
}

function isTextInput(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const skip = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range']);
    return !skip.has(el.type);
  }
  return el.isContentEditable;
}
