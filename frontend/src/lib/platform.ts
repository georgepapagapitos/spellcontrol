import { logger } from '@/lib/logger';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
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
