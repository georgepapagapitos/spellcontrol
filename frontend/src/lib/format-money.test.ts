import { describe, expect, it } from 'vitest';
import { useCurrencyStore } from './currency';
import { formatMoney } from './format-money';

describe('formatMoney', () => {
  describe('basic USD formatting', () => {
    it('formats a simple amount with two decimals', () => {
      expect(formatMoney(4.5)).toBe('$4.50');
    });

    it('rounds to cents', () => {
      expect(formatMoney(1.005)).toBe('$1.01');
      expect(formatMoney(1.004)).toBe('$1.00');
    });

    it('formats sub-dollar amounts', () => {
      expect(formatMoney(0.25)).toBe('$0.25');
    });
  });

  describe('thousands separators', () => {
    it('always inserts thousands separators', () => {
      expect(formatMoney(12482.5)).toBe('$12,482.50');
    });

    it('handles millions', () => {
      expect(formatMoney(1234567.89)).toBe('$1,234,567.89');
    });

    it('separates with wholeDollars too', () => {
      expect(formatMoney(12482, { wholeDollars: true })).toBe('$12,482');
    });
  });

  describe('wholeDollars', () => {
    it('drops cents entirely', () => {
      expect(formatMoney(99.99, { wholeDollars: true })).toBe('$100');
      expect(formatMoney(99.4, { wholeDollars: true })).toBe('$99');
    });

    it('formats zero as $0', () => {
      expect(formatMoney(0, { wholeDollars: true })).toBe('$0');
    });
  });

  describe('zero and unknown values', () => {
    it('formats zero as $0.00 by default', () => {
      expect(formatMoney(0)).toBe('$0.00');
    });

    it('renders zero as a dash with zeroAsDash', () => {
      expect(formatMoney(0, { zeroAsDash: true })).toBe('—');
    });

    it('renders null as a dash', () => {
      expect(formatMoney(null)).toBe('—');
    });

    it('renders undefined as a dash', () => {
      expect(formatMoney(undefined)).toBe('—');
    });

    it('renders NaN as a dash', () => {
      expect(formatMoney(Number.NaN)).toBe('—');
    });

    it('zeroAsDash does not affect non-zero values', () => {
      expect(formatMoney(3, { zeroAsDash: true })).toBe('$3.00');
    });
  });

  describe('currencies', () => {
    it('formats EUR with the euro symbol', () => {
      expect(formatMoney(12.5, { currency: 'EUR' })).toBe('€12.50');
    });

    it('formats EUR with thousands separators', () => {
      expect(formatMoney(1234.5, { currency: 'EUR' })).toBe('€1,234.50');
    });

    it('combines currency with wholeDollars', () => {
      expect(formatMoney(1234.5, { currency: 'EUR', wholeDollars: true })).toBe('€1,235');
    });

    it('defaults to USD', () => {
      expect(formatMoney(5)).toBe('$5.00');
    });

    it('defaults to the app-wide display currency when set', () => {
      useCurrencyStore.getState().setCurrency('EUR');
      try {
        expect(formatMoney(5)).toBe('€5.00');
        expect(formatMoney(5, { currency: 'USD' })).toBe('$5.00'); // explicit pin wins
      } finally {
        useCurrencyStore.getState().setCurrency('USD');
      }
    });
  });

  describe('negative values', () => {
    it('formats negatives with a leading minus', () => {
      expect(formatMoney(-4.5)).toBe('-$4.50');
    });

    it('formats negative thousands', () => {
      expect(formatMoney(-12482.5)).toBe('-$12,482.50');
    });

    it('negatives are not dashed by zeroAsDash', () => {
      expect(formatMoney(-1, { zeroAsDash: true })).toBe('-$1.00');
    });
  });

  describe('memoization', () => {
    it('returns consistent output across repeated calls (cached formatter)', () => {
      const a = formatMoney(10, { currency: 'EUR' });
      const b = formatMoney(10, { currency: 'EUR' });
      expect(a).toBe(b);
      expect(a).toBe('€10.00');
    });
  });
});
