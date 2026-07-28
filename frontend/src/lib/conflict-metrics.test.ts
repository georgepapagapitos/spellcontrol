// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordDeckConflict, getDeckConflictCount } from './conflict-metrics';

beforeEach(() => {
  localStorage.clear();
});

describe('conflict-metrics', () => {
  it('starts at zero', () => {
    expect(getDeckConflictCount()).toBe(0);
  });

  it('increments and persists the count across calls', () => {
    expect(recordDeckConflict('d-1')).toBe(1);
    expect(recordDeckConflict('d-2')).toBe(2);
    expect(getDeckConflictCount()).toBe(2);
  });

  it('logs a warning line with the deck id and running total', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordDeckConflict('d-9');
    expect(spy).toHaveBeenCalledWith(
      '[sync] deck push conflict',
      expect.objectContaining({ deckId: 'd-9', totalConflicts: 1 })
    );
    spy.mockRestore();
  });

  it('degrades gracefully when localStorage throws', () => {
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => recordDeckConflict('d-1')).not.toThrow();
    expect(getDeckConflictCount()).toBe(0);
    spy.mockRestore();
  });
});
