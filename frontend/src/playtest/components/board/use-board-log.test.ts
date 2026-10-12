// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { GameLogEntry } from '@/lib/playtest/game-log';
import { useBoardLog } from './use-board-log';

const resistance = (seq: number) => ({ kind: 'resistance', seq }) as unknown as GameLogEntry;
const play = (seq: number) => ({ kind: 'play', seq }) as unknown as GameLogEntry;

describe('useBoardLog', () => {
  it('flags only resistance entries newer than the last one read', () => {
    const { result, rerender } = renderHook(({ log }) => useBoardLog(log), {
      initialProps: { log: [play(1)] },
    });
    expect(result.current.hasUnreadLog).toBe(false);
    rerender({ log: [play(1), resistance(2)] });
    expect(result.current.hasUnreadLog).toBe(true);
    act(() => result.current.handleOpenLog());
    expect(result.current.hasUnreadLog).toBe(false);
    expect(result.current.showLog).toBe(true);
    expect(result.current.logOnTable).toBe(false);
  });

  it('opens on the Table view from the feed button, and closes however it was opened', () => {
    const { result } = renderHook(() => useBoardLog([]));
    act(() => result.current.toggleTableLog());
    expect(result.current.showLog).toBe(true);
    expect(result.current.logOnTable).toBe(true);
    act(() => result.current.toggleTableLog());
    expect(result.current.showLog).toBe(false);
    act(() => result.current.handleOpenLog());
    act(() => result.current.toggleTableLog());
    expect(result.current.showLog).toBe(false);
  });
});
