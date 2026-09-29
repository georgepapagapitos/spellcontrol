import { describe, expect, it } from 'vitest';
import { holdStepFor } from './hold-ramp';

describe('holdStepFor', () => {
  it('returns 1 at elapsed 0', () => {
    expect(holdStepFor(0)).toBe(1);
  });

  it('returns 1 for negative elapsed (clamp to first entry)', () => {
    expect(holdStepFor(-100)).toBe(1);
  });

  it('returns 1 just below the 1500ms threshold', () => {
    expect(holdStepFor(1499)).toBe(1);
  });

  it('returns 5 at the exact 1500ms threshold', () => {
    expect(holdStepFor(1500)).toBe(5);
  });

  it('returns 5 within the [1500, 3500) window', () => {
    expect(holdStepFor(2000)).toBe(5);
  });

  it('returns 10 at the exact 3500ms threshold', () => {
    expect(holdStepFor(3500)).toBe(10);
  });

  it('returns 10 above 3500ms', () => {
    expect(holdStepFor(5000)).toBe(10);
  });
});
