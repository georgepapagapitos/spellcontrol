import { describe, it, expect, vi } from 'vitest';
import { pending } from '@/test/pending';
import { bestEffortBudget } from './best-effort';

describe('bestEffortBudget', () => {
  it('returns the work result when it settles inside the budget', async () => {
    const within = bestEffortBudget(1000);
    expect(await within(Promise.resolve('ok'), 'fallback')).toBe('ok');
  });

  it('returns the fallback when the work outlives the budget', async () => {
    vi.useFakeTimers();
    try {
      const within = bestEffortBudget(500);
      const never = pending<string>();
      const p = within(never, 'fallback');
      await vi.advanceTimersByTimeAsync(500);
      expect(await p).toBe('fallback');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares the deadline across steps: an exhausted budget skips later work', async () => {
    vi.useFakeTimers();
    try {
      const within = bestEffortBudget(300);
      const first = within(pending<number>(), 1);
      await vi.advanceTimersByTimeAsync(300);
      expect(await first).toBe(1);
      // Budget spent — even instantly-resolving work is skipped for its fallback.
      expect(await within(Promise.resolve(2), 0)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a rejection into the fallback', async () => {
    const within = bestEffortBudget(1000);
    expect(await within(Promise.reject(new Error('429')), 'fallback')).toBe('fallback');
  });
});
