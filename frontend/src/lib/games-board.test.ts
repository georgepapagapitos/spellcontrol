import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishBoard, cancelBoardPublish } from './games-board';
import type { PublicBoard } from './playtest/projection';

vi.mock('./games-api', () => ({ postBoard: vi.fn() }));
import { postBoard } from './games-api';

const mockPostBoard = vi.mocked(postBoard);

function board(seat: number): PublicBoard {
  return { seat } as unknown as PublicBoard;
}

describe('publishBoard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPostBoard.mockReset();
    mockPostBoard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cancelBoardPublish();
    vi.useRealTimers();
  });

  it('does not call postBoard synchronously', () => {
    publishBoard('ABCD', board(0));
    expect(mockPostBoard).not.toHaveBeenCalled();
  });

  it('posts after the debounce window elapses', async () => {
    publishBoard('ABCD', board(0));
    await vi.advanceTimersByTimeAsync(150);
    expect(mockPostBoard).toHaveBeenCalledExactlyOnceWith('ABCD', board(0));
  });

  it('coalesces rapid successive calls into a single post of the latest board', async () => {
    publishBoard('ABCD', board(0));
    await vi.advanceTimersByTimeAsync(100);
    publishBoard('ABCD', { seat: 0, turn: 2 } as unknown as PublicBoard);
    await vi.advanceTimersByTimeAsync(100);
    // Still short of a full 150ms since the SECOND call — no post yet.
    expect(mockPostBoard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(mockPostBoard).toHaveBeenCalledExactlyOnceWith('ABCD', {
      seat: 0,
      turn: 2,
    });
  });

  it('cancelBoardPublish drops a pending publish', async () => {
    publishBoard('ABCD', board(0));
    cancelBoardPublish();
    await vi.advanceTimersByTimeAsync(500);
    expect(mockPostBoard).not.toHaveBeenCalled();
  });

  it('swallows a rejected postBoard instead of throwing', async () => {
    mockPostBoard.mockRejectedValueOnce(new Error('network'));
    publishBoard('ABCD', board(0));
    await vi.advanceTimersByTimeAsync(150);
    // Nothing to assert beyond "did not throw" — the timer callback runs
    // fire-and-forget, so getting here at all is the assertion.
    await vi.advanceTimersByTimeAsync(0);
  });
});
