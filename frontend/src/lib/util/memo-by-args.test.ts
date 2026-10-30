import { describe, expect, it, vi } from 'vitest';
import { memoByArgs } from './memo-by-args';

describe('memoByArgs', () => {
  it('returns the same result for the same argument references', () => {
    const fn = vi.fn((xs: number[], k: number) => xs.map((x) => x * k));
    const m = memoByArgs(fn);
    const xs = [1, 2];
    const a = m(xs, 2);
    expect(m(xs, 2)).toBe(a);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('recomputes for a new reference, even with equal contents', () => {
    const fn = vi.fn((xs: number[]) => xs.slice());
    const m = memoByArgs(fn);
    m([1]);
    m([1]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps the most recently used entries up to its size', () => {
    const fn = vi.fn((x: object) => ({ x }));
    const m = memoByArgs(fn, 2);
    const [a, b, c] = [{}, {}, {}];
    m(a);
    m(b);
    m(a); // a is now the most recent
    m(c); // evicts b
    expect(fn).toHaveBeenCalledTimes(3);
    m(a);
    expect(fn).toHaveBeenCalledTimes(3);
    m(b);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
