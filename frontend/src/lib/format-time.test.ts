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

  it('returns years for intervals >= 12 months', () => {
    // 400 days ≈ 13.3 months → floors to 1 year
    expect(formatRelativeTime(Date.now() - 400 * 24 * 60 * 60 * 1000)).toBe('1y ago');
    // 730 days ≈ 24 months → 2 years
    expect(formatRelativeTime(Date.now() - 730 * 24 * 60 * 60 * 1000)).toBe('2y ago');
  });
});

describe('formatRelativeTime — options', () => {
  it('justNowThresholdSec=45: returns "just now" at 44s, "1m ago" at 60s', () => {
    const base = 1_000_000;
    expect(formatRelativeTime(base, { now: base + 44_000, justNowThresholdSec: 45 })).toBe(
      'just now'
    );
    expect(formatRelativeTime(base, { now: base + 60_000, justNowThresholdSec: 45 })).toBe(
      '1m ago'
    );
  });

  it('includeMonthsYears=false: caps at days for 60-day gap', () => {
    const base = 1_000_000;
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(base, { now: base + sixtyDays, includeMonthsYears: false })).toBe(
      '60d ago'
    );
  });

  it('includeMonthsYears=true (default): returns "2mo ago" for 60-day gap', () => {
    const base = 1_000_000;
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(base, { now: base + sixtyDays })).toBe('2mo ago');
  });

  it('injectable now: future timestamp clamps to "just now"', () => {
    expect(formatRelativeTime(1_005_000, { now: 1_000_000 })).toBe('just now');
  });

  // SyncIndicator-specific behavior: 45s threshold + days ceiling (no months/years)
  it('SyncIndicator config: "just now" within the first 45 seconds', () => {
    const opts = { justNowThresholdSec: 45, includeMonthsYears: false };
    expect(formatRelativeTime(1_000_000, { now: 1_000_000, ...opts })).toBe('just now');
    expect(formatRelativeTime(1_000_000, { now: 1_000_000 + 44_000, ...opts })).toBe('just now');
  });

  it('SyncIndicator config: "Nm ago" for the minutes band', () => {
    const base = 1_000_000;
    const opts = { justNowThresholdSec: 45, includeMonthsYears: false };
    expect(formatRelativeTime(base, { now: base + 60_000, ...opts })).toBe('1m ago');
    expect(formatRelativeTime(base, { now: base + 5 * 60_000, ...opts })).toBe('5m ago');
    expect(formatRelativeTime(base, { now: base + 59 * 60_000, ...opts })).toBe('59m ago');
  });

  it('SyncIndicator config: "Nh ago" for the hours band', () => {
    const base = 1_000_000;
    const opts = { justNowThresholdSec: 45, includeMonthsYears: false };
    expect(formatRelativeTime(base, { now: base + 60 * 60_000, ...opts })).toBe('1h ago');
    expect(formatRelativeTime(base, { now: base + 23 * 60 * 60_000, ...opts })).toBe('23h ago');
  });

  it('SyncIndicator config: "Nd ago" for >= 24h, caps at days (no months)', () => {
    const base = 1_000_000;
    const opts = { justNowThresholdSec: 45, includeMonthsYears: false };
    expect(formatRelativeTime(base, { now: base + 24 * 60 * 60_000, ...opts })).toBe('1d ago');
    expect(formatRelativeTime(base, { now: base + 3 * 24 * 60 * 60_000, ...opts })).toBe('3d ago');
    // 60 days would normally be "2mo ago" but caps at days
    expect(formatRelativeTime(base, { now: base + 60 * 24 * 60 * 60_000, ...opts })).toBe(
      '60d ago'
    );
  });

  it('SyncIndicator config: clamps future timestamps to "just now"', () => {
    const opts = { justNowThresholdSec: 45, includeMonthsYears: false };
    expect(formatRelativeTime(1_000_000 + 5_000, { now: 1_000_000, ...opts })).toBe('just now');
  });
});
