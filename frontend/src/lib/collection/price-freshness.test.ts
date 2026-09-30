import { describe, it, expect } from 'vitest';
import { formatPricedDate, newestPricedAt } from './price-freshness';

describe('formatPricedDate', () => {
  it('returns null when never priced', () => {
    expect(formatPricedDate(null)).toBeNull();
    expect(formatPricedDate(undefined)).toBeNull();
    expect(formatPricedDate(0)).toBeNull();
    expect(formatPricedDate(-5)).toBeNull();
  });

  it('formats a positive timestamp to a date string', () => {
    const label = formatPricedDate(Date.UTC(2026, 5, 14, 12));
    expect(label).toBeTruthy();
    expect(label).toContain('2026');
  });
});

describe('newestPricedAt', () => {
  it('returns null for an empty / never-priced set', () => {
    expect(newestPricedAt([])).toBeNull();
    expect(newestPricedAt([{}, { pricedAt: 0 }])).toBeNull();
  });

  it('returns the newest stamp, ignoring missing ones', () => {
    expect(newestPricedAt([{ pricedAt: 100 }, {}, { pricedAt: 300 }, { pricedAt: 200 }])).toBe(300);
  });
});
