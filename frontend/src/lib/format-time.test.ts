import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from './format-time';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" within the last minute', () => {
    expect(formatRelativeTime(Date.now() - 30 * 1000)).toBe('just now');
    expect(formatRelativeTime(Date.now())).toBe('just now');
  });

  it('returns minutes for sub-hour intervals', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe('5m ago');
    expect(formatRelativeTime(Date.now() - 59 * 60 * 1000)).toBe('59m ago');
  });

  it('returns hours for sub-day intervals', () => {
    expect(formatRelativeTime(Date.now() - 2 * 60 * 60 * 1000)).toBe('2h ago');
    expect(formatRelativeTime(Date.now() - 23 * 60 * 60 * 1000)).toBe('23h ago');
  });

  it('returns days for sub-month intervals', () => {
    expect(formatRelativeTime(Date.now() - 3 * 24 * 60 * 60 * 1000)).toBe('3d ago');
    expect(formatRelativeTime(Date.now() - 29 * 24 * 60 * 60 * 1000)).toBe('29d ago');
  });

  it('returns months for older intervals', () => {
    expect(formatRelativeTime(Date.now() - 60 * 24 * 60 * 60 * 1000)).toBe('2mo ago');
  });
});
