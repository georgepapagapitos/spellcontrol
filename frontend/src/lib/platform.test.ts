// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isNative, hide, browserOpen } = vi.hoisted(() => ({
  isNative: vi.fn(() => true),
  hide: vi.fn(() => Promise.resolve()),
  browserOpen: vi.fn(() => Promise.resolve()),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: isNative, getPlatform: () => 'android' },
}));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide } }));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: vi.fn(), setOverlaysWebView: vi.fn() },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen } }));

import { hideSplashWhenReady, openExternal } from './platform';

let frames: FrameRequestCallback[] = [];

/** Run every callback queued for the current frame (callbacks may queue more). */
function flushFrame(): void {
  const queued = frames;
  frames = [];
  queued.forEach((cb) => cb(0));
}

describe('hideSplashWhenReady', () => {
  beforeEach(() => {
    hide.mockClear();
    isNative.mockReturnValue(true);
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  });

  it('waits for a second frame so the first paint is on screen before hiding', () => {
    hideSplashWhenReady();

    // One frame in, React has committed but the browser has not painted it.
    // Hiding here is the bug this replaced: splash gone, screen still blank.
    flushFrame();
    expect(hide).not.toHaveBeenCalled();

    flushFrame();
    expect(hide).toHaveBeenCalledWith({ fadeOutDuration: 200 });
  });

  it('is a no-op on web, where there is no splash to dismiss', () => {
    isNative.mockReturnValue(false);

    hideSplashWhenReady();
    flushFrame();
    flushFrame();

    expect(hide).not.toHaveBeenCalled();
  });
});

describe('openExternal', () => {
  const openSpy = vi.fn();

  beforeEach(() => {
    browserOpen.mockClear();
    openSpy.mockClear();
    vi.stubGlobal('open', openSpy);
  });

  it('opens via the Capacitor Browser plugin on native, not window.open', () => {
    isNative.mockReturnValue(true);

    openExternal('https://scryfall.com');

    expect(browserOpen).toHaveBeenCalledWith({ url: 'https://scryfall.com' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('falls back to window.open on web, not the Browser plugin', () => {
    isNative.mockReturnValue(false);

    openExternal('https://scryfall.com');

    expect(openSpy).toHaveBeenCalledWith('https://scryfall.com', '_blank', 'noopener,noreferrer');
    expect(browserOpen).not.toHaveBeenCalled();
  });
});
