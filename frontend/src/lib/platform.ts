import { logger } from '@/lib/logger';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

// `<a target="_blank">` / `window.open()` are dead taps in the Android
// WebView — no new tab, no system browser. Route external links through this
// instead so native opens them via the in-app browser plugin.
export function openExternal(url: string): void {
  if (isNativePlatform()) {
    void Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// Touch-capable device (native, phone/tablet browser, or touchscreen laptop).
// Used to enable touch-only affordances (e.g. pull-to-refresh) on web. Harmless
// if a touchscreen-laptop user is on a mouse — the gesture just never fires.
export function isTouchDevice(): boolean {
  return isNativePlatform() || navigator.maxTouchPoints > 0;
}

// Tag <html> so platform-specific CSS can branch (e.g. fullscreen camera on
// native, bottom safe-area inset for the mobile tab bar). Call once at boot,
// before the first render, so initial paint already has the right class.
export function tagPlatform(): void {
  if (isNativePlatform()) {
    document.documentElement.classList.add('capacitor', `capacitor-${Capacitor.getPlatform()}`);
  }
}

// Dismiss the native splash once the first frame has actually painted, instead
// of on the config's fixed timer. React's boot (store hydrate + IndexedDB read)
// routinely outruns a short fixed duration, and hiding early leaves a gap
// between the splash and the first real paint. Two rAFs: the first fires after
// React commits, the second after the browser has painted that commit.
//
// `launchAutoHide` deliberately stays ON in capacitor.config.ts as a backstop —
// if boot throws before this runs, the OS still clears the splash rather than
// stranding the user on it forever.
export function hideSplashWhenReady(): void {
  if (!isNativePlatform()) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void SplashScreen.hide({ fadeOutDuration: 200 }).catch((err) => {
        logger.warn('[platform] splash hide failed:', err);
      });
    });
  });
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
    logger.warn('[platform] status bar sync failed:', err);
  }
}
