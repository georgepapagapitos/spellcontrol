// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimatedNumber, __resetRevealRegistryForTests } from './use-animated-number';

// ── rAF / cAF fake ──────────────────────────────────────────────────────────
let rafCallbacks: Map<number, FrameRequestCallback> = new Map();
let rafId = 0;
let currentTime = 0;

function installRafFake() {
  rafCallbacks = new Map();
  rafId = 0;
  currentTime = 0;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id);
  });
  vi.stubGlobal('performance', { now: () => currentTime });
}

function advanceTime(ms: number) {
  currentTime += ms;
  const cbs = [...rafCallbacks.entries()];
  rafCallbacks.clear();
  for (const [, cb] of cbs) {
    cb(currentTime);
  }
}

function flushAllFrames(times = 20) {
  for (let i = 0; i < times; i++) {
    advanceTime(50);
    if (rafCallbacks.size === 0) break;
  }
}

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  installRafFake();
  setReducedMotion(false);
  __resetRevealRegistryForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('legacy path (number second arg)', () => {
  it('starts at target and does not tween', () => {
    const { result } = renderHook(() => useAnimatedNumber(50, 200));
    expect(result.current.display).toBe(50);
  });

  it('snaps on |Δ|>5', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, 200), {
      initialProps: { v: 50 },
    });
    act(() => {
      rerender({ v: 80 });
    });
    expect(result.current.display).toBe(80);
  });

  it('tweens on |Δ|<=5', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, 200), {
      initialProps: { v: 50 },
    });
    act(() => {
      rerender({ v: 53 });
    });
    // At t=0 it's still at 50 (tween not yet advanced)
    expect(result.current.display).toBe(50);
    act(() => {
      flushAllFrames();
    });
    expect(result.current.display).toBe(53);
  });

  it('increments popKey on change', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, 200), {
      initialProps: { v: 50 },
    });
    const before = result.current.popKey;
    act(() => {
      rerender({ v: 53 });
    });
    expect(result.current.popKey).toBe(before + 1);
  });

  it('no popKey change when value unchanged', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, 200), {
      initialProps: { v: 50 },
    });
    const before = result.current.popKey;
    act(() => {
      rerender({ v: 50 });
    });
    expect(result.current.popKey).toBe(before);
  });
});

describe('legacy path (no opts)', () => {
  it('starts at target', () => {
    const { result } = renderHook(() => useAnimatedNumber(68));
    expect(result.current.display).toBe(68);
  });

  it('snaps on |Δ|>5', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v), {
      initialProps: { v: 50 },
    });
    act(() => {
      rerender({ v: 80 });
    });
    expect(result.current.display).toBe(80);
  });

  it('tweens on |Δ|<=5', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v), {
      initialProps: { v: 50 },
    });
    act(() => {
      rerender({ v: 53 });
    });
    expect(result.current.display).toBe(50);
    act(() => {
      flushAllFrames();
    });
    expect(result.current.display).toBe(53);
  });
});

