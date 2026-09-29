// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGenerationTakeoverExit } from './use-generation-takeover-exit';

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('useGenerationTakeoverExit', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves when the takeover exit animation completes', async () => {
    setReducedMotion(false);
    const { result } = renderHook(() => useGenerationTakeoverExit());

    let done = false;
    act(() => {
      void result.current.waitForExit().then(() => {
        done = true;
      });
    });

    expect(result.current.isExiting).toBe(true);
    expect(done).toBe(false);

    await act(async () => {
      result.current.finishExit();
      await Promise.resolve();
    });
    expect(done).toBe(true);
  });

  it('falls back when animationend never fires', async () => {
    vi.useFakeTimers();
    setReducedMotion(false);
    const { result } = renderHook(() => useGenerationTakeoverExit());

    let done = false;
    act(() => {
      void result.current.waitForExit().then(() => {
        done = true;
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(1400);
      await Promise.resolve();
    });
    expect(done).toBe(true);
  });

  it('resolves immediately for reduced motion', async () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useGenerationTakeoverExit());

    let done = false;
    await act(async () => {
      await result.current.waitForExit().then(() => {
        done = true;
      });
    });

    expect(done).toBe(true);
    expect(result.current.isExiting).toBe(false);
  });
});
