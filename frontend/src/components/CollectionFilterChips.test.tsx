// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { formatMoney } from '../lib/format-money';

// Test formatMoney for chip labels (price chip rendering)
describe('price chip label formatting', () => {
  it('formats min-only as >= $X', () => {
    const label = `Price: ≥ ${formatMoney(5)}`;
    expect(label).toBe('Price: ≥ $5.00');
  });
  it('formats max-only as <= $X', () => {
    const label = `Price: ≤ ${formatMoney(10)}`;
    expect(label).toBe('Price: ≤ $10.00');
  });
  it('formats range as $X–$Y', () => {
    const label = `Price: ${formatMoney(2)}–${formatMoney(8)}`;
    expect(label).toBe('Price: $2.00–$8.00');
  });
  it('formats CMC min-only as CMC: >= N', () => {
    const label = `CMC: ≥ 3`;
    expect(label).toBe('CMC: ≥ 3');
  });
  it('formats CMC max-only as CMC: <= N', () => {
    const label = `CMC: ≤ 5`;
    expect(label).toBe('CMC: ≤ 5');
  });
  it('formats CMC range as CMC: M–N', () => {
    const label = `CMC: 2–6`;
    expect(label).toBe('CMC: 2–6');
  });
});