describe('reveal-key mode', () => {
  it('revealKey: null — starts at target immediately (no reveal)', () => {
    const { result } = renderHook(() => useAnimatedNumber(68, { revealMs: 600, revealKey: null }));
    expect(result.current.display).toBe(68);
    expect(rafCallbacks.size).toBe(0);
  });

  it('opts object without revealKey — starts at target immediately (no reveal)', () => {
    const { result } = renderHook(() => useAnimatedNumber(68, { revealMs: 600 }));
    expect(result.current.display).toBe(68);
    expect(rafCallbacks.size).toBe(0);
  });

  it('revealKey string + target=68 — starts at 0 and tweens to target over revealMs', () => {
    const { result } = renderHook(() =>
      useAnimatedNumber(68, { revealMs: 600, revealKey: 'test-key-1' })
    );
    // Immediately after mount, display is 0
    expect(result.current.display).toBe(0);
    // Advance to halfway
    act(() => {
      advanceTime(300);
    });
    expect(result.current.display).toBeGreaterThan(0);
    expect(result.current.display).toBeLessThan(68);
    // Advance to completion
    act(() => {
      advanceTime(400);
    });
    expect(result.current.display).toBe(68);
  });

  it('same key on remount — second instance starts at target (key consumed)', () => {
    const KEY = 'test-key-remount';
    // First instance — fires reveal
    const { unmount } = renderHook(() => useAnimatedNumber(68, { revealMs: 600, revealKey: KEY }));
    // Unmount (simulates tab switch away)
    act(() => {
      unmount();
    });
    // Second instance with same key — should NOT reveal (key already consumed)
    const { result } = renderHook(() => useAnimatedNumber(68, { revealMs: 600, revealKey: KEY }));
    expect(result.current.display).toBe(68);
    expect(rafCallbacks.size).toBe(0);
  });

  it('new key — reveals again', () => {
    // First instance consumes key-a
    const { unmount } = renderHook(() =>
      useAnimatedNumber(68, { revealMs: 600, revealKey: 'key-a' })
    );
    act(() => {
      flushAllFrames();
      unmount();
    });
    // Second instance with key-b — fresh key, should reveal
    const { result } = renderHook(() =>
      useAnimatedNumber(68, { revealMs: 600, revealKey: 'key-b' })
    );
    expect(result.current.display).toBe(0);
    act(() => {
      flushAllFrames();
    });
    expect(result.current.display).toBe(68);
  });

  it('mid-reveal target change lands on final target', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useAnimatedNumber(v, { revealMs: 600, revealKey: 'test-key-midchange' }),
      { initialProps: { v: 60 } }
    );
    // Start of reveal
    expect(result.current.display).toBe(0);
    // Advance halfway through the reveal
    act(() => {
      advanceTime(300);
    });
    // Change target mid-reveal
    act(() => {
      rerender({ v: 80 });
    });
    // Complete the reveal
    act(() => {
      flushAllFrames();
    });
    // Should end at the updated target
    expect(result.current.display).toBe(80);
  });

  it('reduced motion with revealKey — starts at target, no tween, key consumed', () => {
    setReducedMotion(true);
    const KEY = 'test-key-reduced';
    const { result } = renderHook(() => useAnimatedNumber(68, { revealMs: 600, revealKey: KEY }));
    expect(result.current.display).toBe(68);
    expect(rafCallbacks.size).toBe(0);
    // Key should be consumed — remount should also start at target
    const { result: result2 } = renderHook(() =>
      useAnimatedNumber(68, { revealMs: 600, revealKey: KEY })
    );
    expect(result2.current.display).toBe(68);
  });

  it('after reveal completes, small re-target change tweens', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useAnimatedNumber(v, { revealMs: 600, revealKey: 'test-key-retarget-small' }),
      { initialProps: { v: 60 } }
    );
    // Complete the reveal
    act(() => {
      flushAllFrames();
    });
    expect(result.current.display).toBe(60);
    // Now make a small change
    act(() => {
      rerender({ v: 63 });
    });
    act(() => {
      advanceTime(10);
    });
    // Should be tweening (not snapped to 63 yet)
    expect(result.current.display).toBeGreaterThanOrEqual(60);
    act(() => {
      flushAllFrames();
    });
    expect(result.current.display).toBe(63);
  });

  it('after reveal completes, large re-target change (>5) snaps', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useAnimatedNumber(v, { revealMs: 600, revealKey: 'test-key-retarget-large' }),
      { initialProps: { v: 60 } }
    );
    act(() => {
      flushAllFrames();
    });
    expect(result.current.display).toBe(60);
    act(() => {
      rerender({ v: 80 });
    });
    expect(result.current.display).toBe(80);
  });

  it('after reveal completes, increments popKey on change', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useAnimatedNumber(v, { revealMs: 600, revealKey: 'test-key-popkey' }),
      { initialProps: { v: 60 } }
    );
    act(() => {
      flushAllFrames();
    });
    const before = result.current.popKey;
    act(() => {
      rerender({ v: 63 });
    });
    expect(result.current.popKey).toBe(before + 1);
  });

  it('reveal arms on later render (pending→ready): mount with target=0 and key, then rerender with target=68', () => {
    const KEY = 'test-key-pending-ready';
    const { result, rerender } = renderHook(
      ({ v }) => useAnimatedNumber(v, { revealMs: 600, revealKey: KEY }),
      { initialProps: { v: 0 } }
    );
    // While target=0, display stays at 0 (nothing to reveal to)
    expect(result.current.display).toBe(0);
    expect(rafCallbacks.size).toBe(0);
    // Now target arrives (analysis ready)
    act(() => {
      rerender({ v: 68 });
    });
    // Should start reveal from 0
    expect(result.current.display).toBe(0);
    // Complete the reveal
    act(() => {
      flushAllFrames();
    });
    expect(result.current.display).toBe(68);
  });
});

describe('reduced motion', () => {
  it('revealKey with reduced motion: starts at target immediately', () => {
    setReducedMotion(true);
    const { result } = renderHook(() =>
      useAnimatedNumber(68, { revealMs: 600, revealKey: 'rm-key-1' })
    );
    expect(result.current.display).toBe(68);
    expect(rafCallbacks.size).toBe(0);
  });

  it('re-target in reveal-key mode: snaps immediately on any change', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(
      ({ v }) => useAnimatedNumber(v, { revealMs: 600, revealKey: 'rm-key-2' }),
      { initialProps: { v: 50 } }
    );
    act(() => {
      rerender({ v: 52 });
    });
    expect(result.current.display).toBe(52);
  });

  it('legacy path: snaps even on small change (reduced motion path)', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, 200), {
      initialProps: { v: 50 },
    });
    act(() => {
      rerender({ v: 53 });
    });
    // In reduced motion mode, the re-target effect snaps immediately
    expect(result.current.display).toBe(53);
  });

  it('legacy path: snaps on large change (unchanged behavior)', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, 200), {
      initialProps: { v: 50 },
    });
    act(() => {
      rerender({ v: 80 });
    });
    expect(result.current.display).toBe(80);
  });
});
